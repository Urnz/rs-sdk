---
name: rs-society-development
description: Continue or close SI society integration tasks in the local/private rs-sdk repository, with compact handoffs, targeted verification and bounded native experiments. Use for SI phase development and integration tooling, including resuming in a new chat.
---

# Society development

Resolve paths from the rs-sdk repository root. This is a repository-local
development skill, not a gameplay capability to publish in the skill catalog.
`AGENTS.override.md` routes subsequent chats here; app-level skill discovery
is not required. It grants no additional runtime or publication authority.

## Resume with a small context

Read `docs/project/SOCIETY_DEVELOPMENT_HANDOFF.md`, then run:

```powershell
pwsh -NoProfile -File scripts/get-society-work-brief.ps1
```

The command reads the roadmap and a bounded set of verification result headers;
it does not start a world, copy backups or open databases. Use `-TaskId SI-B01`
to select a task explicitly. Its suggested next task is document order, not an
automatic dependency approval. Recent PASS entries are historical evidence,
not proof that current code is tested. Read only the selected task, affected
implementation and necessary linked references; search old progress by ID or
failure signature rather than loading it all.

The roadmap owns task checkboxes. The handoff owns the current action and evidence
index. If they disagree, inspect the latest dated decision and correct the
documents before asserting closure. Do not turn an inconclusive result into PASS.

## Implement and verify

Follow `docs/project/SOCIETY_DEVELOPMENT_WORKFLOW.md` for live experiment gates,
workspace selection and the pending archive optimization. Follow
`docs/project/VERIFICATION_POLICY.md` for test selection; do not duplicate its
rules or request full regression just because a task or phase is closing.
Choose component-level test files, not whole package folders by habit. A new
component-owned additive table in an existing DB is not an automatic full trigger.
Use the policy's shared-invariant/consumers/coverage/cost justification before
escalating to full; do not automatically resume unrelated suites after a failed full.

Build a thin real integration path early, alongside module tests. Before an
expensive run, record the hypothesis, native boundary, expected evidence,
clock/source identity, time/cost limits and stop conditions in the handoff or
the task's run plan. Exercise cheap preconditions before starting the timer.
After failure, preserve evidence, reproduce narrowly and verify the fix before
another soak. After two consecutive expensive failures, reassess the approach
and use a smaller diagnostic; reassessment does not itself require user approval.

Use `scripts/invoke-verification.ps1` for checks. Keep full logs local and return
only summaries/failure excerpts. Keep source immutable while a baseline or
source-bound run is being captured. Prefer existing valid workspaces for narrow
diagnostics; use the existing reduced food-trial profile only where its coverage
fits. A trial profile is not a final integration baseline. Never share mutable
SQLite files by hardlink or alter historical result bundles to save space.

## Leave a resumable result

Update the handoff at a task boundary, a meaningful interruption or a change of
approach: current ID/status; next concrete action; affected paths; successful and
failed checks with result paths and durations; source/workspace identity if live;
remaining limits. Replace stale current instructions rather than appending a
second long history. Detailed evidence stays in the task document/progress log.

On closure, make the roadmap's current state and next-phase entry explicit at
both the task and phase boundary. Separate mechanical correctness, autonomous
performance and realism calibration. Do not start the next task unless requested.
