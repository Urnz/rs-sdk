import type { Database } from 'bun:sqlite';
import type { LlmPlanResult, LlmPlanningInput } from '../llm-runtime/types.js';

export interface EconomicActionRequest {eventId:string;sourceKey:string;agentId:string;profileRevision:number;
    grantDigest:string;binding:string;policyId:string;policyVersion:string;observedAt:string;input:LlmPlanningInput;choices:unknown[]}
export interface EconomicActionRun {request:EconomicActionRequest;status:'prepared'|'inferring'|'decided'|'applying'|'applied'|'waiting';
    plan:LlmPlanResult|null;reason:string;nextEligibleAt:string;result:string|null}
export function installEconomicActionSchema(db:Database):void{
    db.run(`CREATE TABLE agent_economic_action(event_id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id),
        request_json TEXT NOT NULL,status TEXT NOT NULL,plan_json TEXT,reason TEXT NOT NULL,next_eligible_at TEXT NOT NULL,result_json TEXT)`);
    db.run('CREATE INDEX agent_economic_action_due ON agent_economic_action(agent_id,next_eligible_at)');
}
export function readEconomicAction(db:Database,eventId:string):EconomicActionRun|null{
    const r=db.query('SELECT * FROM agent_economic_action WHERE event_id=?1').get(eventId) as {request_json:string;status:EconomicActionRun['status'];plan_json:string|null;reason:string;next_eligible_at:string;result_json:string|null}|null;
    return r?{request:JSON.parse(r.request_json),status:r.status,plan:r.plan_json?JSON.parse(r.plan_json):null,reason:r.reason,nextEligibleAt:r.next_eligible_at,result:r.result_json}:null;
}
