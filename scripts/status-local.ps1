[CmdletBinding()]
param(
    [string]$BotName,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')

$health = Get-LocalHealth -BotName $BotName

if ($Json) {
    $health | ConvertTo-Json -Depth 6
} else {
    $health | Format-List
}

if (-not $health.healthy) {
    exit 1
}
