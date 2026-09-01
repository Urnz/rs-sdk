import { dirname, join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { listAgentDomainTools } from '../../../agent-state/control.js';
import type { AgentControlProfile } from '../../../agent-state/types.js';
import { agentStateDbPath, businessManagerDbPath } from './paths.js';
import { BusinessManagerStore, type Business, type BusinessPolicyMode,
    type BusinessPolicyProposal } from './business-manager.js';

export interface ProposeBusinessPolicyInput {
    proposalId: string;
    objective: string;
    mode: BusinessPolicyMode;
    maxRewardGp: number;
    preferredSkills?: Array<{ id: string; version: string }>;
}

export function businessManagerPathFor(agentPath = agentStateDbPath): string {
    return agentPath === agentStateDbPath ? businessManagerDbPath : join(dirname(agentPath), 'businesses.sqlite');
}

function businessAuthority(agentId: string, path: string): AgentControlProfile {
    const agents = new AgentStateStore(path);
    try {
        const profile = agents.getControlProfile(agentId);
        if (!profile || profile.role !== 'institution' || profile.subjectKind !== 'business') {
            throw new Error('Only a business institution agent may access the Business manager port');
        }
        return profile;
    } finally { agents.close(); }
}

export function inspectBusinessForAgent(agentId: string, agentPath = agentStateDbPath,
    businessPath = businessManagerPathFor(agentPath)): Business {
    const profile = businessAuthority(agentId, agentPath);
    if (!listAgentDomainTools(profile).includes('inspect-assets')) {
        throw new Error('Agent is not allowed to inspect business assets');
    }
    const businesses = new BusinessManagerStore(businessPath);
    try {
        const business = businesses.get(profile.subjectId);
        if (!business) throw new Error('The exact Business subject does not exist');
        return business;
    } finally { businesses.close(); }
}

export function proposeBusinessPolicyForAgent(agentId: string, input: ProposeBusinessPolicyInput,
    agentPath = agentStateDbPath, businessPath = businessManagerPathFor(agentPath),
    now = new Date().toISOString()): BusinessPolicyProposal {
    const profile = businessAuthority(agentId, agentPath);
    if (!listAgentDomainTools(profile).includes('propose-business-policy')) {
        throw new Error('Agent is not allowed to propose a business policy');
    }
    if (!Number.isSafeInteger(input.maxRewardGp) || input.maxRewardGp < 0
        || input.maxRewardGp > profile.dailyOperationalBudgetGp) {
        throw new Error('Business policy reward exceeds the institution agent operational budget');
    }
    const businesses = new BusinessManagerStore(businessPath);
    try {
        return businesses.proposePolicy(profile.subjectId, { ...input, proposerAgentId: profile.agentId }, now);
    } finally { businesses.close(); }
}
