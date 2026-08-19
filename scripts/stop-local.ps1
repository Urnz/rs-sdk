[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\local-runtime.ps1')

$state = Get-LocalRuntimeState
if (-not $state) {
    Write-Host 'Nincs a fejlesztői indító által kezelt futó stack.'
    exit 0
}

$components = @($state.components)
for ($index = $components.Count - 1; $index -ge 0; $index--) {
    $entry = $components[$index]
    Write-Host "Leállítás: $($entry.name) (PID $($entry.pid))"
    Stop-LocalManagedProcess $entry
}

Remove-Item -LiteralPath (Get-LocalStatePath) -Force -ErrorAction SilentlyContinue
Write-Host "A helyi stack leállt. A naplók megmaradtak: $($state.logDirectory)"
