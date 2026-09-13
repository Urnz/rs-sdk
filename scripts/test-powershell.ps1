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
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}

Write-Host 'Minden PowerShell segéd szintaktikailag érvényes, a fixture botlista feloldása megfelelt.'
