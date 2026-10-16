[CmdletBinding()]
param(
    [string]$BotName,
    [string[]]$BotNames,
    [string]$FixturePath,
    [switch]$NoBot,
    [switch]$GatewayLoginAuthentication,
    [switch]$EnableThievingProcessor,
    [int]$TimeoutSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')

$repoRoot = Get-LocalRepoRoot
$bun = Get-BunExecutable
$runtimeRoot = Get-LocalRuntimeRoot
$selectedBotNames = @(Resolve-LocalBotNames -BotName $BotName -BotNames $BotNames `
    -FixturePath $FixturePath -NoBot:$NoBot)

if (-not $NoBot -and $selectedBotNames.Count -eq 0) {
    $candidates = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'bots') -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne '_template' })
    if ($candidates.Count -eq 1) {
        $selectedBotNames = @($candidates[0].Name)
    }
}

foreach ($selectedBotName in $selectedBotNames) {
    $botEnvironmentPath = Join-Path $repoRoot "bots\$selectedBotName\bot.env"
    if (-not (Test-Path -LiteralPath $botEnvironmentPath -PathType Leaf)) {
        throw "A bot nem található vagy nincs bot.env fájlja: $selectedBotName"
    }
}

$existingHealth = Get-LocalHealth -BotNames $selectedBotNames
if ($existingHealth.healthy) {
    if ($EnableThievingProcessor -and -not $existingHealth.thievingProcessor.enabled) {
        throw 'A helyi stack már fut Thieving feldolgozó nélkül. Állítsd le a scripts/stop-local.ps1 paranccsal, majd indítsd újra -EnableThievingProcessor kapcsolóval.'
    }
    Write-Host 'A helyi stack már egészséges.'
    $existingHealth | ConvertTo-Json -Depth 6
    exit 0
}

foreach ($port in 7780, 8888) {
    if (Test-LocalTcpPort -Port $port) {
        throw "A $port portot egy nem kezelt vagy hibás folyamat használja. Állítsd le kézzel, majd futtasd újra az indítót."
    }
}

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDirectory = Join-Path $runtimeRoot "logs\$runId"
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

$state = [ordered]@{
    version = 2
    runId = $runId
    startedAtUtc = [DateTime]::UtcNow.ToString('o')
    logDirectory = $logDirectory
    botName = if ($selectedBotNames.Count -gt 0) { $selectedBotNames[0] } else { $null }
    botNames = $selectedBotNames
    fixturePath = if ($FixturePath) { $FixturePath } else { $null }
    thievingProcessorEnabled = [bool]$EnableThievingProcessor
    components = @()
}

function Start-LocalComponent {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string[]]$Arguments
    )

    $stdout = Join-Path $logDirectory "$Name.out.log"
    $stderr = Join-Path $logDirectory "$Name.err.log"
    $process = Start-Process -FilePath $bun -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru

    $entry = [pscustomobject]@{
        name = $Name
        pid = $process.Id
        startedAtUtc = $process.StartTime.ToUniversalTime().ToString('o')
        stdout = $stdout
        stderr = $stderr
    }
    $state.components += $entry
    Save-LocalRuntimeState -State $state
    return $entry
}

$oldEasyStartup = $env:EASY_STARTUP
$oldRegistration = $env:WEBSITE_REGISTRATION
$oldGatewayLoginServer = $env:LOGIN_SERVER
$oldEngineAdminToken = [Environment]::GetEnvironmentVariable('ENGINE_ADMIN_TOKEN', 'Process')
$oldAutonomyStartupGraceMs = [Environment]::GetEnvironmentVariable('AUTONOMY_STARTUP_GRACE_MS', 'Process')
$oldPlayerEscrowSharedCheckpoint = [Environment]::GetEnvironmentVariable('PLAYER_ESCROW_SHARED_CHECKPOINT', 'Process')
$oldPlayerCheckpointDatabase = [Environment]::GetEnvironmentVariable('PLAYER_CHECKPOINT_DATABASE', 'Process')
$env:ENGINE_ADMIN_TOKEN = if ($oldEngineAdminToken) { $oldEngineAdminToken } else { [Guid]::NewGuid().ToString('N') }
$env:AUTONOMY_STARTUP_GRACE_MS = [string](($TimeoutSeconds + 10) * 1000)
$env:PLAYER_ESCROW_SHARED_CHECKPOINT = 'true'
# Explicit checkpoint authority: operationally independent of GE_ENABLED and GE_DATABASE.
# The existing local save was migrated in place; new deployments may choose a dedicated path.
$env:PLAYER_CHECKPOINT_DATABASE = 'data/market.sqlite'

try {
    if ($GatewayLoginAuthentication) { $env:LOGIN_SERVER = 'true' }
    Start-LocalComponent -Name 'gateway' -WorkingDirectory (Join-Path $repoRoot 'server\gateway') -Arguments @('run', 'gateway.ts') | Out-Null
    Wait-LocalCondition -Description 'gateway /status' -TimeoutSeconds $TimeoutSeconds -Condition {
        (Test-LocalHttp -Uri 'http://localhost:7780/status' -ExpectedContentType 'application/json').healthy
    }

    $env:EASY_STARTUP = 'true'
    $env:WEBSITE_REGISTRATION = 'false'
    # Gateway bearer authentication is distinct from the engine's remote save authority.
    # Keep the local engine file-backed, including audited offline acceptance setup.
    if ($GatewayLoginAuthentication) { $env:LOGIN_SERVER = $oldGatewayLoginServer }
    Start-LocalComponent -Name 'engine' -WorkingDirectory (Join-Path $repoRoot 'server\engine') -Arguments @('run', 'src/app.ts') | Out-Null
    Wait-LocalCondition -Description 'engine /engine-status' -TimeoutSeconds $TimeoutSeconds -Condition {
        (Test-LocalHttp -Uri 'http://localhost:8888/engine-status').healthy
    }
    Wait-LocalCondition -Description 'webclient JavaScript modul' -TimeoutSeconds $TimeoutSeconds -Condition {
        (Test-LocalHttp -Uri 'http://localhost:8888/client/client.js' -ExpectedContentType 'application/javascript').healthy
    }

    # Only gateway and engine need the internal mutation token. Do not pass it to bot clients.
    Remove-Item Env:ENGINE_ADMIN_TOKEN -ErrorAction SilentlyContinue

    if ($EnableThievingProcessor) {
        $worker = Start-LocalComponent -Name 'thieving-processor' -WorkingDirectory $repoRoot `
            -Arguments @('run', 'thieving-procedures/watch.ts')
        Start-Sleep -Seconds 1
        if (-not (Test-LocalManagedProcess $worker)) {
            throw "A Thieving feldolgozó leállt indítás után. Napló: $($worker.stderr)"
        }
    }

    foreach ($selectedBotName in $selectedBotNames) {
        Start-LocalComponent -Name "bot-$($selectedBotName.ToLowerInvariant())" `
            -WorkingDirectory (Join-Path $repoRoot 'server\webclient') `
            -Arguments @('run', 'src/lite/runner.ts', $selectedBotName) | Out-Null
    }
    if ($selectedBotNames.Count -gt 0) {
        Wait-LocalCondition -Description "$($selectedBotNames.Count) bot bejelentkezése" `
            -TimeoutSeconds $TimeoutSeconds -Condition {
            (Get-LocalHealth -BotNames $selectedBotNames).healthy
        }
    }

    $health = Get-LocalHealth -BotNames $selectedBotNames
    if (-not $health.healthy) { throw 'A helyi stack állapotellenőrzése sikertelen az indítás után.' }
    Write-Host "Helyi stack elindult. Naplók: $logDirectory"
    $health | ConvertTo-Json -Depth 6
} catch {
    for ($index = $state.components.Count - 1; $index -ge 0; $index--) {
        Stop-LocalManagedProcess $state.components[$index]
    }
    Remove-Item -LiteralPath (Get-LocalStatePath) -Force -ErrorAction SilentlyContinue
    throw
} finally {
    $env:LOGIN_SERVER = $oldGatewayLoginServer
    $env:EASY_STARTUP = $oldEasyStartup
    $env:WEBSITE_REGISTRATION = $oldRegistration
    if ($oldEngineAdminToken) {
        $env:ENGINE_ADMIN_TOKEN = $oldEngineAdminToken
    } else {
        Remove-Item Env:ENGINE_ADMIN_TOKEN -ErrorAction SilentlyContinue
    }
    if ($oldAutonomyStartupGraceMs) {
        $env:AUTONOMY_STARTUP_GRACE_MS = $oldAutonomyStartupGraceMs
    } else {
        Remove-Item Env:AUTONOMY_STARTUP_GRACE_MS -ErrorAction SilentlyContinue
    }
    if ($oldPlayerEscrowSharedCheckpoint) {
        $env:PLAYER_ESCROW_SHARED_CHECKPOINT = $oldPlayerEscrowSharedCheckpoint
    } else {
        Remove-Item Env:PLAYER_ESCROW_SHARED_CHECKPOINT -ErrorAction SilentlyContinue
    }
    if ($oldPlayerCheckpointDatabase) {
        $env:PLAYER_CHECKPOINT_DATABASE = $oldPlayerCheckpointDatabase
    } else {
        Remove-Item Env:PLAYER_CHECKPOINT_DATABASE -ErrorAction SilentlyContinue
    }
}
