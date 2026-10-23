import type { Database } from 'bun:sqlite';
import type { LlmPlanResult, LlmPlanningInput } from '../llm-runtime/types.js';

export interface InstitutionStrategyRequest {
    eventId: string; sourceKey: string; agentId: string; businessId: string;
    profileRevision: number; policyId: string; policyVersion: string; grantDigest: string;
    contextDigest: string; observedAt: string; input: LlmPlanningInput;
}
export interface InstitutionStrategyRun {
    request: InstitutionStrategyRequest;
    status: 'prepared' | 'inferring' | 'decided' | 'applying' | 'applied' | 'waiting';
    plan: LlmPlanResult | null; reason: string; nextEligibleAt: string;
}
export function installInstitutionStrategySchema(db: Database): void {
    db.run(`CREATE TABLE agent_institution_strategy(event_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id), request_json TEXT NOT NULL,
        status TEXT NOT NULL, plan_json TEXT, reason TEXT NOT NULL, next_eligible_at TEXT NOT NULL)`);
    db.run('CREATE INDEX agent_institution_strategy_due ON agent_institution_strategy(agent_id,next_eligible_at)');
}
export function readInstitutionStrategy(db: Database, eventId: string): InstitutionStrategyRun | null {
    const r = db.query('SELECT * FROM agent_institution_strategy WHERE event_id=?1').get(eventId) as {
        request_json: string; status: InstitutionStrategyRun['status']; plan_json: string | null; reason: string; next_eligible_at: string;
    } | null;
    return r ? {request:JSON.parse(r.request_json),status:r.status,plan:r.plan_json ? JSON.parse(r.plan_json) : null,
        reason:r.reason,nextEligibleAt:r.next_eligible_at} : null;
}
