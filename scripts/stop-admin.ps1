[CmdletBinding()]
param([string]$StateDirectory = (Join-Path $PSScriptRoot '../.local/control-plane'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/local-runtime.ps1')
$adminStateRoot = [IO.Path]::GetFullPath($StateDirectory)
$adminStatePath = Join-Path $adminStateRoot 'runtime.json'
if (-not (Test-Path -LiteralPath $adminStateRoot)) { Write-Output 'No managed admin process.'; exit 0 }
$adminOperationLock = [IO.File]::Open((Join-Path $adminStateRoot 'operation.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
    if (-not (Test-Path -LiteralPath $adminStatePath)) { Write-Output 'No managed admin process.'; exit 0 }
    $adminState = Get-Content -LiteralPath $adminStatePath -Raw | ConvertFrom-Json
    if ($adminState.schemaVersion -ne 1) { throw 'Unsupported admin runtime state; no process was stopped.' }
    if (Test-LocalManagedProcess $adminState) { Stop-LocalManagedProcess $adminState }
    Remove-Item -LiteralPath $adminStatePath -Force
    Write-Output 'Admin stopped. Engine, gateway and bots were not changed.'
} finally { $adminOperationLock.Dispose() }
