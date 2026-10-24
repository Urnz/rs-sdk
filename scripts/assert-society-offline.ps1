[CmdletBinding()]
param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][int]$CallerPid)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoPath = [IO.Path]::GetFullPath($Root)
# The explicit --offline assertion covers unregistered/custom writers as well.
# Detect managed processes, known runtime commands and listeners; never stop them here.
$runtimePath = Join-Path $repoPath '.local/runtime.json'
if (Test-Path -LiteralPath $runtimePath) {
    $runtimeState = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
    foreach ($component in @($runtimeState.components)) {
        if (Get-Process -Id ([int]$component.pid) -ErrorAction SilentlyContinue) { throw "Managed writer is still running: $($component.name)" }
    }
}
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in @(7780, 8888, 3000) })
if ($listeners.Count -gt 0) { throw 'Local stack listener is still running. Stop the stack and custom writers before capture.' }
$processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
foreach ($entry in $processes) {
    if ($entry.ProcessId -eq $CallerPid -or $entry.ProcessId -eq $PID) { continue }
    $commandText = [string]$entry.CommandLine
    if ($entry.Name -match '^(bun|node|java)(\.exe)?$' -and
        ($commandText -match [regex]::Escape($repoPath) -or
         $commandText -match '(server[\\/]gateway|server[\\/]control-plane[\\/]managed-worker\.ts|agent-state[\\/]run|agent-skills[\\/]run|thieving-procedures[\\/]watch|run-society-experiment|src[\\/]app\.ts|src[\\/]web\.ts)')) {
        throw "Possible society writer is still running (PID $($entry.ProcessId))."
    }
}
Write-Output 'offline probes passed'
