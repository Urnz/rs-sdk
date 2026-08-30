# Agent-skill framework

This module turns repeatable bot behaviour into validated, versioned skill
documents. A skill contains parameters, preconditions, bounded steps, provenance,
sharing policy, and execution limits. It cannot contain JavaScript or request
arbitrary file, network, shell, engine, or official-OSRS access.

## Layout

- `types.ts` – stable contracts for definitions, runs, results, and events.
- `validation.ts` – strict validation for untrusted/LLM-authored documents.
- `registry.ts` – immutable `id@version` registry and discovery queries.
- `store.ts` – atomic shared/private JSON persistence.
- `knowledge.ts` – per-agent `Skill[]` knowledge and sharing-mode switch.
- `library.ts` – reviewed catalog, generated-draft orchestration, and verified promotion.
- `verifier.ts` – deterministic policy checks, live-run evidence validation, and immutable reports.
- `capability-gaps.ts` – persistent, deduplicated capability backlog and deterministic skill resolver.
- `builder.ts` – bounded non-player worker boundary for declarative skill-draft proposals.
- `openai-builder-provider.ts` – tool-free Responses API structured-output adapter.
- `executor.ts` – limits, retries, cancellation, repeat conditions, and audit events.
- `journal.ts` – immutable per-run JSON audit records.
- `rs-sdk-runtime.ts` – adapter from approved operations to `BotActions`/`BotSDK`.
- `catalog/` – source-controlled skills reviewed by a human or verifier.
- `test/` – deterministic tests with no running game or LLM required.

Runtime-generated documents belong under `.local/agent-skills/` and are ignored
by Git. Shared skills are visible to every agent; private skills are only loaded
for their owner. CLI runs are recorded under `.local/agent-skills/runs/<run-id>.json`.
Unresolved planner needs are stored in `.local/agent-skills/capability-gaps.json`.
Their semantic fingerprint deliberately excludes the requesting agent and goal,
so multiple agents needing the same capability share one work item while retaining
their individual requester history and request counts. Automatic planning pauses
per agent and strategic anchor while the gap is active. Verification creates a
durable, once-delivered wakeup; offline agents retain it for a later retry.

The Skill Builder claims one open gap atomically and receives only gap metadata,
reviewed skill summaries, and the declarative operation allowlist. Provider output
cannot set provenance, status, sharing, code, shell, files, network access, or game
control. The service stamps a shared agent draft, runs strict schema validation,
persists per-gap attempts and cost, and applies a cooldown to retryable failures.
Static acceptance creates a draft only. The admin AI tab can start an isolated
trial for one explicitly selected online test bot. Trial records pin the exact
draft version, parameters, target version, and accepted run IDs under
`.local/agent-skills/trials.json`. Normal bot and planner routes cannot opt into
draft execution.

After at least two matching successful runs, the deterministic verifier writes an
immutable report under `.local/agent-skills/verifications/`. A passing report still
does not publish anything: the operator must review it and use the separate human
approval action. Only that action writes the new verified version and resolves the
capability gap. Failed reports remain visible and the same bounded trial may gather
new independent evidence.

The gateway scheduler is disabled by default and configured in the admin AI tab.
When explicitly enabled it uses the server-local write-only OpenAI key, processes
at most one eligible gap per interval, prevents overlapping runs, and records a
separate JSONL cost ledger. Per-gap attempts/cost, cooldown, daily server cost,
duration, and output-token limits all fail closed before another automatic call.

## Trust lifecycle

1. A human or agent creates a schema-versioned document.
2. Agent-authored submissions must identify their author and remain `draft`.
3. Validation rejects unknown operations, unbounded loops, invalid inputs, and
   attempts to claim verified status.
4. Draft execution requires explicit `allowDraft: true` and still obeys all limits.
5. The deterministic verifier requires a shared agent draft, a newer target
   version, a bounded operation budget, resolved parameters, and at least two
   unique successful live runs recorded with those exact parameters.
6. A passing report prepares a new immutable, system-authored `verified` version;
   the admin workflow publishes it only after a separate human approval. A failing
   report is retained but never publishes a skill.
7. `shared-library` agents can discover verified shared skills. In an
   `isolated-discovery` simulation they only discover skills authored by themselves.

Changing an existing `id@version` is rejected. Improvements must publish a new
semantic version, so another agent can reproduce exactly what it learned.

## Existence, access, and knowledge

These are separate states. `SkillRegistry.describe()` can establish that an exact
immutable version exists without exposing a private definition. The deterministic
`inspectSkillRelationship()` policy then evaluates whether that agent may access
the version under shared or isolated discovery. Finally, per-agent knowledge is
`unlearned`, `known`, `preferred`, or `blocked`. A skill is executable only when it
exists, is accessible, is verified, and that agent has explicitly learned it.

Finding a matching verified shared skill therefore returns an accessible catalog
discovery with `requiresLearning: true`; it does not add knowledge and is not sent
to the LLM as an allowed tool. Blocked versions are excluded even when globally
shared. The admin Agent view displays learned skills separately from accessible but
unlearned catalog entries, and recording learning remains an explicit audited action.

## Minimal use

```typescript
import { join } from 'node:path';
import { runScript } from '../sdk/runner';
import {
    FileSkillStore,
    RsSdkSkillRuntime,
    SkillExecutor,
    SkillLibrary,
    SkillRegistry
} from '../agent-skills';

await runScript(async ({ bot, sdk }) => {
    const library = new SkillLibrary(
        new SkillRegistry(),
        new FileSkillStore(join(process.cwd(), '.local', 'agent-skills'))
    );
    await library.loadReviewedCatalog(join(process.cwd(), 'agent-skills', 'catalog'));
    const skill = library.registry.getLatest('mining.varrock-east.copper-to-bank');
    if (!skill) throw new Error('Skill not found');

    const result = await new SkillExecutor(new RsSdkSkillRuntime(bot, sdk)).execute(
        skill.definition,
        { allowDraft: true }
    );
    console.log(result.status, result.reason);
});
```

The catalog keeps each original `0.1.0` draft beside its immutable, live-audited
`1.0.0` verified version. The first completed set covers mining + banking,
Karamja fishing + banking, bronze-dagger production, general-store purchasing,
and an exact-recipient player item transfer. Framework tests are deterministic
and run with `bun run test:skills`.

Run an exact skill or the newest version for a local bot with:

```powershell
bun agent-skills/run.ts 32WTGxrvt mining.varrock-east.copper-to-bank
```

Draft permission is deliberately explicit. Parameters can be overridden with
`--param=bank-x=3253`; the validator rejects unknown parameter names.

New run journals include the fully resolved parameter set. After an agent draft
has completed two live runs, promote it with their immutable run IDs:

```powershell
bun agent-skills/verify.ts routebot resource.copper-bank@0.1.0 `
  11111111-1111-4111-8111-111111111111 `
  22222222-2222-4222-8222-222222222222 `
  --version=1.0.0 --param=bank-x=3253
```

The promoted skill remains under `.local/agent-skills/` until a human chooses
to copy it into the source-controlled catalog. Verification reports are stored
under `.local/agent-skills/verifications/`; neither successful nor failed reports
can be overwritten.

Compare shared-library and isolated-discovery agents on the same seeded workload:

```powershell
bun run skill:experiment -- --seed=phase5-baseline --agents=12 --tasks=10 --trials=20
```

The command writes a detailed JSON report under `.local/admin/experiments/`.
Its unit is estimated skill operations: execution uses each definition's nominal
bounded path, while first-time isolated discovery adds the configured multiplier.
This is a reproducible model of duplicated discovery work, not a claim about
elapsed game time or LLM token usage.

Travel skills may use `talk-to-npc`, allowlisted `navigate-dialog`, and
`wait-for-area`. Coordinate-selected location interactions wait for both the
object and its requested option to become available after a teleport or modal
arrival message. Gathering operations reselect moving NPC/location targets until
inventory or XP proves progress, while remaining bounded by the skill timeout.

The verified fishing route can be run with an explicit target:

```powershell
bun agent-skills/run.ts 32WTGxrvt fishing.karamja.lobster-to-draynor-bank --param=target-lobsters=5
```

Production, shop, and player-trade operations are also narrow adapter calls:
`smith-at-anvil`, `open-shop`, `buy-from-shop`, `sell-to-shop`, `close-shop`,
and `trade-give-item`. Gift trades require an explicit recipient, item, and
positive quantity; the high-level SDK verifies the completed inventory delta.
