Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-LocalRepoRoot {
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
}

function Get-LocalRuntimeRoot {
    return Join-Path (Get-LocalRepoRoot) '.local'
}

function Get-LocalStatePath {
    return Join-Path (Get-LocalRuntimeRoot) 'runtime.json'
}

function Get-BunExecutable {
    if ($env:APPDATA) {
        $fallback = Join-Path $env:APPDATA 'npm\node_modules\bun\bin\bun.exe'
        if (Test-Path -LiteralPath $fallback) {
            return $fallback
        }
    }

    $command = Get-Command bun.exe, bun.cmd -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($command) {
        return $command.Source
    }

    throw 'Bun nem található. Telepítsd, majd nyiss új terminált, vagy ellenőrizd az APPDATA alatti npm telepítést.'
}

function Resolve-LocalBotNames {
    param(
        [string]$BotName,
        [string[]]$BotNames,
        [string]$FixturePath,
        [switch]$NoBot
    )

    $hasBotNames = $null -ne $BotNames -and $BotNames.Count -gt 0
    if ($NoBot -and ($BotName -or $hasBotNames -or $FixturePath)) {
        throw '-NoBot nem használható BotName, BotNames vagy FixturePath mellett.'
    }
    if ($BotName -and $hasBotNames) {
        throw 'Használd vagy a -BotName, vagy a -BotNames kapcsolót.'
    }
    if ($NoBot) { return @() }

    $resolved = [System.Collections.Generic.List[string]]::new()
    if ($BotName) { $resolved.Add($BotName) }
    foreach ($name in @($BotNames)) { if ($name) { $resolved.Add($name) } }
    if ($FixturePath) {
        $path = if ([System.IO.Path]::IsPathRooted($FixturePath)) {
            [System.IO.Path]::GetFullPath($FixturePath)
        } else {
            [System.IO.Path]::GetFullPath((Join-Path (Get-LocalRepoRoot) $FixturePath))
        }
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "A fixture manifest nem található: $path"
        }
        $fixture = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        $fixtureBots = if ($fixture.PSObject.Properties.Name -contains 'players') {
            @($fixture.players)
        } elseif ($fixture.PSObject.Properties.Name -contains 'bots') {
            @($fixture.bots)
        } else { @() }
        if (-not $fixture.fixtureId -or $fixtureBots.Count -eq 0) {
            throw 'A fixture manifesthez fixtureId és nem üres players vagy bots lista szükséges.'
        }
        foreach ($bot in $fixtureBots) {
            if (-not $bot.username) { throw 'Minden fixture bothoz username szükséges.' }
            $resolved.Add([string]$bot.username)
        }
    }

    $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $result = @()
    foreach ($name in $resolved) {
        $value = $name.Trim()
        if ($value -notmatch '^[a-zA-Z0-9]{1,12}$') { throw "Érvénytelen helyi botnév: $value" }
        if ($seen.Add($value)) { $result += $value }
    }
    return @($result)
}

function Get-LocalRuntimeState {
    $path = Get-LocalStatePath
    if (-not (Test-Path -LiteralPath $path)) {
        return $null
    }

    return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Save-LocalRuntimeState {
    param([Parameter(Mandatory)]$State)

    $runtimeRoot = Get-LocalRuntimeRoot
    New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
    $path = Get-LocalStatePath
    $temporary = "$path.tmp"
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $path -Force
}

function Test-LocalManagedProcess {
    param($Entry)

    if (-not $Entry -or -not $Entry.pid) {
        return $false
    }

    try {
        $process = Get-Process -Id ([int]$Entry.pid) -ErrorAction Stop
        if ($Entry.startedAtUtc) {
            $recorded = if ($Entry.startedAtUtc -is [DateTime]) {
                $Entry.startedAtUtc.ToUniversalTime()
            } else {
                [DateTime]::Parse(
                    [string]$Entry.startedAtUtc,
                    [Globalization.CultureInfo]::InvariantCulture,
                    [Globalization.DateTimeStyles]::RoundtripKind
                ).ToUniversalTime()
            }
            $actual = $process.StartTime.ToUniversalTime()
            return [Math]::Abs(($actual - $recorded).TotalSeconds) -lt 5
        }
        return $true
    } catch {
        return $false
    }
}

function Stop-LocalManagedProcess {
    param($Entry)

    if (-not (Test-LocalManagedProcess $Entry)) {
        return
    }

    Stop-Process -Id ([int]$Entry.pid) -ErrorAction Stop
    try {
        Wait-Process -Id ([int]$Entry.pid) -Timeout 15 -ErrorAction Stop
    } catch {
        Stop-Process -Id ([int]$Entry.pid) -Force -ErrorAction SilentlyContinue
    }
}

function Test-LocalTcpPort {
    param(
        [Parameter(Mandatory)][int]$Port,
        [int]$TimeoutMilliseconds = 500
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        return $task.Wait($TimeoutMilliseconds) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-LocalHttp {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [string]$ExpectedContentType
    )

    try {
        $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3
        $contentType = [string]$response.Headers.'Content-Type'
        $healthy = $response.StatusCode -eq 200
        if ($ExpectedContentType) {
            $healthy = $healthy -and $contentType.StartsWith($ExpectedContentType, [StringComparison]::OrdinalIgnoreCase)
        }

        return [pscustomobject]@{
            healthy = $healthy
            statusCode = $response.StatusCode
            contentType = $contentType
            error = $null
        }
    } catch {
        return [pscustomobject]@{
            healthy = $false
            statusCode = $null
            contentType = $null
            error = $_.Exception.Message
        }
    }
}

function Get-LocalHealth {
    param([string]$BotName, [string[]]$BotNames)

    $state = Get-LocalRuntimeState
    $selectedBotNames = @()
    if ($BotName) { $selectedBotNames += $BotName }
    $selectedBotNames += @($BotNames | Where-Object { $_ })
    if ($selectedBotNames.Count -eq 0 -and $state) {
        if ($state.PSObject.Properties.Name -contains 'botNames') {
            $selectedBotNames = @($state.botNames | ForEach-Object { [string]$_ })
        } elseif (($state.PSObject.Properties.Name -contains 'botName') -and $state.botName) {
            $selectedBotNames = @([string]$state.botName)
        }
    }

    $engineHttp = Test-LocalHttp -Uri 'http://localhost:8888/engine-status'
    $webclientHttp = Test-LocalHttp -Uri 'http://localhost:8888/client/client.js' -ExpectedContentType 'application/javascript'
    $gatewayHttp = Test-LocalHttp -Uri 'http://localhost:7780/status' -ExpectedContentType 'application/json'

    $bots = @($selectedBotNames | ForEach-Object {
        $selectedBotName = $_
        try {
            $botResponse = Invoke-RestMethod -Uri "http://localhost:7780/status/$([Uri]::EscapeDataString($selectedBotName))" -TimeoutSec 3
            [pscustomobject]@{
                name = $selectedBotName
                healthy = $botResponse.status -eq 'active' -and [bool]$botResponse.inGame
                status = $botResponse.status
                inGame = [bool]$botResponse.inGame
                stateAgeMs = $botResponse.stateAge
            }
        } catch {
            [pscustomobject]@{
                name = $selectedBotName
                healthy = $false
                status = 'unreachable'
                inGame = $false
                stateAgeMs = $null
            }
        }
    })

    $processes = @()
    if ($state -and $state.components) {
        $processes = @($state.components | ForEach-Object {
            [pscustomobject]@{
                name = $_.name
                pid = $_.pid
                running = Test-LocalManagedProcess $_
            }
        })
    }

    $healthy = $engineHttp.healthy -and $webclientHttp.healthy -and $gatewayHttp.healthy
    if ($bots.Count -gt 0) { $healthy = $healthy -and @($bots | Where-Object { -not $_.healthy }).Count -eq 0 }

    return [pscustomobject]@{
        healthy = $healthy
        engine = $engineHttp
        webclient = $webclientHttp
        gateway = $gatewayHttp
        bot = if ($bots.Count -gt 0) { $bots[0] } else { $null }
        bots = $bots
        processes = $processes
        runId = if ($state) { $state.runId } else { $null }
        logDirectory = if ($state) { $state.logDirectory } else { $null }
    }
}

function Wait-LocalCondition {
    param(
        [Parameter(Mandatory)][scriptblock]$Condition,
        [Parameter(Mandatory)][string]$Description,
        [int]$TimeoutSeconds = 90
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if (& $Condition) {
            return
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Időtúllépés: $Description"
}
