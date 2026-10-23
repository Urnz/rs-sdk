import type { Database } from 'bun:sqlite';
import type { LlmPlanResult, PlayerStrategyAlternative } from '../llm-runtime/types.js';
import type { AgentSkillParameterBinding } from './types.js';

export const PLAYER_STRATEGY_POLICY = { version: 'si-b03.v1', cooldownMs: 60000, maximumOptions: 12 } as const;
export interface StrategyOption extends PlayerStrategyAlternative { binding: AgentSkillParameterBinding }
export interface PlayerStrategyRequest {
    event: { eventId: string; type: string; sourceKey: string };
    agentId: string;
    parent: { goalId: string; revision: number };
    replaces: { goalId: string; revision: number } | null;
    options: StrategyOption[];
    unavailable: { skill: string; kind: 'procedure' | 'input' | 'context' | 'policy' | 'budget'; reason: string }[];
    contextDigest: string;
    policyDigest: string;
    observedAt: string;
}
export interface PlayerStrategyRun {
    request: PlayerStrategyRequest;
    status: 'prepared' | 'inferring' | 'decided' | 'adopted' | 'dispatched' | 'waiting';
    plan: LlmPlanResult | null;
    proposalId: string;
    goalId: string | null;
    runId: string | null;
    reason: string;
    nextEligibleAt: string;
}
export function installPlayerStrategySchema(db: Database): void {
    db.run(`CREATE TABLE agent_player_strategy (event_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL
        REFERENCES agent_identity(agent_id), request_json TEXT NOT NULL, status TEXT NOT NULL,
        plan_json TEXT, proposal_id TEXT NOT NULL UNIQUE, goal_id TEXT, run_id TEXT UNIQUE,
        reason TEXT NOT NULL, next_eligible_at TEXT NOT NULL)`);
    db.run('CREATE INDEX agent_player_strategy_agent ON agent_player_strategy(agent_id,next_eligible_at)');
}
export function readPlayerStrategy(db: Database, eventId: string): PlayerStrategyRun | null {
    const row = db.query('SELECT * FROM agent_player_strategy WHERE event_id=?1').get(eventId) as {
        request_json: string; status: PlayerStrategyRun['status']; plan_json: string | null;
        proposal_id: string; goal_id: string | null; run_id: string | null; reason: string; next_eligible_at: string;
    } | null;
    return row ? { request: JSON.parse(row.request_json), status: row.status, plan: row.plan_json ? JSON.parse(row.plan_json) : null,
        proposalId: row.proposal_id, goalId: row.goal_id, runId: row.run_id, reason: row.reason, nextEligibleAt: row.next_eligible_at } : null;
}
