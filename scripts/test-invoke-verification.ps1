[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$wrapper = Join-Path $PSScriptRoot 'invoke-verification.ps1'
$pwshPath = Join-Path $PSHOME 'pwsh.exe'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "rs-sdk-verification-$([Guid]::NewGuid().ToString('N'))"
$logs = Join-Path $testRoot 'logs'
[void](New-Item -ItemType Directory -Path $logs -Force)

function Invoke-VerificationFixture {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$CommandText
    )

    $lines = @(& $pwshPath -NoProfile -NonInteractive -File $wrapper -Name $Name `
            -CommandText $CommandText -WorkingDirectory $testRoot -LogDirectory $logs 2>&1 |
            ForEach-Object { $_.ToString() })
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Text = $lines -join "`n" }
}

function Assert-VerificationFixture {
    param(
        [Parameter(Mandatory)]$Result,
        [Parameter(Mandatory)][int]$ExitCode,
        [Parameter(Mandatory)][string[]]$Contains
    )
    if ($Result.ExitCode -ne $ExitCode) {
        throw "Expected exit $ExitCode, got $($Result.ExitCode):`n$($Result.Text)"
    }
    foreach ($expected in $Contains) {
        if (-not $Result.Text.Contains($expected, [StringComparison]::Ordinal)) {
            throw "Missing '$expected' in verification output:`n$($Result.Text)"
        }
    }
    $resultLine = @($Result.Text -split "`n" | Where-Object { $_.StartsWith('result: ') })
    if ($resultLine.Count -ne 1) { throw 'Expected exactly one machine-readable result path.' }
    $metrics = Get-Content -Raw -LiteralPath $resultLine[0].Substring(8).Trim() | ConvertFrom-Json
    if ($metrics.version -ne 1 -or $metrics.exitCode -ne $ExitCode -or
        -not $Result.Text.Contains("outcome: $($metrics.outcome)") -or
        $metrics.durationSeconds -lt 0 -or
        [DateTimeOffset]::Parse($metrics.finishedAt) -lt [DateTimeOffset]::Parse($metrics.startedAt) -or
        $metrics.logBytes -ne (Get-Item -LiteralPath $metrics.logPath).Length) {
        throw 'Invalid timing, outcome, exit code or log size in verification result.'
    }
}

$savedAppData = $env:APPDATA
$savedPath = $env:PATH
try {
    $success = Invoke-VerificationFixture -Name 'success' -CommandText "Write-Output 'verification-ok'"
    Assert-VerificationFixture $success 0 @('verification: PASS', 'outcome: SUCCESS', 'exit-code: 0')

    $counts = Invoke-VerificationFixture -Name 'counts' -CommandText "Write-Output ' 3 pass'; Write-Output ' 0 fail'; Write-Output ' 0 skip'"
    Assert-VerificationFixture $counts 0 @('tests: passed=3 failed=0 skipped=0')
    $countsPath = ($counts.Text -split "`n" | Where-Object { $_.StartsWith('result: ') }).Substring(8).Trim()
    $countsMetrics = Get-Content -Raw -LiteralPath $countsPath | ConvertFrom-Json
    if ($countsMetrics.tests.passed -ne 3 -or $countsMetrics.tests.failed -ne 0 -or
        $countsMetrics.tests.skipped -ne 0) { throw 'Machine-readable test counts differ from command output.' }

    $failed = Invoke-VerificationFixture -Name 'process-failed' -CommandText '& $env:ComSpec /d /c exit 7'
    Assert-VerificationFixture $failed 7 @('verification: FAIL', 'outcome: PROCESS_FAILED', 'exit-code: 7')

    $notStarted = Invoke-VerificationFixture -Name 'not-started' `
        -CommandText 'definitely-not-a-real-verification-command'
    Assert-VerificationFixture $notStarted 127 @('verification: FAIL', 'outcome: NOT_STARTED', 'exit-code: 127')

    $fakeAppData = Join-Path $testRoot 'appdata'
    $fakeNpm = Join-Path $fakeAppData 'npm'
    [void](New-Item -ItemType Directory -Path $fakeNpm -Force)
    $env:APPDATA = $fakeAppData
    $env:PATH = "$PSHOME;$env:SystemRoot\System32"

    $bunMissing = Invoke-VerificationFixture -Name 'bun-not-found' -CommandText 'bun --version'
    Assert-VerificationFixture $bunMissing 127 @(
        'verification: FAIL',
        'outcome: NOT_STARTED',
        'Bun runtime was not found on PATH or in the supported %APPDATA%\npm locations.'
    )

    $fakeBun = Join-Path $fakeNpm 'bun.cmd'
    @('@echo off', 'echo fake-bun-success', 'exit /b 0') |
        Set-Content -LiteralPath $fakeBun -Encoding ascii
    $fallback = Invoke-VerificationFixture -Name 'bun-fallback' -CommandText 'bun --version'
    Assert-VerificationFixture $fallback 0 @(
        'verification: PASS',
        'outcome: SUCCESS',
        "bun-runtime: $fakeBun"
    )
    $fallbackLog = Get-ChildItem -LiteralPath $logs -Filter '*-bun-fallback.log' |
        Sort-Object LastWriteTime | Select-Object -Last 1
    if (-not $fallbackLog -or -not (Get-Content -Raw -LiteralPath $fallbackLog.FullName).Contains('fake-bun-success')) {
        throw 'The resolved Bun fallback was not actually executed.'
    }
} finally {
    $env:APPDATA = $savedAppData
    $env:PATH = $savedPath
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}

Write-Host 'Verification wrapper success, process-failure, launch-failure and Bun fallback tests passed.'
