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
- `library.ts` – reviewed catalog and generated-draft orchestration.
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
5. A future deterministic/live verification pipeline may promote a new immutable
   version into the reviewed catalog.
6. `shared-library` agents can discover verified shared skills. In an
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

The catalog keeps the original `0.1.0` mining draft and the immutable `1.0.0`
verified version promoted after two successful live cycles. Framework tests are
deterministic and run with `bun run test:skills`.

Run an exact skill or the newest version for a local bot with:

```powershell
bun agent-skills/run.ts 32WTGxrvt mining.varrock-east.copper-to-bank
```

Draft permission is deliberately explicit. Parameters can be overridden with
`--param=bank-x=3253`; the validator rejects unknown parameter names.
