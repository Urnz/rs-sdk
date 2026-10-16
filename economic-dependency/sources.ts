import { existsSync } from 'node:fs';
import { readDatabase, readNativeTradeLedger, check } from '../external-trade/source.js';
import { digest, time, integer, key, hash } from '../external-trade/policy.js';
import { AGENT_STATE_SCHEMA_VERSION } from '../agent-state/types.js';
import { SIMULATION_CLOCK_STORE_SCHEMA_VERSION, type BoundSimulationEventStamp } from '../simulation-clock/types.js';
import { readProductionEvidence } from '../production-workflow/evidence.js';
import type { DependencyOptions } from './types.js';

export type Observation<T> = { status: 'available'; value: T; digest: string } | { status: 'unavailable' | 'invalid'; reason: string; unverifiedRows?: number };
class LegacyProductionSource extends Error { constructor(readonly count: number) { super('Legacy production lacks audited lot receipts; no historical backfill is permitted'); } }
function capture<T>(path: string, read: () => T): Observation<T> {
    if (!existsSync(path)) return { status: 'unavailable', reason: 'Native source absent; no database or history created.' };
    try { const value = read(); return { status: 'available', value, digest: digest(value) }; }
    catch (error) { return error instanceof LegacyProductionSource ? { status: 'unavailable', reason: error.message, unverifiedRows: error.count }
        : { status: 'invalid', reason: error instanceof Error ? error.message : 'Invalid native source' }; }
}
export function collectDependencySources(options: DependencyOptions) {
    // Read publishers before clock bindings to respect their commit/publication ordering.
    const trades = capture(options.enginePath, () => readNativeTradeLedger(options.enginePath));
    const production = capture(options.productionPath, () => readDatabase(options.productionPath, db => {
        const table = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_production_evidence_schema'").get();
        if (!table) {
            const steps = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_production_step'").get();
            throw new LegacyProductionSource(steps ? (db.query('SELECT COUNT(*) AS count FROM business_production_step').get() as any).count : 0);
        }
        return readProductionEvidence(db);
    }));
    const agents = capture(options.agentPath, () => readDatabase(options.agentPath, db => {
        check((db.query('PRAGMA user_version').get() as any).user_version === AGENT_STATE_SCHEMA_VERSION, 'Unsupported AgentState schema');
        const identities = db.query('SELECT agent_id,player_username,created_at,updated_at,revision FROM agent_identity ORDER BY agent_id').all() as any[],
            memberships = db.query('SELECT * FROM agent_population_member ORDER BY agent_id').all() as any[];
        check(identities.length <= 100000 && memberships.length <= 100000, 'Agent source exceeds limit');
        for (const row of identities) { key(row.agent_id); time(row.created_at); time(row.updated_at); integer(row.revision); }
        for (const row of memberships) {
            key(row.agent_id); key(row.player_username); key(row.simulation_clock_id); hash(row.simulation_clock_profile_digest);
            time(row.joined_at_simulation_time); time(row.created_at);
            check(['active', 'reset'].includes(row.status) && (row.status === 'reset' ? !!time(row.reset_at_simulation_time) : row.reset_at_simulation_time === null), 'Invalid population membership interval');
            check(identities.some(identity => identity.agent_id === row.agent_id && identity.player_username === row.player_username), 'Population avatar identity binding differs');
        }
        return { identities, memberships };
    }));
    const clock = capture(options.clockPath, () => readDatabase(options.clockPath, db => {
        check((db.query('PRAGMA user_version').get() as any).user_version === SIMULATION_CLOCK_STORE_SCHEMA_VERSION, 'Unsupported clock schema');
        const rows = db.query("SELECT * FROM simulation_event_stamp WHERE domain IN ('engine-trade','business-production') ORDER BY clock_id,sequence").all() as any[];
        check(rows.length <= 100000, 'Clock source exceeds limit');
        return rows.map(row => {
            key(row.clock_id); hash(row.source_digest); hash(row.profile_digest); time(row.wall_time); time(row.simulation_time);
            check(integer(row.sequence) > 0 && ['running', 'paused'].includes(row.clock_status), 'Invalid clock stamp');
            return { clockId: row.clock_id, domain: row.domain, sourceId: row.source_id, sourceDigest: row.source_digest,
                wallTime: row.wall_time, simulationTime: row.simulation_time, sequence: row.sequence, engineTick: row.engine_tick,
                profileDigest: row.profile_digest, status: row.clock_status, revision: row.clock_revision } as BoundSimulationEventStamp;
        });
    }));
    return { trades, production, agents, clock };
}
export type DependencySources = ReturnType<typeof collectDependencySources>;
