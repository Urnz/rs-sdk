import type { RegisteredSkill, SkillReference, SkillSharingMode } from './types';
import type { SkillRegistry } from './registry';

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
