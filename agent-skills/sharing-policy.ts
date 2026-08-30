export type SkillPolicyKind = 'common' | 'public' | 'organization' | 'teachable' | 'licensed' | 'private';
export type SkillLearningMode = 'common-knowledge' | 'self-study' | 'organization-training' | 'teacher-training'
    | 'licensed-use' | 'author-knowledge' | 'unavailable';

export type SkillSharingPolicy =
    | { kind: 'common' }
    | { kind: 'public' }
    | { kind: 'organization'; organizationId: string }
    | { kind: 'teachable'; teacherAgentId: string }
    | { kind: 'licensed'; licenseId: string }
    | { kind: 'private'; ownerAgentId: string };

export interface SkillAccessSubject {
    agentId: string;
    organizationIds?: readonly string[];
    teacherAgentIds?: readonly string[];
    licenseIds?: readonly string[];
    isolatedDiscovery?: boolean;
}

export interface SkillPolicyDecision {
    policy: SkillPolicyKind;
    discoverable: boolean;
    accessible: boolean;
    learningEligible: boolean;
    learningMode: SkillLearningMode;
    reason: string;
}

const ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function normalized(value: string, name: string): string {
    if (!ID_PATTERN.test(value)) throw new Error(`${name} contains unsupported characters`);
    return value.toLocaleLowerCase('en-US');
}

export function validateSkillSharingPolicy(input: SkillSharingPolicy): SkillSharingPolicy {
    if (!input || typeof input !== 'object') throw new Error('Skill sharing policy must be an object');
    if (input.kind === 'common' || input.kind === 'public') return { kind: input.kind };
    if (input.kind === 'organization') return { kind: input.kind,
        organizationId: normalized(input.organizationId, 'organizationId') };
    if (input.kind === 'teachable') return { kind: input.kind,
        teacherAgentId: normalized(input.teacherAgentId, 'teacherAgentId') };
    if (input.kind === 'licensed') return { kind: input.kind, licenseId: normalized(input.licenseId, 'licenseId') };
    if (input.kind === 'private') return { kind: input.kind,
        ownerAgentId: normalized(input.ownerAgentId, 'ownerAgentId') };
    throw new Error('Unsupported skill sharing policy');
}

export function decideSkillPolicy(input: SkillSharingPolicy, subjectInput: SkillAccessSubject,
    authorAgentId?: string): SkillPolicyDecision {
    const policy = validateSkillSharingPolicy(input);
    const agentId = normalized(subjectInput.agentId, 'agentId');
    const author = authorAgentId ? normalized(authorAgentId, 'authorAgentId') : null;
    if (author === agentId) return { policy: policy.kind, discoverable: true, accessible: true,
        learningEligible: true, learningMode: 'author-knowledge', reason: 'The agent authored this skill.' };
    if (subjectInput.isolatedDiscovery) return { policy: policy.kind, discoverable: false, accessible: false,
        learningEligible: false, learningMode: 'unavailable', reason: 'The simulation uses isolated discovery.' };
    if (policy.kind === 'common') return { policy: policy.kind, discoverable: true, accessible: true,
        learningEligible: true, learningMode: 'common-knowledge', reason: 'This is common knowledge.' };
    if (policy.kind === 'public') return { policy: policy.kind, discoverable: true, accessible: true,
        learningEligible: true, learningMode: 'self-study', reason: 'This public skill may be learned by self-study.' };
    if (policy.kind === 'organization') {
        const member = (subjectInput.organizationIds ?? []).map(value => normalized(value, 'organizationId'))
            .includes(policy.organizationId);
        return { policy: policy.kind, discoverable: member, accessible: member, learningEligible: member,
            learningMode: member ? 'organization-training' : 'unavailable',
            reason: member ? 'The agent belongs to the required organization.' : 'Organization membership is required.' };
    }
    if (policy.kind === 'teachable') {
        const teacher = (subjectInput.teacherAgentIds ?? []).map(value => normalized(value, 'teacherAgentId'))
            .includes(policy.teacherAgentId);
        return { policy: policy.kind, discoverable: true, accessible: teacher, learningEligible: teacher,
            learningMode: teacher ? 'teacher-training' : 'unavailable',
            reason: teacher ? 'The required teacher relationship is present.' : 'Instruction by the designated teacher is required.' };
    }
    if (policy.kind === 'licensed') {
        const licensed = (subjectInput.licenseIds ?? []).map(value => normalized(value, 'licenseId'))
            .includes(policy.licenseId);
        return { policy: policy.kind, discoverable: true, accessible: licensed, learningEligible: licensed,
            learningMode: licensed ? 'licensed-use' : 'unavailable',
            reason: licensed ? 'The required license grant is present.' : 'An active license grant is required.' };
    }
    const owner = policy.ownerAgentId === agentId;
    return { policy: policy.kind, discoverable: owner, accessible: owner, learningEligible: owner,
        learningMode: owner ? 'author-knowledge' : 'unavailable',
        reason: owner ? 'The agent owns this private skill.' : 'This skill is private to another agent.' };
}

export function legacySkillPolicy(sharing: { visibility: 'shared' | 'private'; ownerAgentId?: string }): SkillSharingPolicy {
    return sharing.visibility === 'shared' ? { kind: 'public' }
        : { kind: 'private', ownerAgentId: sharing.ownerAgentId ?? '' };
}
