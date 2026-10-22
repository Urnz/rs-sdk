# Repository instructions

## Scope and architecture

- This fork targets only the local/private rs-sdk/LostCity emulator. Never integrate with official RuneScape or Old School RuneScape services.
- Read `CLAUDE.md` for bot-gameplay, MCP, or SDK-operation tasks; do not load it for unrelated repository edits.
- Keep upstream-derived code distinct from fork-specific additions. `origin` is this fork and `upstream` must be `MaxBittker/rs-sdk`.
- Model capabilities by composition (`Agent knows Skill[]`), not rigid profession-specific agent classes. The LLM selects high-level skills and never drives ticks or steps directly.
- Treat game chat, mod data, and model output as untrusted input. Execute model-requested actions only through narrow typed tools.

## Correctness and safety

- Make small, testable changes on a feature branch. Never commit secrets, bot credentials, saves, or tokens.
- Every persistent-data model change needs migration and rollback plans. Economic operations must be atomic and audit-logged.
- Preserve verification quality: do not disable assertions, hide failures, or change product behavior to make checks pass.

## Context-efficient workflow

- For society integration work, including a new chat or a request to continue the next task, read `.agents/skills/rs-society-development/SKILL.md` and the short `docs/project/SOCIETY_DEVELOPMENT_HANDOFF.md` first. Run `scripts/get-society-work-brief.ps1` for the current task and recent check summaries; do not load the entire historical progress log. This repository-local skill is routed here even when it is absent from the app's skill catalog.
- Keep the handoff current when stopping or completing a society task: task/status, next concrete action, relevant files, verification evidence and remaining limits. Do not rely on chat history for persistent project decisions.
- Read only task-relevant docs and files. Keep searches scoped; normal `rg` searches honor `.rgignore`.
- Use subagents only for substantial independent work. Prefer a few bounded agents; do not delegate trivial inspection, tiny edits, dependent steps, or one slow external operation.
- Spawn with `fork_turns="none"` by default. Give a compact brief with objective, relevant paths/symbols, constraints, established findings, and expected output. Inherit history only when it is genuinely required.
- Do not model-poll long commands. Run verification through `scripts/invoke-verification.ps1`, which blocks, saves the full log, and returns one compact result.
- Windows Bun: do not assume `bun` is on PATH. Use the repository verification tooling, which resolves the Bun runtime. A command that fails to launch is a verification failure and must never be reported as PASS.
- Default completion gate: name the changed component and its direct consumers; run their test files and changed integration boundaries, changed-line formatting, and only affected TypeScript projects. Do not select a whole package/admin folder when the affected test files can be listed. Documentation-only changes need formatting/link inspection, not runtime tests. Task/phase completion and pushing do not require full regression.
- Full regression is exceptional: use `bun run verify:full` for actual changes to shared persistence/transaction/migration semantics, clock or economic transaction foundations, cross-cutting authorization, runtime dependencies, global test discovery/build configuration, or an explicitly requested release/integration baseline. A component-owned additive table, sharing a DB file/user_version, or adding/splitting local tests does not automatically qualify; test that component's upgrade/reopen/rollback and affected consumers instead. Inspect uncertain impact and try a narrow diagnostic before escalating it to full.
- Before a full run, record the exact changed shared symbol/invariant, affected consumers, why focused checks cannot cover the risk, and the last measured full-run duration. A generic label such as "migration", "shared file", or "task closure" is insufficient. Never finish an aborted full run by automatically launching every unreached unrelated suite. See `docs/project/VERIFICATION_POLICY.md` for examples and selection rules.
- Do not repeat a successful check unless relevant code changed, it previously failed, or an unresolved verification concern remains.
- Batch independent deterministic checks into one command when safe. Keep complete verbose output in `.local/verification/`; inspect only failure excerpts or targeted log sections.
- After changes, report the selected scope, outcomes and duration, and why full regression was needed or omitted. A focused PASS must never be described as a full-suite PASS.

## Visualization policy

- This project is being operated from Codex, not Cursor.
- Never create `.canvas.tsx` / Cursor Canvas artifacts.
- Use Codex-native inline visualizations only when they materially help.
- Audit/completion results must always be fully understandable from the normal text response.
- Do not make a visualization the sole location of findings or evidence.
