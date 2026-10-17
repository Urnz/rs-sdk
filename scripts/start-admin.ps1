[CmdletBinding()]
param([ValidateRange(1,65535)][int]$Port = 7781,
    [string]$StateDirectory = (Join-Path $PSScriptRoot '../.local/control-plane'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/local-runtime.ps1')
$adminStateRoot = [IO.Path]::GetFullPath($StateDirectory)
$adminStatePath = Join-Path $adminStateRoot 'runtime.json'
$adminOrigin = if ($env:CONTROL_PLANE_HTTPS_ORIGIN) { $env:CONTROL_PLANE_HTTPS_ORIGIN.TrimEnd('/') } else { "http://127.0.0.1:$Port" }
New-Item -ItemType Directory -Force -Path $adminStateRoot | Out-Null
$adminOperationLock = [IO.File]::Open((Join-Path $adminStateRoot 'operation.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
    if (Test-Path -LiteralPath $adminStatePath) {
        $existingAdmin = Get-Content -LiteralPath $adminStatePath -Raw | ConvertFrom-Json
        if ($existingAdmin.schemaVersion -ne 1) { throw 'Unsupported admin runtime state; no process was changed.' }
        if (Test-LocalManagedProcess $existingAdmin) {
            if ([int]$existingAdmin.port -ne $Port) { throw 'The admin already runs on another port.' }
            $existingAdminOrigin = if ($existingAdmin.PSObject.Properties['origin']) { $existingAdmin.origin } else { "http://127.0.0.1:$($existingAdmin.port)" }
            if ($existingAdminOrigin -ne $adminOrigin) { throw 'The admin already runs with another origin; stop it before changing transport.' }
            Write-Output "Admin already running: $adminOrigin/admin/"
            exit 0
        }
    }
    if (Test-LocalTcpPort -Port $Port) { throw "Port $Port is already occupied; no process was stopped." }
    $adminRunId = [Guid]::NewGuid().ToString('N')
    $oldAdminPort = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_PORT', 'Process')
    $oldAdminLog = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_LOG_PATH', 'Process')
    $oldAdminIdentity = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_IDENTITY_PATH', 'Process')
    $adminProcess = $null
    try {
        $env:CONTROL_PLANE_PORT = [string]$Port
        $env:CONTROL_PLANE_LOG_PATH = Join-Path $adminStateRoot "$adminRunId.log"
        if (-not $oldAdminIdentity) { $env:CONTROL_PLANE_IDENTITY_PATH = Join-Path $adminStateRoot 'identity.sqlite' }
        # No redirected caller handles: the hidden Windows shell launch owns its console.
        # The service writes its own private log, so a captured launcher can reach EOF immediately.
        $adminProcess = Start-Process -FilePath (Get-BunExecutable) -ArgumentList @('run', 'server/control-plane/main.ts') `
            -WorkingDirectory (Get-LocalRepoRoot) -WindowStyle Hidden -PassThru
        $adminState = [ordered]@{ schemaVersion = 1; pid = $adminProcess.Id; startedAtUtc = $adminProcess.StartTime.ToUniversalTime().ToString('o'); port = $Port; origin = $adminOrigin }
        $adminState | ConvertTo-Json | Set-Content -LiteralPath $adminStatePath -Encoding utf8
        Wait-LocalCondition -Description 'independent admin /health' -TimeoutSeconds 15 -Condition {
            if ($adminProcess.HasExited) { throw 'The admin process exited; inspect its private log.' }
            if ($env:CONTROL_PLANE_HTTPS_ORIGIN) {
                & (Get-BunExecutable) run server/control-plane/readiness.ts *> $null
                $LASTEXITCODE -eq 0
            } else { (Test-LocalHttp -Uri "http://127.0.0.1:$Port/health" -ExpectedContentType 'application/json').healthy }
        }
        Write-Output "Admin ready: $adminOrigin/admin/"
    } catch {
        if ($adminProcess -and -not $adminProcess.HasExited) { Stop-Process -Id $adminProcess.Id -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $adminStatePath) { Remove-Item -LiteralPath $adminStatePath -Force }
        throw
    } finally {
        if ($null -eq $oldAdminPort) { Remove-Item Env:CONTROL_PLANE_PORT -ErrorAction SilentlyContinue }
        else { $env:CONTROL_PLANE_PORT = $oldAdminPort }
        if ($null -eq $oldAdminLog) { Remove-Item Env:CONTROL_PLANE_LOG_PATH -ErrorAction SilentlyContinue }
        else { $env:CONTROL_PLANE_LOG_PATH = $oldAdminLog }
        if ($null -eq $oldAdminIdentity) { Remove-Item Env:CONTROL_PLANE_IDENTITY_PATH -ErrorAction SilentlyContinue }
        else { $env:CONTROL_PLANE_IDENTITY_PATH = $oldAdminIdentity }
    }
} finally { $adminOperationLock.Dispose() }
