[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$failures = @()
Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1' -Recurse | ForEach-Object {
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errors)
    foreach ($parseError in @($errors)) {
        $failures += "$($_.FullName):$($parseError.Extent.StartLineNumber): $($parseError.Message)"
    }
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}

. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "rs-sdk-local-runtime-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $fixturePath = Join-Path $testRoot 'fixture.json'
    [ordered]@{ fixtureId = 'test-fixture'; bots = @(
        [ordered]@{ username = 'Worker1' }, [ordered]@{ username = 'Trader1' }
    ) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $fixturePath -Encoding utf8
    $resolved = @(Resolve-LocalBotNames -BotNames @('worker1') -FixturePath $fixturePath)
    if ($resolved.Count -ne 2 -or $resolved[0] -ne 'worker1' -or $resolved[1] -ne 'Trader1') {
        throw 'A fixture botlista feloldása vagy case-insensitive deduplikációja hibás.'
    }
    [ordered]@{ fixtureId = 'proto-fixture'; players = @(
        [ordered]@{ username = 'VRCopper1' }, [ordered]@{ username = 'VRSmith1' }
    ) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $fixturePath -Encoding utf8
    $players = @(Resolve-LocalBotNames -FixturePath $fixturePath)
    if ($players.Count -ne 2 -or $players[0] -ne 'VRCopper1' -or $players[1] -ne 'VRSmith1') {
        throw 'A proto-society players lista feloldása hibás.'
    }
    $withoutBots = @(Resolve-LocalBotNames -NoBot)
    if ($withoutBots.Count -ne 0) { throw 'A -NoBot feloldása nem adott üres botlistát.' }
    $rejected = $false
    try { Resolve-LocalBotNames -BotName '../unsafe' | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Az érvénytelen botnevet a runtime helper nem utasította el.' }
    $legacy = Get-LocalThievingProcessorHealth -State ([pscustomobject]@{ version = 2 }) -Processes @()
    if ($legacy.enabled -or $legacy.running) { throw 'A régi runtime állapot nem teheti kötelezővé a Thieving feldolgozót.' }
    $enabled = [pscustomobject]@{ thievingProcessorEnabled = $true }
    $missing = Get-LocalThievingProcessorHealth -State $enabled -Processes @()
    if (-not $missing.enabled -or $missing.running) { throw 'A hiányzó opt-in feldolgozó állapota hibás.' }
    $stopped = Get-LocalThievingProcessorHealth -State $enabled -Processes @(
        [pscustomobject]@{ name = 'thieving-processor'; pid = 123; running = $false })
    if ($stopped.running -or $stopped.pid -ne 123) { throw 'A leállt feldolgozó állapota hibás.' }
    $running = Get-LocalThievingProcessorHealth -State $enabled -Processes @(
        [pscustomobject]@{ name = 'thieving-processor'; pid = 456; running = $true })
    if (-not $running.running -or $running.pid -ne 456) { throw 'A futó feldolgozó állapota hibás.' }

    $script:testState = [pscustomobject]@{
        runId = 'test'
        logDirectory = $testRoot
        botNames = @()
        components = @([pscustomobject]@{ name = 'thieving-processor'; pid = 456 })
        thievingProcessorEnabled = $true
    }
    function Get-LocalRuntimeState { return $script:testState }
    function Test-LocalHttp { return [pscustomobject]@{ healthy = $true } }
    function Test-LocalManagedProcess { param($Entry) return $Entry.pid -eq 456 }
    if (-not (Get-LocalHealth).healthy) { throw 'A futó opt-in feldolgozó mellett egészségesnek kell lennie a stacknek.' }
    $script:testState.components[0].pid = 123
    if ((Get-LocalHealth).healthy) { throw 'A leállt opt-in feldolgozó mellett hibásnak kell lennie a stacknek.' }
    $script:testState.thievingProcessorEnabled = $false
    if (-not (Get-LocalHealth).healthy) { throw 'Kikapcsolt feldolgozónál a hiánya nem ronthatja a stack állapotát.' }

    $package = Get-Content -Raw -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'package.json') |
        ConvertFrom-Json
    $normalStart = [string]$package.scripts.'local:start'
    if (-not $normalStart.Contains('-GatewayLoginAuthentication') -or
        -not $normalStart.Contains('-EnableThievingProcessor')) {
        throw 'A normál local:start profilnak autentikációval és Thieving feldolgozóval kell indulnia.'
    }
    $completion = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'run-phase22-completion-live.ts')
    if (-not $completion.Contains("'-GatewayLoginAuthentication', '-EnableThievingProcessor'")) {
        throw 'A Phase22 completion runner nem indítja el a production Thieving feldolgozót.'
    }
    foreach ($name in 'run-phase22-recognition-live.ts', 'run-phase22-procedures-live.ts') {
        $acceptanceScript = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot $name)
        if ($acceptanceScript.Contains('ingestEngineThievingOutcome(') -or
            $acceptanceScript.Contains('.decide(') -or $acceptanceScript.Contains('cursor.runPage(')) {
            throw "$name közvetlen downstream adapterrel megkerüli a production watchert."
        }
    }
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}

& (Join-Path $PSScriptRoot 'test-invoke-verification.ps1')
if ($LASTEXITCODE -ne 0) { throw 'A verification wrapper célzott tesztjei hibásak.' }

Write-Host 'Minden PowerShell segéd szintaktikailag érvényes, a fixture és Thieving worker állapotpróbák megfeleltek.'
