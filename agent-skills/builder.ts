import { FileSkillStore } from './store.js';
import { SKILL_SCHEMA_VERSION, type SkillDefinition, type SkillOperationName, type SkillReference,
    type SkillStep } from './types.js';
import { SkillValidationError, validateSkillDefinition } from './validation.js';
import { CapabilityGapStore, type CapabilityGap, type SkillBuilderClaimPolicy } from './capability-gaps.js';

export const SKILL_BUILDER_OPERATIONS: readonly SkillOperationName[] = [
    'walk-to', 'wait-for-area', 'talk-to-npc', 'navigate-dialog', 'interact-loc', 'interact-npc',
    'gather-loc', 'gather-npc', 'smith-at-anvil', 'open-shop', 'buy-from-shop', 'sell-to-shop',
    'close-shop', 'trade-give-item', 'open-bank', 'deposit-item', 'withdraw-item', 'close-bank', 'wait-ticks'
];

export interface SkillBuilderRequest {
    gap: Pick<CapabilityGap, 'gapId' | 'title' | 'description' | 'tags' | 'worldVersion' | 'skillSchemaVersion'>;
    allowedOperations: readonly SkillOperationName[];
    existingSkills: readonly { id: string; version: string; name: string; description: string; tags: readonly string[] }[];
}

export interface SkillBuilderProviderResponse {
    proposal: unknown;
    usage: { costMicros: number };
    providerRequestId?: string;
}

export interface SkillBuilderProvider {
    readonly id: string;
    build(request: SkillBuilderRequest, signal: AbortSignal): Promise<SkillBuilderProviderResponse>;
}

export interface SkillBuilderPolicy extends SkillBuilderClaimPolicy {
    maxDurationMs: number;
}

export type SkillBuilderRunResult = {
    status: 'idle';
} | {
    status: 'draft-created';
    gap: CapabilityGap;
    draft: SkillDefinition;
    path: string;
    providerRequestId: string | null;
    costMicros: number;
} | {
    status: 'failed';
    gap: CapabilityGap;
    reason: string;
    retryable: boolean;
    costMicros: number;
};

function record(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) throw new Error(`${path} contains unsupported fields: ${unknown.join(', ')}`);
}

function assertCondition(value: unknown, path: string): void {
    const condition = record(value, path);
    exactKeys(condition, ['condition', 'arguments'], path);
}

function assertStep(value: unknown, path: string, depth = 0): void {
    if (depth > 3) throw new Error(`${path} exceeds the builder nesting limit`);
    const step = record(value, path);
    if (step.kind === 'operation') {
        exactKeys(step, ['kind', 'id', 'operation', 'arguments', 'maxAttempts', 'onFailure'], path);
        return;
    }
    if (step.kind === 'repeat') {
        exactKeys(step, ['kind', 'id', 'until', 'maxIterations', 'steps'], path);
        assertCondition(step.until, `${path}.until`);
        if (!Array.isArray(step.steps)) throw new Error(`${path}.steps must be an array`);
        step.steps.forEach((child, index) => assertStep(child, `${path}.steps[${index}]`, depth + 1));
        return;
    }
    throw new Error(`${path}.kind is unsupported`);
}

function definitionFromProposal(input: unknown, workerId: string, now: string): SkillDefinition {
    const proposal = record(input, 'proposal');
    exactKeys(proposal, ['id', 'version', 'name', 'description', 'tags', 'parameters', 'limits',
        'preconditions', 'steps'], 'proposal');
    const parameters = record(proposal.parameters, 'proposal.parameters');
    for (const [name, parameterInput] of Object.entries(parameters)) {
        const parameter = record(parameterInput, `proposal.parameters.${name}`);
        exactKeys(parameter, ['type', 'description', 'required', 'default', 'enum', 'minimum', 'maximum'],
            `proposal.parameters.${name}`);
    }
    const limits = record(proposal.limits, 'proposal.limits');
    exactKeys(limits, ['timeoutMs', 'maxOperations'], 'proposal.limits');
    if (!Array.isArray(proposal.preconditions)) throw new Error('proposal.preconditions must be an array');
    proposal.preconditions.forEach((condition, index) => assertCondition(condition, `proposal.preconditions[${index}]`));
    if (!Array.isArray(proposal.steps)) throw new Error('proposal.steps must be an array');
    proposal.steps.forEach((step, index) => assertStep(step, `proposal.steps[${index}]`));
    return validateSkillDefinition({
        schemaVersion: SKILL_SCHEMA_VERSION,
        id: proposal.id,
        version: proposal.version,
        name: proposal.name,
        description: proposal.description,
        status: 'draft',
        tags: proposal.tags,
        parameters: proposal.parameters,
        provenance: { authorKind: 'agent', authorId: workerId, createdAt: now,
            notes: 'Declarative draft generated for a deduplicated CapabilityGap by the bounded Skill Builder service.' },
        sharing: { visibility: 'shared' },
        limits: proposal.limits,
        preconditions: proposal.preconditions,
        steps: proposal.steps
    });
}

async function providerCall(provider: SkillBuilderProvider, request: SkillBuilderRequest,
    timeoutMs: number): Promise<SkillBuilderProviderResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
    try {
        return await Promise.race([
            provider.build(request, controller.signal),
            new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () =>
                reject(new DOMException('Skill Builder time limit reached', 'AbortError')), { once: true }))
        ]);
    } finally {
        clearTimeout(timeout);
    }
}

export class SkillBuilderService {
    constructor(private readonly workerId: string, private readonly gaps: CapabilityGapStore,
        private readonly skills: FileSkillStore, private readonly provider: SkillBuilderProvider,
        private readonly policy: SkillBuilderPolicy) {
        if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(workerId)) throw new Error('Skill Builder worker ID is invalid');
        if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(provider.id)) throw new Error('Skill Builder provider ID is invalid');
        if (!Number.isInteger(policy.maxDurationMs) || policy.maxDurationMs < 100 || policy.maxDurationMs > 300_000) {
            throw new Error('Skill Builder duration limit must be from 100 to 300000 ms');
        }
    }

    async runNext(existingSkills: SkillBuilderRequest['existingSkills'] = [],
        now = new Date().toISOString()): Promise<SkillBuilderRunResult> {
        const claim = await this.gaps.claimForBuilder(this.workerId, {
            ...this.policy, leaseMs: this.policy.maxDurationMs + 30_000
        }, now);
        if (!claim) return { status: 'idle' };
        const attemptId = claim.builderAttemptId!;
        let costMicros = 0;
        let phase: 'provider' | 'validation' | 'persistence' = 'provider';
        try {
            const response = await providerCall(this.provider, { gap: { gapId: claim.gapId, title: claim.title,
                description: claim.description, tags: [...claim.tags], worldVersion: claim.worldVersion,
                skillSchemaVersion: claim.skillSchemaVersion }, allowedOperations: SKILL_BUILDER_OPERATIONS,
            existingSkills: existingSkills.map(skill => ({ ...skill, tags: [...skill.tags] })) }, this.policy.maxDurationMs);
            costMicros = response.usage.costMicros;
            phase = 'validation';
            if (!Number.isInteger(costMicros) || costMicros < 0) throw new Error('Skill Builder provider returned invalid cost');
            if (claim.builderCostMicros + costMicros > this.policy.maxCostMicrosPerGap) {
                throw new SkillValidationError(['Skill Builder cost would exceed the per-gap budget']);
            }
            const draft = definitionFromProposal(response.proposal, this.workerId, now);
            phase = 'persistence';
            const path = await this.skills.save(draft, { actorKind: 'agent', actorId: this.workerId });
            const gap = await this.gaps.completeBuilderAttempt(claim.gapId, attemptId, this.workerId, {
                costMicros, draftSkill: { id: draft.id, version: draft.version }
            }, now);
            return { status: 'draft-created', gap, draft, path,
                providerRequestId: response.providerRequestId ?? null, costMicros };
        } catch (error) {
            const retryable = phase !== 'validation';
            const reason = error instanceof Error ? error.message : String(error);
            const gap = await this.gaps.completeBuilderAttempt(claim.gapId, attemptId, this.workerId, {
                costMicros, error: reason, retryable
            }, now);
            return { status: 'failed', gap, reason, retryable, costMicros };
        }
    }
}

export function skillReference(definition: SkillDefinition): SkillReference {
    return { id: definition.id, version: definition.version };
}
