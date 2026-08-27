[CmdletBinding()]
param(
    [switch]$SkipLive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')

$repoRoot = Get-LocalRepoRoot
$bun = Get-BunExecutable

Push-Location $repoRoot
try {
    & $bun run check
    if ($LASTEXITCODE -ne 0) {
        throw "A Phase 7 determinisztikus regressziós kapu hibával állt le: $LASTEXITCODE"
    }

    & (Join-Path $PSScriptRoot 'test-powershell.ps1')
    if ($LASTEXITCODE -ne 0) {
        throw "A PowerShell regressziós ellenőrzés hibával állt le: $LASTEXITCODE"
    }

    if (-not $SkipLive) {
        & (Join-Path $PSScriptRoot 'smoke-local.ps1') -SkipAction
        if ($LASTEXITCODE -ne 0) {
            throw "A Phase 7 élő health smoke hibával állt le: $LASTEXITCODE"
        }
    }
}
finally {
    Pop-Location
}

Write-Host $(if ($SkipLive) {
    'Phase 7 regressziós kapu sikeres (élő smoke nélkül).'
} else {
    'Phase 7 regressziós kapu és élő health smoke sikeres.'
})
