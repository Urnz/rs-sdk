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

- Read only task-relevant docs and files. Keep searches scoped; normal `rg` searches honor `.rgignore`.
- Use subagents only for substantial independent work. Prefer a few bounded agents; do not delegate trivial inspection, tiny edits, dependent steps, or one slow external operation.
- Spawn with `fork_turns="none"` by default. Give a compact brief with objective, relevant paths/symbols, constraints, established findings, and expected output. Inherit history only when it is genuinely required.
- Do not model-poll long commands. Run verification through `scripts/invoke-verification.ps1`, which blocks, saves the full log, and returns one compact result.
- Windows Bun: do not assume `bun` is on PATH. Use the repository verification tooling, which resolves the Bun runtime. A command that fails to launch is a verification failure and must never be reported as PASS.
- During implementation run the smallest relevant tests. At a meaningful milestone run the affected module/integration suite. Before completion run `bun run verify:full` once when the change warrants the full regression suite.
- Do not repeat a successful check unless relevant code changed, it previously failed, or an unresolved verification concern remains.
- Batch independent deterministic checks into one command when safe. Keep complete verbose output in `.local/verification/`; inspect only failure excerpts or targeted log sections.
- After changes, report the checks run and their outcomes.

## Visualization policy

- This project is being operated from Codex, not Cursor.
- Never create `.canvas.tsx` / Cursor Canvas artifacts.
- Use Codex-native inline visualizations only when they materially help.
- Audit/completion results must always be fully understandable from the normal text response.
- Do not make a visualization the sole location of findings or evidence.
