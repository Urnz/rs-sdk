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
- `executor.ts` – limits, retries, cancellation, repeat conditions, and audit events.
- `journal.ts` – immutable per-run JSON audit records.
- `rs-sdk-runtime.ts` – adapter from approved operations to `BotActions`/`BotSDK`.
- `catalog/` – source-controlled skills reviewed by a human or verifier.
- `test/` – deterministic tests with no running game or LLM required.

Runtime-generated documents belong under `.local/agent-skills/` and are ignored
by Git. Shared skills are visible to every agent; private skills are only loaded
for their owner. CLI runs are recorded under `.local/agent-skills/runs/<run-id>.json`.

## Trust lifecycle

1. A human or agent creates a schema-versioned document.
2. Agent-authored submissions must identify their author and remain `draft`.
3. Validation rejects unknown operations, unbounded loops, invalid inputs, and
   attempts to claim verified status.
4. Draft execution requires explicit `allowDraft: true` and still obeys all limits.
5. The deterministic verifier requires a shared agent draft, a newer target
   version, a bounded operation budget, resolved parameters, and at least two
   unique successful live runs recorded with those exact parameters.
6. A passing report promotes a new immutable, system-authored `verified` version;
   a failing report is retained but never publishes a skill.
7. `shared-library` agents can discover verified shared skills. In an
   `isolated-discovery` simulation they only discover skills authored by themselves.

Changing an existing `id@version` is rejected. Improvements must publish a new
semantic version, so another agent can reproduce exactly what it learned.

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
