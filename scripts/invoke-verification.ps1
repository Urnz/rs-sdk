[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')]
    [string]$Name,

    [Parameter(Mandatory)]
    [string]$CommandText,

    [string]$WorkingDirectory = (Split-Path $PSScriptRoot -Parent),

    [string]$LogDirectory,

    [string]$JUnitPath,

    [ValidateRange(5, 100)]
    [int]$FailureExcerptLines = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-VerificationCommandUsesBun {
    param([Parameter(Mandatory)][string]$Text)

    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput(
        $Text,
        [ref]$tokens,
        [ref]$parseErrors
    )
    if (@($parseErrors).Count -gt 0) {
        throw "Verification command could not be parsed: $($parseErrors[0].Message)"
    }
    return @($ast.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.GetCommandName() -ieq 'bun'
        }, $true)).Count -gt 0
}

function Resolve-VerificationBunRuntime {
    foreach ($command in @(Get-Command bun -All -ErrorAction SilentlyContinue)) {
        $pathProperty = $command.PSObject.Properties['Path']
        $sourceProperty = $command.PSObject.Properties['Source']
        $candidate = if ($null -ne $pathProperty -and -not [string]::IsNullOrWhiteSpace($pathProperty.Value)) {
            [string]$pathProperty.Value
        } elseif ($null -ne $sourceProperty -and -not [string]::IsNullOrWhiteSpace($sourceProperty.Value)) {
            [string]$sourceProperty.Value
        } else { $null }
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
        $npmRoot = Join-Path $env:APPDATA 'npm'
        foreach ($candidate in @(
                (Join-Path $npmRoot 'bun.cmd'),
                (Join-Path $npmRoot 'bun.ps1'),
                (Join-Path $npmRoot 'node_modules\bun\bin\bun.exe')
            )) {
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                return (Resolve-Path -LiteralPath $candidate).Path
            }
        }
    }

    throw [System.IO.FileNotFoundException]::new(
        'Bun runtime was not found on PATH or in the supported %APPDATA%\npm locations.'
    )
}

if (-not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
    throw "Working directory does not exist: $WorkingDirectory"
}

if ([string]::IsNullOrWhiteSpace($LogDirectory)) {
    $LogDirectory = Join-Path $WorkingDirectory '.local\verification'
}
[void](New-Item -ItemType Directory -Path $LogDirectory -Force)
$LogDirectory = (Resolve-Path -LiteralPath $LogDirectory).Path

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$logPath = Join-Path $LogDirectory "$stamp-$Name.log"
$startedAt = Get-Date
$exitCode = 1
$commandHostStarted = $false
$resolvedBun = $null
$preflightFailure = $null

@(
    "name: $Name"
    "command: $CommandText"
    "working-directory: $WorkingDirectory"
    "started-at: $($startedAt.ToString('o'))"
    ''
) | Set-Content -LiteralPath $logPath -Encoding utf8

try {
    $usesBun = Test-VerificationCommandUsesBun -Text $CommandText
    if ($usesBun) {
        $resolvedBun = Resolve-VerificationBunRuntime
        "resolved-bun: $resolvedBun" | Add-Content -LiteralPath $logPath -Encoding utf8
    }
} catch {
    $preflightFailure = $_.Exception.Message
    "VERIFICATION_LAUNCH_FAILURE: $preflightFailure" | Add-Content -LiteralPath $logPath -Encoding utf8
    $exitCode = 127
}

if ($null -eq $preflightFailure) {
    $escapedBun = if ($resolvedBun) { $resolvedBun.Replace("'", "''") } else { $null }
    $bunSetup = if ($escapedBun) {
        "Set-Alias -Name bun -Value '$escapedBun' -Scope Local"
    } else { '' }
    $wrappedCommand = @"
`$ErrorActionPreference = 'Stop'
$bunSetup
try {
    & {
$CommandText
    }
    `$verificationCommandSucceeded = `$?
    `$verificationNativeExitCode = `$LASTEXITCODE
} catch [System.Management.Automation.CommandNotFoundException] {
    [Console]::Error.WriteLine("VERIFICATION_LAUNCH_FAILURE: " + `$_.Exception.Message)
    exit 127
} catch [System.Management.Automation.ApplicationFailedException] {
    [Console]::Error.WriteLine("VERIFICATION_LAUNCH_FAILURE: " + `$_.Exception.Message)
    exit 126
} catch [System.ComponentModel.Win32Exception] {
    [Console]::Error.WriteLine("VERIFICATION_LAUNCH_FAILURE: " + `$_.Exception.Message)
    exit 126
} catch {
    [Console]::Error.WriteLine("VERIFICATION_COMMAND_FAILURE: " + `$_.Exception.Message)
    exit 1
}
if (`$verificationNativeExitCode -is [int] -and `$verificationNativeExitCode -ne 0) {
    exit `$verificationNativeExitCode
}
if (-not `$verificationCommandSucceeded) { exit 1 }
exit 0
"@
    Push-Location -LiteralPath $WorkingDirectory
    try {
        $pwshPath = Join-Path $PSHOME 'pwsh.exe'
        if (-not (Test-Path -LiteralPath $pwshPath -PathType Leaf)) {
            throw [System.IO.FileNotFoundException]::new("PowerShell command host was not found: $pwshPath")
        }
        & $pwshPath -NoProfile -NonInteractive -Command $wrappedCommand *>> $logPath
        $commandHostStarted = $true
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) {
            'VERIFICATION_LAUNCH_FAILURE: PowerShell command host returned no exit code.' |
                Add-Content -LiteralPath $logPath -Encoding utf8
            $exitCode = 126
        }
    } catch {
        "VERIFICATION_LAUNCH_FAILURE: $($_.Exception.Message)" |
            Add-Content -LiteralPath $logPath -Encoding utf8
        $exitCode = 126
    } finally {
        Pop-Location
    }
}

$finishedAt = Get-Date
$duration = $finishedAt - $startedAt
$passed = $null
$failed = $null
$skipped = $null
$failedTests = @()

if (-not [string]::IsNullOrWhiteSpace($JUnitPath)) {
    $resolvedJUnitPath = if ([System.IO.Path]::IsPathRooted($JUnitPath)) {
        $JUnitPath
    } else {
        Join-Path $WorkingDirectory $JUnitPath
    }
    if (Test-Path -LiteralPath $resolvedJUnitPath -PathType Leaf) {
        try {
            [xml]$junit = Get-Content -LiteralPath $resolvedJUnitPath -Raw
            $suites = @()
            if ($null -ne $junit.testsuites) { $suites = @($junit.testsuites.testsuite) }
            elseif ($null -ne $junit.testsuite) { $suites = @($junit.testsuite) }
            $total = ($suites | Measure-Object -Property tests -Sum).Sum
            $failed = (($suites | Measure-Object -Property failures -Sum).Sum +
                ($suites | Measure-Object -Property errors -Sum).Sum)
            $skipped = ($suites | Measure-Object -Property skipped -Sum).Sum
            $passed = [Math]::Max(0, [int]$total - [int]$failed - [int]$skipped)
            $failedTests = @($suites.testcase | Where-Object {
                    $null -ne $_.failure -or $null -ne $_.error
                } | ForEach-Object { "$($_.classname)::$($_.name)" } | Select-Object -First 10)
        } catch {
            "JUnit parse warning: $($_.Exception.Message)" | Add-Content -LiteralPath $logPath -Encoding utf8
        }
    }
}

$logLines = @(Get-Content -LiteralPath $logPath)
if ($null -eq $passed) {
    $logText = $logLines -join "`n"
    $passMatches = [regex]::Matches($logText, '(?im)^\s*(\d+)\s+pass(?:ed)?\b')
    $failMatches = [regex]::Matches($logText, '(?im)^\s*(\d+)\s+fail(?:ed)?\b')
    $skipMatches = [regex]::Matches($logText, '(?im)^\s*(\d+)\s+skip(?:ped)?\b')
    if ($passMatches.Count -gt 0) {
        $passed = ($passMatches | ForEach-Object { [int]$_.Groups[1].Value } | Measure-Object -Sum).Sum
        $failed = ($failMatches | ForEach-Object { [int]$_.Groups[1].Value } | Measure-Object -Sum).Sum
        $skipped = ($skipMatches | ForEach-Object { [int]$_.Groups[1].Value } | Measure-Object -Sum).Sum
        if ($null -eq $failed) { $failed = 0 }
        if ($null -eq $skipped) { $skipped = 0 }
    }
}

$launchFailure = -not $commandHostStarted -or
    @($logLines | Where-Object { $_ -like 'VERIFICATION_LAUNCH_FAILURE:*' }).Count -gt 0
$outcome = if ($launchFailure) { 'NOT_STARTED' }
elseif ($exitCode -eq 0) { 'SUCCESS' }
else { 'PROCESS_FAILED' }
$status = if ($outcome -eq 'SUCCESS') { 'PASS' } else { 'FAIL' }
$durationText = '{0:hh\:mm\:ss\.fff}' -f $duration
Write-Output "verification: $status"
Write-Output "outcome: $outcome"
Write-Output "name: $Name"
Write-Output "command: $CommandText"
if ($resolvedBun) { Write-Output "bun-runtime: $resolvedBun" }
Write-Output "exit-code: $exitCode"
Write-Output "duration: $durationText"
if ($null -ne $passed) {
    Write-Output "tests: passed=$passed failed=$failed skipped=$skipped"
} else {
    Write-Output 'tests: counts unavailable'
}
Write-Output "log: $logPath"

if ($status -eq 'FAIL') {
    if ($failedTests.Count -gt 0) {
        Write-Output "failed-tests: $($failedTests -join '; ')"
    }
    $relevant = @($logLines | Where-Object {
            $_ -match '(?i)(error|fail|exception|expected|received|assert| at )'
        } | Select-Object -Last $FailureExcerptLines)
    if ($relevant.Count -eq 0) {
        $relevant = @($logLines | Select-Object -Last $FailureExcerptLines)
    }
    Write-Output 'error-excerpt:'
    $relevant | ForEach-Object { Write-Output "  $_" }
}

exit $exitCode
