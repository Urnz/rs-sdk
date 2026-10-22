[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Split-Path $PSScriptRoot -Parent),
    [ValidatePattern('^SI-[A-F][0-9]{2}$')][string]$TaskId,
    [ValidateRange(0, 10)][int]$RecentChecks = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$roadmapPath = Join-Path $root 'docs/project/TASKS_SOCIETY_INTEGRATION.md'
$roadmap = Get-Content -LiteralPath $roadmapPath -Raw
$pattern = '(?ms)^### (?<id>SI-[A-F][0-9]{2})[^\r\n]*\r?\n(?<body>.*?)(?=^### SI-|^## |\z)'
$tasks = @([regex]::Matches($roadmap, $pattern) | ForEach-Object {
        $status = [regex]::Match($_.Groups['body'].Value, '(?m)^- \*\*Státusz/típus/prioritás:\*\* \[(?<done>[ xX])\]')
        if (-not $status.Success) { throw "Missing checkbox for $($_.Groups['id'].Value)" }
        [pscustomobject]@{
            id = $_.Groups['id'].Value
            completed = $status.Groups['done'].Value -match '[xX]'
            text = $_.Value.Trim()
        }
    })
if ($tasks.Count -eq 0) { throw 'No society tasks found in roadmap.' }
if (@($tasks | Group-Object id | Where-Object Count -gt 1).Count -gt 0) {
    throw 'Duplicate society task IDs in roadmap.'
}
$selected = if ($TaskId) {
    $tasks | Where-Object id -eq $TaskId | Select-Object -First 1
} else {
    $tasks | Where-Object { -not $_.completed } | Select-Object -First 1
}
if ($TaskId -and $null -eq $selected) { throw "Unknown society task: $TaskId" }

$warnings = @()
$checks = @()
$logDirectory = Join-Path $root '.local/verification'
if ($RecentChecks -gt 0 -and (Test-Path -LiteralPath $logDirectory -PathType Container)) {
    # Headers only, bounded reads; never recurse through worlds or read log bodies.
    $headers = @(Get-ChildItem -LiteralPath $logDirectory -Filter '*.result.json' -File |
            Sort-Object Name -Descending | Select-Object -First $RecentChecks)
    foreach ($header in $headers) {
        try {
            if ($header.Length -gt 65536) { throw 'Oversized verification header.' }
            $data = Get-Content -LiteralPath $header.FullName -Raw | ConvertFrom-Json -AsHashtable
            if ($data.version -ne 1 -or $data.name -isnot [string] -or
                $data.outcome -notin @('SUCCESS', 'PROCESS_FAILED', 'NOT_STARTED') -or
                $data.durationSeconds -isnot [ValueType] -or
                -not [double]::IsFinite([double]$data.durationSeconds) -or $data.durationSeconds -lt 0 -or
                $data.exitCode -isnot [long] -and $data.exitCode -isnot [int] -or
                ($data.outcome -eq 'SUCCESS') -ne ($data.exitCode -eq 0)) {
                throw 'Invalid verification header.'
            }
            [void][DateTimeOffset]::Parse($data.finishedAt)
            $checks += [pscustomobject]@{
                name = $data.name; outcome = $data.outcome; exitCode = $data.exitCode
                durationSeconds = [math]::Round([double]$data.durationSeconds, 3)
                finishedAt = $data.finishedAt; resultFile = $header.FullName
            }
        } catch {
            $warnings += "Unreadable or invalid verification header: $($header.Name)"
        }
    }
}

[ordered]@{
    roadmap = $roadmapPath
    handoff = Join-Path $root 'docs/project/SOCIETY_DEVELOPMENT_HANDOFF.md'
    selection = 'Document order only; inspect dependencies and the handoff before implementation.'
    tasks = [ordered]@{ total = $tasks.Count; completed = @($tasks | Where-Object completed).Count }
    selectedTask = $selected
    recentChecks = $checks
    evidenceLimit = 'Historical headers only; no current-code validation, token estimate or summed wall time.'
    warnings = $warnings
} | ConvertTo-Json -Depth 6
