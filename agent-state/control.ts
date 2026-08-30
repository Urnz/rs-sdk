import type { AgentControlProfile, AgentDecisionTrigger } from './types.js';

export type AgentDomainTool = 'execute-player-skill' | 'inspect-budget' | 'inspect-assets'
    | 'propose-contract' | 'request-player-action' | 'propose-business-policy'
    | 'propose-faction-policy' | 'inspect-service-queue' | 'propose-world-event-template';

export interface PhysicalExecutionAuthority {
    allowed: boolean;
    playerUsername: string | null;
    reason: string;
}

export function listAgentDomainTools(profile: AgentControlProfile): AgentDomainTool[] {
    if (profile.role === 'player') return ['execute-player-skill', 'inspect-assets'];
    if (profile.role === 'institution') return ['inspect-budget', 'inspect-assets', 'propose-contract',
        'request-player-action', profile.subjectKind === 'business' ? 'propose-business-policy' : 'propose-faction-policy'];
    if (profile.role === 'service') return ['inspect-budget', 'inspect-service-queue'];
    return ['inspect-budget', 'propose-world-event-template'];
}

export function physicalExecutionAuthority(profile: AgentControlProfile,
    requestedPlayerUsername?: string): PhysicalExecutionAuthority {
    if (profile.role !== 'player' || profile.subjectKind !== 'player' || !profile.avatarPlayerUsername) {
        return { allowed: false, playerUsername: null,
            reason: `${profile.role} agents cannot execute physical player skills; they must request a player action` };
    }
    const requested = requestedPlayerUsername?.trim().toLocaleLowerCase('en-US');
    if (requested && requested !== profile.avatarPlayerUsername) {
        return { allowed: false, playerUsername: profile.avatarPlayerUsername,
            reason: `Agent may control only its bound avatar ${profile.avatarPlayerUsername}` };
    }
    return { allowed: true, playerUsername: profile.avatarPlayerUsername,
        reason: 'Exact bound player avatar is authorized' };
}

export function decisionReadiness(profile: AgentControlProfile, trigger: AgentDecisionTrigger,
    now = new Date().toISOString()): { ready: boolean; reason: string } {
    const timestamp = Date.parse(now);
    if (Number.isNaN(timestamp)) throw new Error('Decision readiness time must be an ISO timestamp');
    if (trigger !== 'scheduled') return { ready: true, reason: `${trigger} decisions may bypass cadence but not daily budgets` };
    if (!profile.nextDecisionAt || timestamp >= Date.parse(profile.nextDecisionAt)) {
        return { ready: true, reason: 'Scheduled decision is due' };
    }
    return { ready: false, reason: `Next scheduled decision is due at ${profile.nextDecisionAt}` };
}

export function buildAgentControlContext(profile: AgentControlProfile): string {
    const tools = listAgentDomainTools(profile);
    return [
        `Control role: ${profile.role}`,
        `Subject: ${profile.subjectKind}:${profile.subjectId}`,
        `Avatar: ${profile.avatarPlayerUsername ?? 'none'}`,
        `Decision cadence: ${profile.decisionIntervalMs} ms; maximum ${profile.maxDecisionsPerDay}/day`,
        `Daily budgets: ${profile.dailyLlmBudgetMicros} LLM micros; ${profile.dailyOperationalBudgetGp} gp`,
        `Allowed domain tools: ${tools.join(', ')}`
    ].join('\n');
}
