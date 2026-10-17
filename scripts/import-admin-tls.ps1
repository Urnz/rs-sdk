[CmdletBinding()]
param([Parameter(Mandatory)][string]$PrivateKeyPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/local-runtime.ps1')
# The existing private key is read once and passed through stdin, never argv/environment.
$adminTlsKey = [IO.File]::ReadAllText([IO.Path]::GetFullPath($PrivateKeyPath))
try {
    $adminTlsPayload = @{ key = $adminTlsKey } | ConvertTo-Json -Compress
    Push-Location (Get-LocalRepoRoot)
    try {
        $adminTlsPayload | & (Get-BunExecutable) run server/control-plane/import-tls.ts
        if ($LASTEXITCODE -ne 0) { throw 'HTTPS key import failed.' }
    } finally { Pop-Location }
} finally { $adminTlsKey = $null; $adminTlsPayload = $null }
