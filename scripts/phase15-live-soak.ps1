[CmdletBinding()]
param(
    [ValidateRange(60, 90)][int]$DurationMinutes = 60,
    [ValidateRange(1, 89)][int]$RestartAfterMinutes = 30,
    [ValidateRange(15, 300)][int]$SnapshotIntervalSeconds = 60,
    [string]$FixturePath = 'config/fixtures/varrock-proto-v1.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($RestartAfterMinutes -ge $DurationMinutes) {
    throw 'RestartAfterMinutes must be lower than DurationMinutes.'
}

. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')

$repoRoot = Get-LocalRepoRoot
$soakRoot = Join-Path $repoRoot '.local\phase15-soak'
$sessionId = "phase15-soak-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$sessionDirectory = Join-Path $soakRoot $sessionId
$sessionPath = Join-Path $sessionDirectory 'session.json'
$snapshotsPath = Join-Path $sessionDirectory 'snapshots.jsonl'
$restartOutputPath = Join-Path $sessionDirectory 'restart.log'
$activePath = Join-Path $soakRoot 'active.json'
$fixtureFullPath = if ([System.IO.Path]::IsPathRooted($FixturePath)) {
    [System.IO.Path]::GetFullPath($FixturePath)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $FixturePath))
}

if (-not (Test-Path -LiteralPath $fixtureFullPath -PathType Leaf)) {
    throw "Fixture not found: $fixtureFullPath"
}

$fixture = Get-Content -LiteralPath $fixtureFullPath -Raw | ConvertFrom-Json
$agentIds = @($fixture.players | ForEach-Object { [string]$_.agentId })
$botNames = @($fixture.players | ForEach-Object { [string]$_.username })
if ($agentIds.Count -lt 6 -or $agentIds.Count -ne $botNames.Count) {
    throw 'The live soak fixture must contain at least six player agents with bot usernames.'
}

New-Item -ItemType Directory -Force -Path $sessionDirectory | Out-Null

$startedAt = [DateTime]::UtcNow
$session = [ordered]@{
    schemaVersion = 1
    sessionId = $sessionId
    fixtureId = [string]$fixture.fixtureId
    fixtureVersion = [string]$fixture.fixtureVersion
    fixturePath = $fixtureFullPath
    agentIds = $agentIds
    botNames = $botNames
    durationMinutes = $DurationMinutes
    snapshotIntervalSeconds = $SnapshotIntervalSeconds
    startedAt = $startedAt.ToString('o')
    plannedFinishedAt = $startedAt.AddMinutes($DurationMinutes).ToString('o')
    status = 'running'
    processId = $PID
    initialRunId = $null
    finalRunId = $null
    finishedAt = $null
    plannedOperatorInterventions = @(
        [ordered]@{
            kind = 'gateway-engine-stack-restart'
            plannedElapsedMinutes = $RestartAfterMinutes
            status = 'pending'
            startedAt = $null
            finishedAt = $null
            beforeRunId = $null
            afterRunId = $null
            error = $null
        }
    )
    unplannedOperatorInterventions = @()
    error = $null
}

function Save-SoakSession {
    $temporary = "$sessionPath.tmp"
    $session | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $sessionPath -Force
    [ordered]@{
        schemaVersion = 1
        sessionId = $sessionId
        sessionPath = $sessionPath
        processId = $PID
        status = $session.status
        updatedAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $activePath -Encoding utf8
}

function Add-SoakSnapshot {
    param([Parameter(Mandatory)][string]$Kind)

    $capturedAt = [DateTime]::UtcNow
    $runtime = Get-LocalRuntimeState
    $health = Get-LocalHealth -BotNames $botNames
    $autonomy = $null
    $captureError = $null
    try {
        $response = Invoke-RestMethod -Uri 'http://localhost:7780/api/admin/autonomy/status' -TimeoutSec 10
        $autonomy = @($response.agents | Where-Object { $agentIds -contains $_.agentId })
    } catch {
        $captureError = $_.Exception.Message
    }

    $snapshot = [ordered]@{
        schemaVersion = 1
        sessionId = $sessionId
        kind = $Kind
        capturedAt = $capturedAt.ToString('o')
        elapsedSeconds = [Math]::Round(($capturedAt - $startedAt).TotalSeconds, 3)
        runId = if ($runtime) { [string]$runtime.runId } else { $null }
        health = $health
        autonomy = $autonomy
        captureError = $captureError
    }
    Add-Content -LiteralPath $snapshotsPath -Value ($snapshot | ConvertTo-Json -Depth 12 -Compress) -Encoding utf8
    return $snapshot
}

try {
    $initialHealth = Get-LocalHealth -BotNames $botNames
    if (-not $initialHealth.healthy) {
        throw 'The managed local stack and every fixture bot must be healthy before the soak starts.'
    }
    $session.initialRunId = [string]$initialHealth.runId
    Save-SoakSession
    Add-SoakSnapshot -Kind 'started' | Out-Null
    Write-Host "SOAK_STARTED session=$sessionId run=$($session.initialRunId) durationMinutes=$DurationMinutes"

    $restartDone = $false
    $deadline = $startedAt.AddMinutes($DurationMinutes)
    $restartAt = $startedAt.AddMinutes($RestartAfterMinutes)
    while ([DateTime]::UtcNow -lt $deadline) {
        $now = [DateTime]::UtcNow
        if (-not $restartDone -and $now -ge $restartAt) {
            $intervention = $session.plannedOperatorInterventions[0]
            $before = Add-SoakSnapshot -Kind 'pre-restart'
            $intervention.status = 'running'
            $intervention.startedAt = [DateTime]::UtcNow.ToString('o')
            $intervention.beforeRunId = $before.runId
            Save-SoakSession
            try {
                & (Join-Path $PSScriptRoot 'stop-local.ps1') *>&1 |
                    Set-Content -LiteralPath $restartOutputPath -Encoding utf8
                & (Join-Path $PSScriptRoot 'start-local.ps1') -FixturePath $FixturePath *>&1 |
                    Add-Content -LiteralPath $restartOutputPath -Encoding utf8
                $after = Add-SoakSnapshot -Kind 'post-restart'
                if (-not $after.health.healthy) {
                    throw 'The stack did not become healthy after the planned restart.'
                }
                $intervention.afterRunId = $after.runId
                $intervention.status = 'completed'
                $intervention.finishedAt = [DateTime]::UtcNow.ToString('o')
                $restartDone = $true
                Save-SoakSession
                Write-Host "SOAK_RESTART_COMPLETED before=$($intervention.beforeRunId) after=$($intervention.afterRunId)"
            } catch {
                $intervention.status = 'failed'
                $intervention.finishedAt = [DateTime]::UtcNow.ToString('o')
                $intervention.error = $_.Exception.Message
                Save-SoakSession
                throw
            }
        } else {
            $snapshot = Add-SoakSnapshot -Kind 'periodic'
            $healthyAgentCount = @($snapshot.autonomy | Where-Object {
                $_.status -notin @('offline', 'quarantined', 'paused')
            }).Count
            Write-Host "SOAK_SNAPSHOT at=$($snapshot.capturedAt) run=$($snapshot.runId) healthy=$($snapshot.health.healthy) activeAgents=$healthyAgentCount"
        }

        $remainingSeconds = [Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalSeconds)
        if ($remainingSeconds -gt 0) {
            Start-Sleep -Seconds ([Math]::Min($SnapshotIntervalSeconds, [Math]::Ceiling($remainingSeconds)))
        }
    }

    if (-not $restartDone) {
        throw 'The soak reached its deadline without completing the planned restart.'
    }
    $finalSnapshot = Add-SoakSnapshot -Kind 'finished'
    if (-not $finalSnapshot.health.healthy) {
        throw 'The stack was unhealthy at the end of the soak.'
    }
    $session.status = 'completed'
    $session.finalRunId = $finalSnapshot.runId
    $session.finishedAt = [DateTime]::UtcNow.ToString('o')
    Save-SoakSession
    Write-Host "SOAK_COMPLETED session=$sessionId run=$($session.finalRunId)"
} catch {
    $session.status = 'failed'
    $session.finishedAt = [DateTime]::UtcNow.ToString('o')
    $session.error = $_.Exception.Message
    Save-SoakSession
    Write-Error $_
    exit 1
}
