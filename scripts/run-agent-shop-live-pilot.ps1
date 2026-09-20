[CmdletBinding()]
param([int]$TimeoutSeconds = 90, [switch]$ResumeWage)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')
$repoRoot = Get-LocalRepoRoot
$bun = Get-BunExecutable
$liveDirectory = Join-Path $repoRoot '.local\economy\agent-shop-live'
New-Item -ItemType Directory -Force -Path $liveDirectory | Out-Null

function Invoke-PilotStage {
    param([Parameter(Mandatory)][string]$Stage)
    & $bun 'scripts/run-agent-shop-live-accounting.ts' "--$Stage"
    if ($LASTEXITCODE -ne 0) { throw "A(z) $Stage könyvelési szakasz sikertelen." }
}

function Start-BotStage {
    param([Parameter(Mandatory)][string]$BotName, [Parameter(Mandatory)][string]$Mode)
    $stdout = Join-Path $liveDirectory "$Mode.out.log"
    $stderr = Join-Path $liveDirectory "$Mode.err.log"
    return Start-Process -FilePath $bun -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr `
        -ArgumentList @('scripts/run-agent-shop-live-trade.ts', $BotName, "--$Mode")
}

function Wait-BotStages {
    param([Parameter(Mandatory)][System.Diagnostics.Process[]]$Processes)
    $Processes | Wait-Process -Timeout 240
    foreach ($process in $Processes) {
        $process.Refresh()
        if ($process.ExitCode -ne 0) { throw "Egy élő bot-szakasz hibával állt le (PID $($process.Id))." }
    }
}

$env:ENGINE_ADMIN_TOKEN = [Guid]::NewGuid().ToString('N')
$env:NODE_SHOP_ECONOMY_MODE = 'closed-society'
try {
    & (Join-Path $PSScriptRoot 'stop-local.ps1')
    & (Join-Path $PSScriptRoot 'start-local.ps1') -BotNames @('VRTrader1', 'VRWorker1') -TimeoutSeconds $TimeoutSeconds
    if ($ResumeWage) {
        $shift = Start-BotStage -BotName 'VRTrader1' -Mode 'work-shift-2'
        Wait-BotStages -Processes @($shift)
        Invoke-PilotStage -Stage 'wage'
        Invoke-PilotStage -Stage 'report'
        & (Join-Path $PSScriptRoot 'status-local.ps1') -Json
        return
    }
    Invoke-PilotStage -Stage 'bootstrap'

    $seller = Start-BotStage -BotName 'VRTrader1' -Mode 'seller'
    Start-Sleep -Seconds 2
    $buyer = Start-BotStage -BotName 'VRWorker1' -Mode 'buyer'
    Wait-BotStages -Processes @($seller, $buyer)
    Invoke-PilotStage -Stage 'sale'

    $receiver = Start-BotStage -BotName 'VRTrader1' -Mode 'stock-receiver'
    Start-Sleep -Seconds 2
    $supplier = Start-BotStage -BotName 'VRWorker1' -Mode 'supplier'
    Wait-BotStages -Processes @($receiver, $supplier)
    Invoke-PilotStage -Stage 'procurement'
    Invoke-PilotStage -Stage 'wage'
    Invoke-PilotStage -Stage 'report'
    & (Join-Path $PSScriptRoot 'status-local.ps1') -Json
} catch {
    Write-Error $_
    throw
}
