[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$GatewayPid,
    [Parameter(Mandatory)][string]$ResultPath,
    [int]$TimeoutSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')

$state = Get-LocalRuntimeState
if (-not $state) {
    throw 'No managed local stack is running.'
}

$gateway = @($state.components | Where-Object { $_.name -eq 'gateway' }) | Select-Object -First 1
$engine = @($state.components | Where-Object { $_.name -eq 'engine' }) | Select-Object -First 1
if (-not $gateway -or [int]$gateway.pid -ne $GatewayPid -or -not (Test-LocalManagedProcess $gateway)) {
    throw 'The requesting gateway does not match the managed local stack.'
}
if (-not $engine -or -not (Test-LocalManagedProcess $engine)) {
    throw 'The managed engine process is not running; start the complete stack.'
}

$repoRoot = Get-LocalRepoRoot
$allowedResultRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.local\admin\engine-restarts'))
$resolvedResultPath = [System.IO.Path]::GetFullPath($ResultPath)
if (-not $resolvedResultPath.StartsWith($allowedResultRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The restart result path is outside the approved local directory.'
}
$bun = Get-BunExecutable
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDirectory = [string]$state.logDirectory
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$stdout = Join-Path $logDirectory "engine-restart-$timestamp.out.log"
$stderr = Join-Path $logDirectory "engine-restart-$timestamp.err.log"
$previousPid = [int]$engine.pid

Stop-LocalManagedProcess $engine
Wait-LocalCondition -Description 'engine port release' -TimeoutSeconds 20 -Condition {
    -not (Test-LocalTcpPort -Port 8888)
}

$oldEasyStartup = $env:EASY_STARTUP
$oldRegistration = $env:WEBSITE_REGISTRATION
try {
    $env:EASY_STARTUP = 'true'
    $env:WEBSITE_REGISTRATION = 'false'
    $process = Start-Process -FilePath $bun -ArgumentList @('run', 'src/app.ts') `
        -WorkingDirectory (Join-Path $repoRoot 'server\engine') `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr `
        -WindowStyle Hidden -PassThru

    $replacement = [pscustomobject]@{
        name = 'engine'
        pid = $process.Id
        startedAtUtc = $process.StartTime.ToUniversalTime().ToString('o')
        stdout = $stdout
        stderr = $stderr
    }
    $state.components = @($state.components | Where-Object { $_.name -ne 'engine' }) + @($replacement)
    Save-LocalRuntimeState -State $state

    try {
        Wait-LocalCondition -Description 'engine /engine-status' -TimeoutSeconds $TimeoutSeconds -Condition {
            (Test-LocalHttp -Uri 'http://localhost:8888/engine-status').healthy
        }
        Wait-LocalCondition -Description 'webclient JavaScript modul' -TimeoutSeconds $TimeoutSeconds -Condition {
            (Test-LocalHttp -Uri 'http://localhost:8888/client/client.js' -ExpectedContentType 'application/javascript').healthy
        }
    } catch {
        Stop-LocalManagedProcess $replacement
        $state.components = @($state.components | Where-Object { $_.name -ne 'engine' })
        Save-LocalRuntimeState -State $state
        throw
    }

    $result = [pscustomobject]@{
        ok = $true
        previousPid = $previousPid
        pid = $process.Id
        restartedAt = [DateTime]::UtcNow.ToString('o')
        logDirectory = $logDirectory
    }
    New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($resolvedResultPath)) | Out-Null
    $result | ConvertTo-Json -Compress | Set-Content -LiteralPath $resolvedResultPath -Encoding utf8
} finally {
    $env:EASY_STARTUP = $oldEasyStartup
    $env:WEBSITE_REGISTRATION = $oldRegistration
}
