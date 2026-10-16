import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { evaluatePopulationAge } from '../population-lifecycle/age.js';
import { validateEngineHealthDamage, type EngineHealthDamageRecord } from '../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { healthDigest, healthInteger, healthKey, healthTime, validateHealthPolicy } from './policy.js';
import type { HealthContext, PopulationHealthState, PopulationHealthView } from './types.js';
import { verifyHealthTreatment, type HealthTreatmentAuthority, type HealthTreatmentReceipt } from './treatment.js';

const ZERO = '0'.repeat(64), DENOMINATOR = 36_000_000_000n;
interface StateRow { agent_id: string; state_json: string; state_digest: string }
interface EventRow { sequence: number; event_id: string; payload_json: string; digest: string; previous_hash: string; entry_hash: string }
export interface HealthAuditEvent {
    eventId: string; kind: 'injury' | 'recovery' | 'treatment' | 'policy-migration'; agentId: string;
    evidence: unknown; after: PopulationHealthState;
}

function membershipDigest(context: HealthContext): string {
    const member = context.member;
    return healthDigest({ agentId: member.agentId, worldProfile: member.worldProfile, lifecyclePolicy: member.lifecyclePolicy,
        simulationClock: member.simulationClock, sourceResultDigest: member.sourceResultDigest,
        joinedAtSimulationTime: member.joinedAtSimulationTime, lifecycleCreatedAtSimulationTime: member.characterLifecycle.createdAtSimulationTime });
}
function guard(context: HealthContext, state?: PopulationHealthState, active = false) {
    const { digest, ...definition } = context.policy, policy = validateHealthPolicy(definition);
    if (policy.digest !== digest || healthDigest(policy.agePolicy) !== healthDigest({ policyId: context.agePolicy.policyId,
        version: context.agePolicy.version, digest: context.agePolicy.digest })) throw new Error('Health policy binding is stale');
    const age = evaluatePopulationAge(context.member, context.clock, context.agePolicy);
    if (state && (state.membershipDigest !== membershipDigest(context) || state.clockId !== context.clock.clockId
        || state.clockProfileDigest !== context.clock.profileDigest || state.policy.digest !== policy.digest)) {
        throw new Error('Health state membership/clock/policy binding is stale');
    }
    if (active && (context.member.status !== 'active' || context.member.characterLifecycle.status !== 'active')) {
        throw new Error('Health mutation requires an active finite population member');
    }
    return age;
}

export class PopulationHealthStore {
    private readonly database: Database;
    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        try {
            this.database.run('PRAGMA journal_mode=WAL');
            const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
            if (version > 1) throw new Error('Population health schema is newer than supported');
            this.database.transaction(() => {
                this.database.run(`CREATE TABLE IF NOT EXISTS population_health_state(agent_id TEXT PRIMARY KEY,
                    state_json TEXT NOT NULL,state_digest TEXT NOT NULL)`);
                this.database.run(`CREATE TABLE IF NOT EXISTS population_health_event(sequence INTEGER PRIMARY KEY,
                    event_id TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,digest TEXT NOT NULL,
                    previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL)`);
                this.database.run('CREATE TABLE IF NOT EXISTS population_health_source_cursor(source_id TEXT PRIMARY KEY,sequence INTEGER NOT NULL,event_digest TEXT NOT NULL)');
                this.database.run('PRAGMA user_version=1');
            }).immediate();
            this.verify();
        } catch (error) { this.database.close(true); throw error; }
    }
    close() { this.database.close(true); }
    verify(): void {
        let previous = ZERO;
        const latest = new Map<string, string>();
        for (const row of this.database.query('SELECT * FROM population_health_event ORDER BY sequence').all() as EventRow[]) {
            const payload = JSON.parse(row.payload_json) as HealthAuditEvent;
            if (row.event_id !== payload.eventId || payload.agentId !== payload.after.agentId
                || row.digest !== healthDigest(payload) || row.previous_hash !== previous
                || row.entry_hash !== healthDigest({ previous, sequence: row.sequence, eventId: row.event_id, digest: row.digest })) {
                throw new Error('Population health event audit is invalid');
            }
            latest.set(payload.agentId, healthDigest(payload.after)); previous = row.entry_hash;
        }
        const states = this.database.query('SELECT * FROM population_health_state').all() as StateRow[];
        if (states.length !== latest.size) throw new Error('Population health snapshot history is missing');
        for (const row of states) if (healthDigest(JSON.parse(row.state_json)) !== row.state_digest
            || row.state_digest !== latest.get(row.agent_id)) throw new Error('Population health snapshot audit is invalid');
    }
    events(): HealthAuditEvent[] {
        this.verify();
        return (this.database.query('SELECT * FROM population_health_event ORDER BY sequence').all() as EventRow[])
            .map(row => JSON.parse(row.payload_json));
    }
    sourceCursor(sourceId: string): { sequence: number; eventDigest: string } {
        const row = this.database.query('SELECT sequence,event_digest FROM population_health_source_cursor WHERE source_id=?1')
            .get(healthKey(sourceId)) as { sequence: number; event_digest: string } | null;
        return row ? { sequence: row.sequence, eventDigest: row.event_digest } : { sequence: 0, eventDigest: ZERO };
    }
    acknowledgeSource(sourceId: string, sequence: number, eventDigest: string): void {
        healthKey(sourceId); healthInteger(sequence, 1, Number.MAX_SAFE_INTEGER);
        if (!/^[a-f0-9]{64}$/.test(eventDigest)) throw new Error('Health source cursor digest is invalid');
        this.database.transaction(() => {
            const current = this.sourceCursor(sourceId);
            if (sequence !== current.sequence + 1) throw new Error('Health source sequence has a gap');
            this.database.run(`INSERT INTO population_health_source_cursor VALUES(?1,?2,?3)
                ON CONFLICT(source_id) DO UPDATE SET sequence=excluded.sequence,event_digest=excluded.event_digest`, [sourceId, sequence, eventDigest]);
        }).immediate();
    }
    private raw(agentId: string): PopulationHealthState | null {
        const row = this.database.query('SELECT * FROM population_health_state WHERE agent_id=?1').get(healthKey(agentId)) as StateRow | null;
        return row ? JSON.parse(row.state_json) : null;
    }
    private existing(eventId: string): HealthAuditEvent | null {
        const row = this.database.query('SELECT payload_json FROM population_health_event WHERE event_id=?1').get(eventId) as { payload_json: string } | null;
        return row ? JSON.parse(row.payload_json) : null;
    }
    private commit(event: HealthAuditEvent) {
        const last = this.database.query('SELECT sequence,entry_hash FROM population_health_event ORDER BY sequence DESC LIMIT 1')
            .get() as { sequence: number; entry_hash: string } | null;
        const sequence = (last?.sequence ?? 0) + 1, previous = last?.entry_hash ?? ZERO, digest = healthDigest(event);
        this.database.run('INSERT INTO population_health_event VALUES(?1,?2,?3,?4,?5,?6)',
            [sequence, event.eventId, JSON.stringify(event), digest, previous, healthDigest({ previous, sequence, eventId: event.eventId, digest })]);
        this.database.run(`INSERT INTO population_health_state VALUES(?1,?2,?3)
            ON CONFLICT(agent_id) DO UPDATE SET state_json=excluded.state_json,state_digest=excluded.state_digest`,
            [event.agentId, JSON.stringify(event.after), healthDigest(event.after)]);
    }
    get(context: HealthContext): PopulationHealthView | null {
        this.verify(); const state = this.raw(context.member.agentId); guard(context, state ?? undefined);
        if (!state) return null;
        const burden = Math.min(10000, state.injuries.reduce((total, injury) => total + injury.remainingBurden, 0));
        const inactive = context.member.status !== 'active' || context.member.characterLifecycle.status !== 'active';
        return { state, status: inactive ? 'inactive' : burden >= context.policy.criticalBurden ? 'critical' : burden > 0 ? 'injured' : 'well',
            injuryBurden: burden, restRequired: !inactive && burden > 0,
            treatmentRequired: !inactive && state.injuries.some(injury => injury.treatmentRequired && !injury.treated),
            workloadCapacityBasisPoints: inactive ? 0 : 10000 - burden };
    }
    /** Trusted operator migration may add verified care protocols without rewriting biological history. */
    addTreatmentProtocols(context: HealthContext, previousPolicy: HealthContext['policy'],
        expectedRevision: number, migrationId: string): PopulationHealthView {
        guard(context, undefined, true); healthKey(migrationId);
        const { digest: oldDigest, ...oldDefinition } = previousPolicy;
        if (validateHealthPolicy(oldDefinition).digest !== oldDigest) throw new Error('Previous health policy digest is stale');
        const { digest: _newDigest, ...newDefinition } = context.policy;
        const oldVersion = previousPolicy.version.split('.').map(BigInt), newVersion = context.policy.version.split('.').map(BigInt);
        const changedPart = newVersion.findIndex((part, index) => part !== oldVersion[index]);
        const biological = (definition: typeof oldDefinition) => {
            const { version: _version, treatments: _treatments, ...rest } = definition;
            return rest;
        };
        if (changedPart < 0 || newVersion[changedPart]! < oldVersion[changedPart]!
            || context.policy.treatments.length <= previousPolicy.treatments.length
            || healthDigest(biological(newDefinition)) !== healthDigest(biological(oldDefinition))
            || previousPolicy.treatments.some(old => !context.policy.treatments.some(next => healthDigest(next) === healthDigest(old)))) {
            throw new Error('Health migration may only add treatments in a new version with unchanged biology');
        }
        const evidence = { migrationId, expectedRevision, previousPolicyDigest: oldDigest, nextPolicyDigest: context.policy.digest };
        this.database.transaction(() => {
            this.verify(); const eventId = `policy-migration:${migrationId}`, prior = this.existing(eventId);
            if (prior) {
                if (prior.agentId !== context.member.agentId || healthDigest(prior.evidence) !== healthDigest(evidence)) throw new Error('Health migration replay conflict');
                return;
            }
            const state = this.raw(context.member.agentId);
            if (!state || state.revision !== expectedRevision) throw new Error('Health migration revision changed');
            guard({ ...context, policy: previousPolicy }, state, true);
            state.policy = { policyId: context.policy.policyId, version: context.policy.version, digest: context.policy.digest };
            state.revision++;
            this.commit({ eventId, kind: 'policy-migration', agentId: state.agentId, evidence, after: state });
        }).immediate();
        return this.get(context)!;
    }
    /** Trusted runtime reads the engine's read-only verified ledger before admitting this record. */
    ingestDamage(context: HealthContext, evidence: EngineHealthDamageRecord): PopulationHealthView {
        const { sequence, eventDigest, ...facts } = evidence;
        validateEngineHealthDamage(facts);
        if (healthDigest(facts) !== eventDigest || evidence.username !== context.member.playerUsername
            || !Number.isSafeInteger(sequence) || sequence < 1 || evidence.hpBefore <= evidence.hpAfter
            || evidence.maxHp < 1 || evidence.hpAfter < 0) throw new Error('Health damage evidence is invalid');
        guard(context, undefined, true);
        const eventId = `engine-damage:${evidence.eventId}`;
        this.database.transaction(() => {
            this.verify(); const prior = this.existing(eventId), current = this.raw(context.member.agentId);
            if (prior) {
                if (prior.agentId !== context.member.agentId || healthDigest(prior.evidence) !== healthDigest(evidence)) {
                    throw new Error('Health damage evidence replay conflict');
                }
                return;
            }
            guard(context, current ?? undefined, true);
            const at = context.clock.simulationTime;
            if (current && healthTime(at) < healthTime(current.observedAtSimulationTime)) throw new Error('Health damage time moved backwards');
            const burden = Math.min(10000, Math.max(1, Math.ceil((evidence.hpBefore - evidence.hpAfter) * 10000 / evidence.maxHp)));
            const state: PopulationHealthState = current ?? { agentId: context.member.agentId,
                membershipDigest: membershipDigest(context), clockId: context.clock.clockId, clockProfileDigest: context.clock.profileDigest,
                policy: { policyId: context.policy.policyId, version: context.policy.version, digest: context.policy.digest },
                observedAtSimulationTime: at, latestInjuryAtSimulationTime: at, injuries: [], recoveryRemainder: 0, revision: 0 };
            if (state.injuries.length >= context.policy.maximumOpenInjuries) throw new Error('Health open injury capacity exhausted');
            state.injuries.push({ injuryId: eventId, sourceEventId: evidence.eventId, originalBurden: burden,
                remainingBurden: burden, treatmentRequired: burden >= context.policy.treatmentRequiredBurden,
                treated: false });
            state.observedAtSimulationTime = at; state.latestInjuryAtSimulationTime = at; state.revision++;
            this.commit({ eventId, kind: 'injury', agentId: state.agentId, evidence, after: state });
        }).immediate();
        return this.get(context)!;
    }
    advance(context: HealthContext, sourcesVerified = true): PopulationHealthView | null {
        this.database.transaction(() => {
            this.verify(); const state = this.raw(context.member.agentId), age = guard(context, state ?? undefined);
            if (!state || context.member.status !== 'active' || context.member.characterLifecycle.status !== 'active') return;
            const from = healthTime(state.observedAtSimulationTime), to = healthTime(context.clock.simulationTime);
            if (to < from) throw new Error('Health observation time moved backwards');
            if (to === from) return;
            const player = context.playerTime, sleep = player?.sleepContext;
            let start = to, end = to;
            if (sourcesVerified && age.status === 'known' && player && player.clockId === state.clockId && player.playerId === context.member.playerUsername
                && player.rest === 'sleeping' && sleep && healthTime(player.updatedAt) <= to
                && healthTime(sleep.startedAtSimulationTime) > healthTime(state.latestInjuryAtSimulationTime)
                && (player.presence === 'online' || sleep.access.kind === 'bed-entitlement')) {
                start = Math.max(from, healthTime(sleep.startedAtSimulationTime), healthTime(player.restChangedAt),
                    healthTime(context.member.characterLifecycle.birthAtSimulationTime!));
                end = sleep.access.validUntilSimulationTime === null ? to : Math.min(to, healthTime(sleep.access.validUntilSimulationTime));
            }
            const segments: Array<{ duration: number; multiplier: number }> = [];
            if (end > start) {
                const birth = BigInt(healthTime(context.member.characterLifecycle.birthAtSimulationTime!));
                const year = BigInt(context.agePolicy.simulationMillisecondsPerYear);
                const cuts = [start, ...context.agePolicy.stages.map(stage => birth + BigInt(stage.fromAgeYears) * year)
                    .filter(cut => cut > BigInt(start) && cut < BigInt(end)).map(Number), end];
                for (let index = 0; index < cuts.length - 1; index++) {
                    const at = cuts[index]!, ageAt = BigInt(at) - birth;
                    const stage = [...context.agePolicy.stages].reverse().find(entry => ageAt >= BigInt(entry.fromAgeYears) * year)!;
                    segments.push({ duration: cuts[index + 1]! - at, multiplier: stage.modifiers.regenerationBasisPoints });
                }
            }
            for (const segment of segments) {
                const numerator = BigInt(state.recoveryRemainder) + BigInt(segment.duration)
                    * BigInt(context.policy.recoveryBurdenPerSimulationHour) * BigInt(segment.multiplier);
                let budget = numerator / DENOMINATOR;
                state.recoveryRemainder = Number(numerator % DENOMINATOR);
                for (const injury of state.injuries) {
                    const floor = injury.treatmentRequired && !injury.treated
                        ? Math.min(injury.originalBurden, context.policy.untreatedRecoveryFloor) : 0;
                    const capacity = BigInt(injury.remainingBurden - floor);
                    const relief = budget > capacity ? capacity : budget;
                    injury.remainingBurden -= Number(relief); budget -= relief;
                }
                if (state.injuries.every(injury => injury.remainingBurden === (injury.treatmentRequired && !injury.treated
                    ? Math.min(injury.originalBurden, context.policy.untreatedRecoveryFloor) : 0))) state.recoveryRemainder = 0;
            }
            state.injuries = state.injuries.filter(injury => injury.remainingBurden > 0);
            state.observedAtSimulationTime = context.clock.simulationTime; state.revision++;
            this.commit({ eventId: `recovery:${healthDigest({ agent: state.agentId, revision: state.revision, to })}`,
                kind: 'recovery', agentId: state.agentId,
                evidence: { fromSimulationTime: new Date(from).toISOString(), toSimulationTime: context.clock.simulationTime,
                    playerTime: player, sourcesVerified, segments, agePolicy: context.policy.agePolicy }, after: state });
        }).immediate();
        return this.get(context);
    }
    treat(context: HealthContext, receiptId: string, expectedRevision: number,
        authority: HealthTreatmentAuthority): PopulationHealthView {
        guard(context, undefined, true);
        const receipt = verifyHealthTreatment(context, receiptId, authority);
        this.database.transaction(() => {
            this.verify(); const eventId = `treatment:${receipt.receiptId}`, prior = this.existing(eventId);
            if (prior) {
                if (prior.agentId !== context.member.agentId || healthDigest(prior.evidence) !== healthDigest(receipt)) throw new Error('Health treatment replay conflict');
                return;
            }
            const state = this.raw(context.member.agentId);
            if (!state) throw new Error('Health treatment requires an initialized injury state');
            guard(context, state, true);
            if (state.revision !== expectedRevision) throw new Error('Health treatment revision changed');
            if (state.observedAtSimulationTime !== context.clock.simulationTime) throw new Error('Advance health before applying treatment');
            const injury = state.injuries.find(item => item.injuryId === receipt.injuryId);
            if (!injury || injury.treated) throw new Error('Health treatment requires an open untreated injury');
            const injuryEvent = this.existing(receipt.injuryId);
            if (!injuryEvent || healthTime(receipt.completedAtSimulationTime) < healthTime(injuryEvent.after.latestInjuryAtSimulationTime)) {
                throw new Error('Health treatment cannot precede its injury');
            }
            if (this.events().some(event => event.kind === 'treatment'
                && (event.evidence as HealthTreatmentReceipt).runId === receipt.runId)) throw new Error('Health treatment run was already consumed');
            const treatment = context.policy.treatments.find(item => item.treatmentId === receipt.treatmentId)!;
            injury.treated = true; injury.remainingBurden = Math.max(0, injury.remainingBurden - treatment.reliefBurden);
            state.recoveryRemainder = 0; state.injuries = state.injuries.filter(item => item.remainingBurden > 0);
            state.revision++;
            this.commit({ eventId, kind: 'treatment', agentId: state.agentId, evidence: receipt, after: state });
        }).immediate();
        return this.get(context)!;
    }
}
