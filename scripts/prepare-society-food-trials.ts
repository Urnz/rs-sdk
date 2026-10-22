import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CapabilityGapStore } from '../agent-skills/capability-gaps.js';
import { validateSkillDefinition } from '../agent-skills/validation.js';

const { values } = parseArgs({ strict: true, options: { root: { type: 'string' } } });
if (!values.root) throw new Error('Usage: bun scripts/prepare-society-food-trials.ts --root DISPOSABLE_TRIAL_WORKSPACE');
const root = resolve(values.root);
if (!existsSync(join(root, '.local/simulation/food-trial-fixture.json')) || existsSync(join(root, '.local/simulation/integration-fixture.json')))
    throw new Error('Food draft trials require the separate disposable trial world');
const store = new CapabilityGapStore(join(root, '.local/agent-skills/capability-gaps.json'));
const fixture = JSON.parse(readFileSync(join(root, 'config/fixtures/society-lobster-four-v1.json'), 'utf8'));
const prepared = [];
for (const [operation, agentId] of [['gather', 'sifisher'], ['cook', 'sicook'], ['consume', 'silessor']] as const) {
    const id = `procedure.food.${operation}-lobster`, version = fixture.skills.find((s: any) => s.id === id)?.version;
    if (!version) throw new Error('Exact food trial fixture pin missing');
    const draft = validateSkillDefinition(JSON.parse(readFileSync(join(root, `agent-skills/catalog/${id}@${version}.skill.json`), 'utf8')));
    if (draft.status !== 'draft' || draft.provenance.authorKind !== 'agent') throw new Error('Only original agent drafts may enter food trials');
    const reported = await store.report({ agentId, goalId: `si-trial-${operation}`, anchorGoalId: `si-trial-${operation}`,
        title: `Native society food ${operation}`, description: 'Two independent normal runtime trials, canonical source verification, separate publication review.',
        tags: ['society', 'food', operation], worldVersion: 'lostcity-local-v1' });
    let gap = reported.gap;
    if (gap.status === 'open') gap = await store.transition(gap.gapId, gap.revision, 'assigned', { assignedWorkerId: draft.provenance.authorId });
    if (gap.status === 'assigned' && gap.assignedWorkerId === draft.provenance.authorId)
        gap = await store.transition(gap.gapId, gap.revision, 'draft', { draftSkill: { id, version } });
    if (!['draft', 'validating', 'live-trial', 'verified'].includes(gap.status) || gap.draftSkill?.id !== id || gap.draftSkill.version !== version)
        throw new Error(`Conflicting food trial gap: ${gap.gapId}`);
    prepared.push({ operation, agentId, gapId: gap.gapId, draft: gap.draftSkill, status: gap.status });
}
console.log(JSON.stringify({ scope: 'draft-trials-only', prepared }, null, 2));
