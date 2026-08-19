[CmdletBinding()]
param(
    [string]$BotName,
    [switch]$SkipAction
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')

$state = Get-LocalRuntimeState
if (-not $BotName -and $state -and $state.botName) {
    $BotName = [string]$state.botName
}

$health = Get-LocalHealth -BotName $BotName
if (-not $health.healthy) {
    $health | ConvertTo-Json -Depth 6
    throw 'A helyi stack nem egészséges.'
}

if (-not $SkipAction) {
    if (-not $BotName) {
        throw 'A teljes smoke teszthez adj meg -BotName értéket, vagy indítsd a stacket bottal.'
    }

    $repoRoot = Get-LocalRepoRoot
    $scriptPath = Join-Path $repoRoot "bots\$BotName\script.ts"
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        throw "A bot smoke script nem található: $scriptPath"
    }

    $bun = Get-BunExecutable
    & $bun run $scriptPath
    if ($LASTEXITCODE -ne 0) {
        throw "A bot smoke művelet hibával állt le: $LASTEXITCODE"
    }
}

$finalHealth = Get-LocalHealth -BotName $BotName
if (-not $finalHealth.healthy) {
    throw 'A stack a smoke művelet után nem egészséges.'
}

Write-Host 'Smoke teszt sikeres.'
$finalHealth | ConvertTo-Json -Depth 6
