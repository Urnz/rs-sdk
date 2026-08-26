[CmdletBinding()]
param(
    [string]$BotName,
    [switch]$NoBot,
    [int]$TimeoutSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')

$repoRoot = Get-LocalRepoRoot
$bun = Get-BunExecutable
$runtimeRoot = Get-LocalRuntimeRoot

if (-not $NoBot -and -not $BotName) {
    $candidates = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'bots') -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne '_template' })
    if ($candidates.Count -eq 1) {
        $BotName = $candidates[0].Name
    }
}

$existingHealth = Get-LocalHealth -BotName $BotName
if ($existingHealth.healthy) {
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
    version = 1
    runId = $runId
    startedAtUtc = [DateTime]::UtcNow.ToString('o')
    logDirectory = $logDirectory
    botName = if ($NoBot) { $null } else { $BotName }
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
$oldEngineAdminToken = [Environment]::GetEnvironmentVariable('ENGINE_ADMIN_TOKEN', 'Process')
$env:ENGINE_ADMIN_TOKEN = if ($oldEngineAdminToken) { $oldEngineAdminToken } else { [Guid]::NewGuid().ToString('N') }

try {
    Start-LocalComponent -Name 'gateway' -WorkingDirectory (Join-Path $repoRoot 'server\gateway') -Arguments @('run', 'gateway.ts') | Out-Null
    Wait-LocalCondition -Description 'gateway /status' -TimeoutSeconds $TimeoutSeconds -Condition {
        (Test-LocalHttp -Uri 'http://localhost:7780/status' -ExpectedContentType 'application/json').healthy
    }

    $env:EASY_STARTUP = 'true'
    $env:WEBSITE_REGISTRATION = 'false'
    Start-LocalComponent -Name 'engine' -WorkingDirectory (Join-Path $repoRoot 'server\engine') -Arguments @('run', 'src/app.ts') | Out-Null
    Wait-LocalCondition -Description 'engine /engine-status' -TimeoutSeconds $TimeoutSeconds -Condition {
        (Test-LocalHttp -Uri 'http://localhost:8888/engine-status').healthy
    }
    Wait-LocalCondition -Description 'webclient JavaScript modul' -TimeoutSeconds $TimeoutSeconds -Condition {
        (Test-LocalHttp -Uri 'http://localhost:8888/client/client.js' -ExpectedContentType 'application/javascript').healthy
    }

    # Only gateway and engine need the internal mutation token. Do not pass it to bot clients.
    Remove-Item Env:ENGINE_ADMIN_TOKEN -ErrorAction SilentlyContinue

    if (-not $NoBot -and $BotName) {
        $botDirectory = Join-Path $repoRoot "bots\$BotName"
        if (-not (Test-Path -LiteralPath (Join-Path $botDirectory 'bot.env'))) {
            throw "A bot nem található vagy nincs bot.env fájlja: $BotName"
        }

        Start-LocalComponent -Name 'bot' -WorkingDirectory (Join-Path $repoRoot 'server\webclient') `
            -Arguments @('run', 'src/lite/runner.ts', $BotName) | Out-Null
        Wait-LocalCondition -Description "$BotName bot bejelentkezése" -TimeoutSeconds $TimeoutSeconds -Condition {
            (Get-LocalHealth -BotName $BotName).bot.healthy
        }
    }

    $health = Get-LocalHealth -BotName $(if ($NoBot) { $null } else { $BotName })
    Write-Host "Helyi stack elindult. Naplók: $logDirectory"
    $health | ConvertTo-Json -Depth 6
} catch {
    for ($index = $state.components.Count - 1; $index -ge 0; $index--) {
        Stop-LocalManagedProcess $state.components[$index]
    }
    Remove-Item -LiteralPath (Get-LocalStatePath) -Force -ErrorAction SilentlyContinue
    throw
} finally {
    $env:EASY_STARTUP = $oldEasyStartup
    $env:WEBSITE_REGISTRATION = $oldRegistration
    if ($oldEngineAdminToken) {
        $env:ENGINE_ADMIN_TOKEN = $oldEngineAdminToken
    } else {
        Remove-Item Env:ENGINE_ADMIN_TOKEN -ErrorAction SilentlyContinue
    }
}
