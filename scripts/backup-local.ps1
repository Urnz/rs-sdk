[CmdletBinding()]
param([string]$Name)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')

if (Test-LocalTcpPort -Port 8888) {
    throw 'Az engine fut. Állítsd le a scripts/stop-local.ps1 paranccsal, majd készíts mentést.'
}

if (-not $Name) {
    $Name = Get-Date -Format 'yyyyMMdd-HHmmss'
}
if ($Name -notmatch '^[A-Za-z0-9._-]+$') {
    throw 'A mentés neve csak betűt, számot, pontot, aláhúzást és kötőjelet tartalmazhat.'
}

$repoRoot = Get-LocalRepoRoot
$backupRoot = Join-Path $repoRoot 'backups'
$destination = Join-Path $backupRoot $Name
if (Test-Path -LiteralPath $destination) {
    throw "A mentés már létezik: $destination"
}

$stateRoot = Join-Path $destination 'state\server\engine'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$engineRoot = Join-Path $repoRoot 'server\engine'

Get-ChildItem -LiteralPath $engineRoot -File | Where-Object { $_.Name -like 'db.sqlite*' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stateRoot $_.Name)
}

$playersSource = Join-Path $engineRoot 'data\players'
if (Test-Path -LiteralPath $playersSource) {
    $playersDestination = Join-Path $stateRoot 'data\players'
    New-Item -ItemType Directory -Force -Path (Split-Path $playersDestination -Parent) | Out-Null
    Copy-Item -LiteralPath $playersSource -Destination $playersDestination -Recurse
}

$worldConfig = Join-Path $engineRoot 'data\config\world.json'
if (Test-Path -LiteralPath $worldConfig) {
    $configDestination = Join-Path $stateRoot 'data\config'
    New-Item -ItemType Directory -Force -Path $configDestination | Out-Null
    Copy-Item -LiteralPath $worldConfig -Destination (Join-Path $configDestination 'world.json')
}

$stateContainer = Join-Path $destination 'state'
$files = @(Get-ChildItem -LiteralPath $stateContainer -Recurse -File | ForEach-Object {
    [pscustomobject]@{
        path = [System.IO.Path]::GetRelativePath($stateContainer, $_.FullName).Replace('\', '/')
        size = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
})

if ($files.Count -eq 0) {
    throw 'Nem található menthető szerverállapot.'
}

$manifest = [ordered]@{
    version = 1
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    sourceCommit = (git -C $repoRoot rev-parse HEAD).Trim()
    files = $files
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $destination 'manifest.json') -Encoding utf8

Write-Host "Mentés elkészült: $destination"
Write-Output $destination
