[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$brief = Join-Path $PSScriptRoot 'get-society-work-brief.ps1'
$testParent = Join-Path (Split-Path $PSScriptRoot -Parent) '.local/verification'
$testRoot = Join-Path $testParent "work-brief-test-$([Guid]::NewGuid().ToString('N'))"
$docs = Join-Path $testRoot 'docs/project'
$logs = Join-Path $testRoot '.local/verification'
[void](New-Item -ItemType Directory -Path $docs, $logs -Force)
$roadmapPath = Join-Path $docs 'TASKS_SOCIETY_INTEGRATION.md'
$fixture = @'
## SI-A
### SI-A15 – Closed
- **Státusz/típus/prioritás:** [x] VÉGREHAJTÁS
Old text: SI-A15 nyitott.
## SI-B
### SI-B01 – Next
- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS
Evidence: source change → inbox.
### SI-B02 – Later
- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS
'@
function Assert-Rejected {
    param([scriptblock]$Action)
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Expected invalid input to be rejected.' }
}
try {
    Set-Content -LiteralPath $roadmapPath -Value $fixture -Encoding utf8
    $result = & $brief -RepositoryRoot $testRoot | ConvertFrom-Json
    if ($result.selectedTask.id -ne 'SI-B01' -or $result.tasks.completed -ne 1 -or
        $result.tasks.total -ne 3 -or $result.recentChecks.Count -ne 0 -or
        $result.selectedTask.text.Contains('SI-B02')) { throw 'Task selection crossed a boundary or used historical prose.' }
    $explicit = & $brief -RepositoryRoot $testRoot -TaskId SI-A15 -RecentChecks 0 | ConvertFrom-Json
    if (-not $explicit.selectedTask.completed) { throw 'Explicit completed task selection failed.' }
    Assert-Rejected { & $brief -RepositoryRoot $testRoot -TaskId SI-F99 }

    $valid = @{ version = 1; name = 'failed-native-check'; outcome = 'PROCESS_FAILED'; exitCode = 7
        durationSeconds = 2.5; finishedAt = '2026-10-22T12:00:00Z'; command = 'private-command-must-not-appear' }
    $valid | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs '20261022-1200-failed.result.json')
    Set-Content -LiteralPath (Join-Path $logs '20261022-1300-bad.result.json') -Value '{broken'
    $serialized = & $brief -RepositoryRoot $testRoot -RecentChecks 2
    $withLogs = $serialized | ConvertFrom-Json
    if ($withLogs.recentChecks.Count -ne 1 -or $withLogs.recentChecks[0].exitCode -ne 7 -or
        $withLogs.warnings.Count -ne 1 -or ($serialized -join '').Contains('private-command-must-not-appear')) {
        throw 'Failed/malformed evidence was hidden, or raw command leaked into the brief.'
    }
    $limited = & $brief -RepositoryRoot $testRoot -RecentChecks 1 | ConvertFrom-Json
    if ($limited.recentChecks.Count -ne 0 -or $limited.warnings.Count -ne 1) { throw 'Header reads were not bounded.' }
    $valid.outcome = 'SUCCESS'
    $valid | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs '20261022-1400-inconsistent.result.json')
    $inconsistent = & $brief -RepositoryRoot $testRoot -RecentChecks 1 | ConvertFrom-Json
    if ($inconsistent.warnings.Count -ne 1 -or $inconsistent.recentChecks.Count -ne 0) { throw 'False SUCCESS accepted.' }
    $valid.outcome = 'NOT_STARTED'
    $valid.exitCode = 127
    $valid | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs '20261022-1500-not-started.result.json')
    $notStarted = & $brief -RepositoryRoot $testRoot -RecentChecks 1 | ConvertFrom-Json
    if ($notStarted.recentChecks.Count -ne 1 -or $notStarted.recentChecks[0].outcome -ne 'NOT_STARTED') {
        throw 'Wrapper launch failure was not preserved.'
    }

    Set-Content -LiteralPath $roadmapPath -Value $fixture.Replace('[ ]', '[x]')
    $closed = & $brief -RepositoryRoot $testRoot -RecentChecks 0 | ConvertFrom-Json
    if ($null -ne $closed.selectedTask -or $closed.tasks.completed -ne 3) { throw 'All-closed roadmap selected a task.' }
    Set-Content -LiteralPath $roadmapPath -Value ($fixture + "`n" + $fixture)
    Assert-Rejected { & $brief -RepositoryRoot $testRoot }
    Set-Content -LiteralPath $roadmapPath -Value $fixture.Replace('[ ]', '[?]')
    Assert-Rejected { & $brief -RepositoryRoot $testRoot }
    Write-Host 'Society work brief: selection, boundaries, invalid input, bounded headers and evidence privacy PASS.'
} finally {
    $resolvedTarget = [System.IO.Path]::GetFullPath($testRoot)
    $allowedParent = [System.IO.Path]::GetFullPath($testParent).TrimEnd('\') + '\'
    if (-not $resolvedTarget.StartsWith($allowedParent, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing cleanup outside the verification directory.'
    }
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
}
