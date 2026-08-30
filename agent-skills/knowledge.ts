import type { RegisteredSkill, SkillReference, SkillSharingMode } from './types';
import type { SkillRegistry } from './registry';

export type SkillAccessState = 'accessible' | 'denied';
export type SkillKnowledgeState = 'unlearned' | 'known' | 'preferred' | 'blocked';

export interface SkillRelationship {
    reference: SkillReference;
    exists: boolean;
    access: { state: SkillAccessState; reason: string };
    knowledge: SkillKnowledgeState;
    executable: boolean;
}

export function inspectSkillRelationship(
    registry: SkillRegistry,
    agentId: string,
    reference: SkillReference,
    knowledge: Exclude<SkillKnowledgeState, 'unlearned'> | null = null,
    sharingMode: SkillSharingMode = 'shared-library'
): SkillRelationship {
    const descriptor = registry.describe(reference);
    const normalizedAgentId = agentId.toLocaleLowerCase('en-US');
    let state: SkillAccessState = 'denied';
    let reason = 'The exact skill version does not exist in the registry.';
    if (descriptor) {
        const own = descriptor.authorKind === 'agent'
            && descriptor.authorId.toLocaleLowerCase('en-US') === normalizedAgentId;
        if (descriptor.visibility === 'private' && descriptor.ownerAgentId?.toLocaleLowerCase('en-US') !== normalizedAgentId) {
            reason = 'The skill is private to another agent.';
        } else if (descriptor.status === 'draft' && !own) {
            reason = 'Another agent draft is not accessible.';
        } else if (sharingMode === 'isolated-discovery' && !own) {
            reason = 'The simulation uses isolated discovery.';
        } else {
            state = 'accessible';
            reason = own ? 'The skill belongs to this agent.' : 'The verified shared skill is accessible from the catalog.';
        }
    }
    const knowledgeState = knowledge ?? 'unlearned';
    return {
        reference: { ...reference }, exists: descriptor !== null, access: { state, reason }, knowledge: knowledgeState,
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
