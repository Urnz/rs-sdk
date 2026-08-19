[CmdletBinding()]
param([switch]$Ci)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Ci) {
    git diff --check HEAD^ HEAD
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    git diff --check
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    git diff --cached --check
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host 'A módosított sorok formázása rendben van.'
