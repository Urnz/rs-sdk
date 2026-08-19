[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BackupPath,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')

if (-not $Force) {
    throw 'A visszaállítás felülírja a jelenlegi helyi állapotot. Futtasd újra -Force kapcsolóval.'
}
if (Test-LocalTcpPort -Port 8888) {
    throw 'Az engine fut. Állítsd le a scripts/stop-local.ps1 paranccsal a visszaállítás előtt.'
}

$repoRoot = Get-LocalRepoRoot
$allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'backups'))
$resolvedBackup = [System.IO.Path]::GetFullPath($BackupPath)
$allowedPrefix = $allowedRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedBackup.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "A mentésnek a projekt backups könyvtárán belül kell lennie: $allowedRoot"
}

$manifestPath = Join-Path $resolvedBackup 'manifest.json'
$stateRoot = Join-Path $resolvedBackup 'state'
if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $stateRoot)) {
    throw 'Érvénytelen mentés: hiányzik a manifest.json vagy a state könyvtár.'
}

$safetyName = 'pre-restore-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$safetyBackup = & (Join-Path $PSScriptRoot 'backup-local.ps1') -Name $safetyName | Select-Object -Last 1
Write-Host "Visszaállítás előtti biztonsági mentés: $safetyBackup"

$engineRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'server\engine'))
$playersPath = [System.IO.Path]::GetFullPath((Join-Path $engineRoot 'data\players'))
if (-not $playersPath.StartsWith($engineRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'A players célútvonal kívül esik az engine könyvtárán.'
}

Get-ChildItem -LiteralPath $engineRoot -File | Where-Object { $_.Name -like 'db.sqlite*' } | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Force
}
if (Test-Path -LiteralPath $playersPath) {
    Remove-Item -LiteralPath $playersPath -Recurse -Force
}

$backupEngine = Join-Path $stateRoot 'server\engine'
Get-ChildItem -LiteralPath $backupEngine -File | Where-Object { $_.Name -like 'db.sqlite*' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $engineRoot $_.Name)
}

$backupPlayers = Join-Path $backupEngine 'data\players'
if (Test-Path -LiteralPath $backupPlayers) {
    New-Item -ItemType Directory -Force -Path (Split-Path $playersPath -Parent) | Out-Null
    Copy-Item -LiteralPath $backupPlayers -Destination $playersPath -Recurse
}

$backupWorldConfig = Join-Path $backupEngine 'data\config\world.json'
if (Test-Path -LiteralPath $backupWorldConfig) {
    $configPath = Join-Path $engineRoot 'data\config'
    New-Item -ItemType Directory -Force -Path $configPath | Out-Null
    Copy-Item -LiteralPath $backupWorldConfig -Destination (Join-Path $configPath 'world.json') -Force
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
foreach ($file in @($manifest.files)) {
    $restored = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ([string]$file.path)))
    if (-not $restored.StartsWith($repoRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "A manifest érvénytelen útvonalat tartalmaz: $($file.path)"
    }
    if (-not (Test-Path -LiteralPath $restored)) {
        throw "A visszaállított fájl hiányzik: $($file.path)"
    }
    $actualHash = (Get-FileHash -LiteralPath $restored -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $file.sha256) {
        throw "Ellenőrzőösszeg eltérés: $($file.path)"
    }
}

Write-Host "Visszaállítás és SHA-256 ellenőrzés sikeres: $resolvedBackup"
