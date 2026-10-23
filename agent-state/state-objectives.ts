import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { freshEconomicFact, type EconomicObservation } from './economic-context.js';

export const STATE_GOAL_POLICY = 'si-b02.v1' as const;
export type StatePredicate = { kind: 'food-reserve-at-least' | 'cash-reserve-at-least' | 'hunger-at-most'; value: number };
export interface StateObjective {
    policy: typeof STATE_GOAL_POLICY;
    mode: 'achieve' | 'maintain';
    purpose: 'self-care' | 'livelihood';
    predicates: StatePredicate[];
}
export interface StateGoalEvaluation {
    result: 'satisfied' | 'unsatisfied' | 'unknown';
    observedAt: string;
    digest: string;
    needsReplan?: boolean;
}
export const stateDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Server-authored objectives only; the model cannot define predicates or their thresholds. */
export function validateStateObjective(raw: StateObjective): StateObjective {
    if (!raw || raw.policy !== STATE_GOAL_POLICY || !['achieve', 'maintain'].includes(raw.mode)
        || !['self-care', 'livelihood'].includes(raw.purpose) || !Array.isArray(raw.predicates)
        || raw.predicates.length < 1 || raw.predicates.length > 3) throw new Error('Invalid state objective policy');
    const seen = new Set<string>();
    const predicates = raw.predicates.map(p => {
        const maximum = p?.kind === 'hunger-at-most' ? 10000 : p?.kind === 'food-reserve-at-least' ? 28
            : p?.kind === 'cash-reserve-at-least' ? 2147483647 : -1;
        if (!Number.isSafeInteger(p?.value) || p.value < (p.kind === 'hunger-at-most' ? 0 : 1)
            || p.value > maximum || seen.has(p.kind)) throw new Error('Invalid or duplicate state predicate');
        seen.add(p.kind);
        return { kind: p.kind, value: p.value };
    });
    return { policy: STATE_GOAL_POLICY, mode: raw.mode, purpose: raw.purpose, predicates };
}

const SOURCES = {
    'food-reserve-at-least': ['own-food-portions', 'own-engine-observation'],
    'cash-reserve-at-least': ['own-liquid-inventory-gp', 'own-engine-observation'],
    'hunger-at-most': ['hunger', 'durable-needs']
} as const;

/** Read model for goal satisfaction, never a financial receipt or transfer authorization. */
export function evaluateStateObjective(objective: StateObjective, observation: EconomicObservation,
    now: string): StateGoalEvaluation {
    validateStateObjective(objective);
    const age = Date.parse(now) - Date.parse(observation.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > 5000) throw new Error('State observation is stale or future');
    const results = objective.predicates.map(predicate => {
        const [key, source] = SOURCES[predicate.kind];
        const matches = observation.facts.filter(f => f.key === key);
        const f = matches[0];
        if (matches.length !== 1 || !f || f.source !== source || !f.cursor || !freshEconomicFact(f, now)
            || (predicate.kind === 'hunger-at-most' && f.trust !== 'native')
            || typeof f.value !== 'number' || !Number.isSafeInteger(f.value) || f.value < 0
            || (predicate.kind === 'hunger-at-most' && f.value > 10000)) return 'unknown';
        return (predicate.kind === 'hunger-at-most' ? f.value <= predicate.value : f.value >= predicate.value)
            ? 'satisfied' : 'unsatisfied';
    });
    return { result: results.includes('unknown') ? 'unknown' : results.includes('unsatisfied') ? 'unsatisfied' : 'satisfied',
        observedAt: observation.observedAt, digest: stateDigest(observation) };
}

export function installStateGoalSchema(db: Database): void {
    db.run(`CREATE TABLE agent_state_objective (goal_id TEXT PRIMARY KEY REFERENCES agent_goal(goal_id),
        objective_json TEXT NOT NULL, source_binding TEXT, observed_at TEXT)`);
    db.run(`CREATE TABLE agent_state_evaluation (goal_id TEXT NOT NULL REFERENCES agent_goal(goal_id),
        goal_revision INTEGER NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL,
        observed_at TEXT NOT NULL, evaluated_at TEXT NOT NULL, observation_json TEXT NOT NULL,
        PRIMARY KEY(goal_id,digest))`);
    db.run(`CREATE TABLE agent_plan_adoption (proposal_id TEXT PRIMARY KEY REFERENCES agent_goal_proposal(proposal_id),
        goal_id TEXT NOT NULL UNIQUE REFERENCES agent_goal(goal_id), decision_id TEXT NOT NULL UNIQUE,
        parent_revision INTEGER NOT NULL, policy_version TEXT NOT NULL, scope_digest TEXT NOT NULL,
        adopted_at TEXT NOT NULL)`);
}
