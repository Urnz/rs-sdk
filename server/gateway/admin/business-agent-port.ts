import { dirname, join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { listAgentDomainTools } from '../../../agent-state/control.js';
import { normalizeAgentId, normalizeSkillReference } from '../../../agent-state/validation.js';
import type { AgentControlProfile } from '../../../agent-state/types.js';
import { agentStateDbPath, businessManagerDbPath } from './paths.js';
import { BusinessManagerStore, type Business, type BusinessPolicyMode,
    type BusinessPolicyProposal } from './business-manager.js';
import { businessRoleAllowsSkill } from '../../../business-roles/index.js';
import { institutionGrantDigest, type InstitutionStrategyGrant } from './institution-strategy-policy.js';
import { stateDigest } from '../../../agent-state/state-objectives.js';

export interface ProposeBusinessPolicyInput {
    proposalId: string;
    objective: string;
    mode: BusinessPolicyMode;
    maxRewardGp: number;
    preferredSkills?: Array<{ id: string; version: string }>;
}

export interface BusinessPlayerActionPolicyInput {
    assigneeAgentId: string;
    skill: { id: string; version: string };
    rewardGp?: number;
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

/** Grant is trusted server configuration; the model supplies only optionId. No treasury write capability. */
export function applyBusinessPolicyChoiceForAgent(agentId: string, grant: InstitutionStrategyGrant,
    optionId: string, eventId: string, proposalId: string, grantDigest: string, applicationDigest: string,
    agentPath = agentStateDbPath, now = new Date().toISOString()): BusinessPolicyProposal {
    const profile=businessAuthority(agentId,agentPath), selected=grant.options.find(o=>o.optionId===optionId);
    if (!listAgentDomainTools(profile).includes('select-business-policy') || profile.avatarPlayerUsername
        || grant.agentId!==agentId || grant.businessId!==profile.subjectId || institutionGrantDigest(grant)!==grantDigest || !selected
        || selected.maxRewardGp>grant.maxGpPerDecision || selected.maxRewardGp>profile.dailyOperationalBudgetGp
        || selected.stockPolicies.some(p=>p.businessId!==profile.subjectId)) throw new Error('Business choice exceeds exact institution grant');
    const agents=new AgentStateStore(agentPath);
    try {
        const run=agents.getInstitutionStrategy(eventId);
        if(!run || run.status!=='applying' || run.request.agentId!==agentId || run.request.grantDigest!==grantDigest
            || run.plan?.decision?.kind!=='choose-alternative' || run.plan.decision.optionId!==optionId
            || stateDigest([run.request,selected])!==applicationDigest) throw new Error('Business choice lacks admitted decision');
        agents.assertInstitutionStrategyAuthority(run.request);
    }finally{agents.close();}
    const businesses=new BusinessManagerStore(businessManagerPathFor(agentPath));
    try { return businesses.applyInstitutionPolicy(profile.subjectId,{proposalId,proposerAgentId:agentId,objective:selected.objective,
        mode:selected.mode,maxRewardGp:selected.maxRewardGp,preferredSkills:selected.preferredSkills},eventId,applicationDigest,selected.stockPolicies,now); }
    finally{businesses.close();}
}

export function validateBusinessCooperationForAgent(agentId:string,amountGp:number,agentPath=agentStateDbPath):void {
    const profile=businessAuthority(agentId,agentPath),business=inspectBusinessForAgent(agentId,agentPath);
    if(profile.avatarPlayerUsername||business.status!=='active'||!Number.isSafeInteger(amountGp)||amountGp<0||amountGp>profile.dailyOperationalBudgetGp)
        throw new Error('Business cooperation requires an active exact subject and bounded treasury obligation');
}

export function validateBusinessPlayerActionForAgent(agentId: string,
    input: BusinessPlayerActionPolicyInput, agentPath = agentStateDbPath,
    businessPath = businessManagerPathFor(agentPath)) {
    const profile = businessAuthority(agentId, agentPath);
    if (!listAgentDomainTools(profile).includes('request-player-action')) {
        throw new Error('Agent is not allowed to request player work');
    }
    const businesses = new BusinessManagerStore(businessPath);
    try {
        const business = businesses.get(profile.subjectId);
        if (!business) throw new Error('The exact Business subject does not exist');
        if (business.status !== 'active') throw new Error('Only an active business may request player work');
        const policy = business.activePolicy;
        if (!policy) throw new Error('Business player work requires an approved active policy');
        const rewardGp = input.rewardGp ?? 0;
        if (!Number.isSafeInteger(rewardGp) || rewardGp < 0 || rewardGp > 2_147_483_647) {
            throw new Error('Business player work reward is invalid');
        }
        const assigneeAgentId = normalizeAgentId(input.assigneeAgentId, 'assigneeAgentId');
        const requestedSkill = normalizeSkillReference(input.skill);
        const employment = business.employments.find(item => item.status === 'active'
            && item.workerAgentId === assigneeAgentId);
        if (!employment) throw new Error('Player agent is not an active employee of this business');
        const role = businesses.listRoleDefinitions().find(role => role.roleDefinitionId === employment.roleDefinitionId);
        if (!role || !businessRoleAllowsSkill(role, requestedSkill, employment.requiredSkill)) {
            throw new Error('Player work skill is not allowed by the active employment role');
        }
        if (rewardGp !== employment.wageGp) {
            throw new Error('Player work reward must equal the active employment wage');
        }
        if (rewardGp > policy.maxRewardGp) {
            throw new Error('Player work reward exceeds the active business policy limit');
        }
        const skillKey = `${requestedSkill.id}@${requestedSkill.version}`;
        if (employment.requiredSkill
            && skillKey !== `${employment.requiredSkill.id}@${employment.requiredSkill.version}`) {
            throw new Error('Player work skill does not match the active employment role');
        }
        if (policy.preferredSkills.length > 0 && !policy.preferredSkills.some(skill =>
            `${skill.id}@${skill.version}` === skillKey)) {
            throw new Error('Player work skill is not allowed by the active business policy');
        }
        return { business, employment, policy };
    } finally { businesses.close(); }
}
