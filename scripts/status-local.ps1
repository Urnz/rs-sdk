[CmdletBinding()]
param(
    [string]$BotName,
    [string[]]$BotNames,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')

$health = Get-LocalHealth -BotName $BotName -BotNames $BotNames

if ($Json) {
    $health | ConvertTo-Json -Depth 6
} else {
    $health | Format-List
}

if (-not $health.healthy) {
    exit 1
}
