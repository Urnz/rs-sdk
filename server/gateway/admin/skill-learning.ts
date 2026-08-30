import { AgentStateStore } from '../../../agent-state/store.js';
import { SkillLearningStore, type SkillGrantKind } from '../../../agent-skills/learning.js';
import { legacySkillPolicy, type SkillSharingPolicy } from '../../../agent-skills/sharing-policy.js';
import type { SkillDefinition } from '../../../agent-skills/types.js';
import { agentStateDbPath, skillLearningPath } from './paths.js';

export interface AdminSkillGrantInput {
    agentId: string;
    kind: SkillGrantKind;
    resourceId: string;
    validFrom?: string;
    validUntil?: string | null;
    externalKey?: string;
}

function assertAgent(agentId: string, path: string): void {
    const agents = new AgentStateStore(path);
    try {
        if (!agents.getIdentity(agentId)) throw new Error('A jogosultság csak létező persistent agenthez adható.');
    } finally { agents.close(); }
}

function isActive(grant: { validFrom: string; validUntil: string | null; revokedAt: string | null }, at: string): boolean {
    const time = Date.parse(at);
    return Date.parse(grant.validFrom) <= time
        && (!grant.validUntil || time < Date.parse(grant.validUntil))
        && (!grant.revokedAt || time < Date.parse(grant.revokedAt));
}

export async function listAdminSkillLearning(path = skillLearningPath, now = new Date().toISOString()) {
    const store = new SkillLearningStore(path);
    const [grants, events] = await Promise.all([store.listGrants(), store.listEvents()]);
    return {
        grants: grants.map(grant => ({ ...grant, active: isActive(grant, now) })),
        events,
        generatedAt: now
    };
}

export async function createAdminSkillGrant(input: AdminSkillGrantInput, options: {
    learningPath?: string;
    agentPath?: string;
    now?: string;
} = {}) {
    const now = options.now ?? new Date().toISOString();
    assertAgent(input.agentId, options.agentPath ?? agentStateDbPath);
    return new SkillLearningStore(options.learningPath ?? skillLearningPath).grant({
        externalKey: input.externalKey ?? `admin:${crypto.randomUUID()}`,
        kind: input.kind,
        agentId: input.agentId,
        resourceId: input.resourceId,
        grantedBy: 'local-admin',
        validFrom: input.validFrom,
        validUntil: input.validUntil
    }, now);
}

export async function revokeAdminSkillGrant(grantId: string, expectedRevision: number, reason: string,
    path = skillLearningPath, now = new Date().toISOString()) {
    return new SkillLearningStore(path).revoke(grantId, expectedRevision, reason, now);
}

export async function learnAdminSkill(agentIdInput: string, definition: SkillDefinition, options: {
    learningPath?: string;
    agentPath?: string;
    now?: string;
    policy?: SkillSharingPolicy;
} = {}) {
    const agentId = agentIdInput.trim().toLocaleLowerCase('en-US');
    const agentPath = options.agentPath ?? agentStateDbPath;
    const learning = new SkillLearningStore(options.learningPath ?? skillLearningPath);
    const now = options.now ?? new Date().toISOString();
    if (definition.status !== 'verified') throw new Error('Csak verified skill tanulható meg.');

    const agents = new AgentStateStore(agentPath);
    try {
        const snapshot = agents.getSnapshot(agentId);
        if (!snapshot) throw new Error('A skill csak létező persistent agenthez tanítható.');
        const current = snapshot.knownSkills.find(item => item.skill.id === definition.id
            && item.skill.version === definition.version) ?? null;
        if (current?.status === 'blocked') {
            throw new Error('A skill ezen az agenten blokkolt; előbb a kézi blokkolást kell feloldani.');
        }
    } finally { agents.close(); }

    const skill = { id: definition.id, version: definition.version };
    const externalKey = `catalog-learning:${agentId}:${skill.id}:${skill.version}`;
    const existing = (await learning.listEvents(agentId)).find(event => event.externalKey === externalKey);
    const policy = options.policy ?? legacySkillPolicy(definition.sharing);
    const learned = await learning.learn({ externalKey, agentId, skill, policy,
        occurredAt: existing?.occurredAt ?? now,
        authorAgentId: definition.provenance.authorKind === 'agent' ? definition.provenance.authorId : undefined }, now);

    const reconciliation = new AgentStateStore(agentPath);
    try {
        const current = reconciliation.getSnapshot(agentId)?.knownSkills.find(item => item.skill.id === skill.id
            && item.skill.version === skill.version) ?? null;
        if (current?.status === 'blocked') {
            throw new Error('A skill ezen az agenten blokkolt; a tanulási esemény megmaradt, de az admin blokkolást nem írjuk felül.');
        }
        if (current?.status === 'known' || current?.status === 'preferred') {
            return { ...learned, knowledge: current, knowledgeCreated: false };
        }
        const knowledge = reconciliation.setSkillKnowledge(agentId, skill, 'known', null);
        return { ...learned, knowledge, knowledgeCreated: true };
    } finally { reconciliation.close(); }
}
