import type { RegisteredSkill, SkillReference, SkillSharingMode } from './types';
import type { SkillRegistry } from './registry';
import { decideSkillPolicy, legacySkillPolicy, type SkillAccessSubject, type SkillLearningMode } from './sharing-policy';

export type SkillAccessState = 'accessible' | 'denied';
export type SkillKnowledgeState = 'unlearned' | 'known' | 'preferred' | 'blocked';

export interface SkillRelationship {
    reference: SkillReference;
    exists: boolean;
    access: { state: SkillAccessState; reason: string };
    knowledge: SkillKnowledgeState;
    learning: { eligible: boolean; mode: SkillLearningMode; reason: string };
    executable: boolean;
}

export function inspectSkillRelationship(
    registry: SkillRegistry,
    agentId: string,
    reference: SkillReference,
    knowledge: Exclude<SkillKnowledgeState, 'unlearned'> | null = null,
    sharingMode: SkillSharingMode = 'shared-library',
    accessSubject: Omit<SkillAccessSubject, 'agentId' | 'isolatedDiscovery'> = {}
): SkillRelationship {
    const descriptor = registry.describe(reference);
    const normalizedAgentId = agentId.toLocaleLowerCase('en-US');
    let state: SkillAccessState = 'denied';
    let reason = 'The exact skill version does not exist in the registry.';
    let learning: SkillRelationship['learning'] = { eligible: false, mode: 'unavailable', reason };
    if (descriptor) {
        const own = descriptor.authorKind === 'agent'
            && descriptor.authorId.toLocaleLowerCase('en-US') === normalizedAgentId;
        const policy = decideSkillPolicy(legacySkillPolicy({ visibility: descriptor.visibility,
            ...(descriptor.ownerAgentId ? { ownerAgentId: descriptor.ownerAgentId } : {}) }), {
            agentId, ...accessSubject, isolatedDiscovery: sharingMode === 'isolated-discovery'
        }, own ? descriptor.authorId : undefined);
        learning = { eligible: policy.learningEligible, mode: policy.learningMode, reason: policy.reason };
        if (descriptor.status === 'draft' && !own) {
            reason = 'Another agent draft is not accessible.';
        } else if (!policy.accessible) {
            reason = policy.reason;
        } else {
            state = 'accessible';
            reason = policy.reason;
        }
    }
    const knowledgeState = knowledge ?? 'unlearned';
    return {
        reference: { ...reference }, exists: descriptor !== null, access: { state, reason }, knowledge: knowledgeState,
        learning,
        executable: descriptor?.status === 'verified' && state === 'accessible'
            && (knowledgeState === 'known' || knowledgeState === 'preferred')
    };
}

export class AgentSkillBook {
    private readonly known = new Map<string, SkillReference>();

    constructor(
        public readonly agentId: string,
        public sharingMode: SkillSharingMode = 'shared-library'
    ) {}

    learn(reference: SkillReference, registry: SkillRegistry): void {
        const skill = registry.get(reference, this.agentId);
        if (!skill) throw new Error(`Unknown skill ${reference.id}@${reference.version}`);
        if (skill.definition.sharing.visibility === 'private' && skill.definition.sharing.ownerAgentId !== this.agentId) {
            throw new Error(`Private skill ${reference.id}@${reference.version} is not visible to ${this.agentId}`);
        }
        if (skill.definition.status === 'draft'
            && !(skill.definition.provenance.authorKind === 'agent' && skill.definition.provenance.authorId === this.agentId)) {
            throw new Error(`Draft skill ${reference.id}@${reference.version} can only be learned by its author`);
        }
        this.known.set(reference.id, { ...reference });
    }

    forget(id: string): void {
        this.known.delete(id);
    }

    knows(id: string): boolean {
        return this.known.has(id);
    }

    inspect(reference: SkillReference, registry: SkillRegistry): SkillRelationship {
        return inspectSkillRelationship(registry, this.agentId, reference,
            this.known.get(reference.id)?.version === reference.version ? 'known' : null, this.sharingMode);
    }

    listKnown(): SkillReference[] {
        return [...this.known.values()].map(reference => ({ ...reference }));
    }

    discover(registry: SkillRegistry): RegisteredSkill[] {
        const own = registry.list({ visibleToAgentId: this.agentId }).filter(skill =>
            skill.definition.provenance.authorKind === 'agent'
            && skill.definition.provenance.authorId === this.agentId
        );
        if (this.sharingMode === 'isolated-discovery') return own;

        const sharedVerified = registry.list({ status: 'verified', visibleToAgentId: this.agentId })
            .filter(skill => skill.definition.sharing.visibility === 'shared');
        const byReference = new Map<string, RegisteredSkill>();
        for (const skill of [...own, ...sharedVerified]) {
            byReference.set(`${skill.definition.id}@${skill.definition.version}`, skill);
        }
        return [...byReference.values()];
    }
}
