[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/local-runtime.ps1')
$accountUsername = Read-Host 'Új admin felhasználónév (3–40 betű/szám/pont/kötőjel/aláhúzás)'
$accountSecurePassword = Read-Host 'Jelszó (legalább 12 karakter)' -AsSecureString
$accountPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($accountSecurePassword)
try {
    $accountPayload = @{ username = $accountUsername; password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($accountPasswordPointer) } | ConvertTo-Json -Compress
    $accountPayload | & (Get-BunExecutable) (Join-Path (Get-LocalRepoRoot) 'server/control-plane/bootstrap-account.ts')
    if ($LASTEXITCODE -ne 0) { throw 'A tulajdonosi fiók létrehozása sikertelen.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($accountPasswordPointer)
    $accountPayload = $null
    $accountSecurePassword.Dispose()
}
