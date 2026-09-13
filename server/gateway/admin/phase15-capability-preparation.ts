import { CapabilityGapStore, type CapabilityGap } from '../../../agent-skills/capability-gaps.js';
import type { SkillReference } from '../../../agent-skills/types.js';

export const PHASE15_SKILL_BUILDER_ID = 'phase15-skill-builder';

export interface Phase15CapabilityCandidate {
    agentId: string;
    goalId: string;
    anchorGoalId: string;
    title: string;
    description: string;
    tags: string[];
    draft: SkillReference;
}

export const PHASE15_CAPABILITY_CANDIDATES: readonly Phase15CapabilityCandidate[] = [
    { agentId: 'vrtrader1', goalId: 'vrtrader1.run', anchorGoalId: 'vrtrader1.hammers',
        title: 'Travel to an exact meeting point and return',
        description: 'Use one reusable bounded coordinate procedure for travel, meeting wait, and return.',
        tags: ['travel', 'meeting', 'return', 'procedure'],
        draft: { id: 'procedure.travel-meet-return', version: '0.1.0' } },
    { agentId: 'vrsmith1', goalId: 'vrsmith1.run', anchorGoalId: 'vrsmith1.daggers',
        title: 'Withdraw an exact production input from a bank',
        description: 'Acquire a bounded item quantity from exact bank coordinates without a route-specific skill.',
        tags: ['banking', 'withdraw', 'input-acquisition', 'procedure'],
        draft: { id: 'procedure.bank.withdraw-item', version: '0.1.0' } },
    { agentId: 'vrtrader1', goalId: 'vrtrader1.run', anchorGoalId: 'vrtrader1.hammers',
        title: 'Buy an exact bounded item from a shop',
        description: 'Use a reusable shop procedure under a separate exact item, price, run, and daily GP policy.',
        tags: ['shopping', 'input-acquisition', 'procedure'],
        draft: { id: 'procedure.shop.buy-item', version: '0.1.0' } },
    { agentId: 'vrworker1', goalId: 'vrworker1.run', anchorGoalId: 'vrworker1.available',
        title: 'Receive an exact item from an exact player',
        description: 'Complete the receiving side of a two-player trade with offer re-verification.',
        tags: ['trade', 'receiving', 'procedure'],
        draft: { id: 'procedure.trade.receive-item', version: '0.1.0' } },
    { agentId: 'vrsmith1', goalId: 'vrsmith1.run', anchorGoalId: 'vrsmith1.daggers',
        title: 'Acquire banked input, produce, and bank exact output',
        description: 'Compose reviewed acquisition, production, and output procedures without duplicating primitive operations.',
        tags: ['banking', 'composition', 'production', 'workflow'],
        draft: { id: 'workflow.varrock.bronze-dagger-bank-cycle', version: '0.1.0' } },
    { agentId: 'vrsmith1', goalId: 'vrsmith1.run', anchorGoalId: 'vrsmith1.daggers',
        title: 'Produce and hand off exact crafted output to an exact partner',
        description: 'Compose reviewed production and two-player trade procedures for bounded crafted-output delivery.',
        tags: ['composition', 'production', 'trade', 'handoff', 'workflow'],
        draft: { id: 'workflow.varrock.bronze-dagger-handoff', version: '0.1.0' } }
] as const;

function sameReference(left: SkillReference | null, right: SkillReference): boolean {
    return left?.id === right.id && left.version === right.version;
}

/**
 * Registers the reviewed source-controlled candidates in the normal CapabilityGap
 * lifecycle. It never starts a bot, verifies a draft, or publishes a skill.
 */
export async function preparePhase15CapabilityTrials(store: CapabilityGapStore,
    now = new Date().toISOString()): Promise<CapabilityGap[]> {
    const prepared: CapabilityGap[] = [];
    for (const candidate of PHASE15_CAPABILITY_CANDIDATES) {
        const reported = await store.report({ agentId: candidate.agentId, goalId: candidate.goalId,
            anchorGoalId: candidate.anchorGoalId, title: candidate.title, description: candidate.description,
            tags: candidate.tags, worldVersion: 'lostcity-local' }, now);
        let gap = reported.gap;
        if (gap.status === 'open') {
            gap = await store.transition(gap.gapId, gap.revision, 'assigned', {
                assignedWorkerId: PHASE15_SKILL_BUILDER_ID
            }, now);
        }
        if (gap.status === 'assigned' && gap.assignedWorkerId === PHASE15_SKILL_BUILDER_ID) {
            gap = await store.transition(gap.gapId, gap.revision, 'draft', { draftSkill: candidate.draft }, now);
        }
        if (!['draft', 'validating', 'live-trial', 'verified'].includes(gap.status)
            || !(sameReference(gap.draftSkill, candidate.draft)
                || gap.status === 'verified' && gap.resolvedSkill?.id === candidate.draft.id)) {
            throw new Error(`Capability gap ${gap.gapId} conflicts with ${candidate.draft.id}@${candidate.draft.version}`);
        }
        prepared.push(gap);
    }
    return prepared;
}
