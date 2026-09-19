import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { simulationClockProfileDigest, validateSimulationClockProfile } from './profile.js';
import { SIMULATION_CLOCK_SCHEMA_VERSION, SIMULATION_CLOCK_STORE_SCHEMA_VERSION,
    type BindSimulationEventInput, type BoundSimulationEventStamp, type CreateSimulationClockInput,
    type SimulationClockObservation, type SimulationClockProfile, type SimulationClockState,
    type SimulationClockStatus, type SimulationEventStamp, type PlayerPresence,
    type PlayerRestState, type PlayerSleepContext, type PlayerTimeCapabilities,
    type PlayerTimeState, type StartPlayerSleepInput } from './types.js';

type ClockRow = { clock_id: string; profile_json: string; profile_digest: string; status: SimulationClockStatus;
    anchor_wall_ms: number; anchor_simulation_ms: number; last_observed_wall_ms: number;
    last_simulation_ms: number; next_event_sequence: number; revision: number; created_at: string; updated_at: string };
type EventStampRow = { clock_id: string; domain: string; source_id: string; source_digest: string;
    sequence: number; wall_time: string; simulation_time: string; engine_tick: number | null;
    profile_digest: string; clock_status: SimulationClockStatus; clock_revision: number; created_at: string };
type PlayerTimeRow = { clock_id: string; player_id: string; presence: PlayerPresence; rest: PlayerRestState;
    offline_delegation: 'disabled'; presence_changed_at: string; rest_changed_at: string;
    updated_at: string; updated_wall_time: string; revision: number; sleeper_kind: string | null;
    sleep_place_id: string | null; sleep_access_kind: string | null; sleep_access_evidence_id: string | null;
    sleep_access_source_digest: string | null; sleep_access_valid_until: string | null };

function clockId(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(normalized)) throw new Error('Simulation clock id is invalid');
    return normalized;
}

function timestamp(value: string, label: string): { iso: string; milliseconds: number } {
    const milliseconds = Date.parse(value);
    if (!Number.isSafeInteger(milliseconds)) throw new Error(`${label} must be a canonical UTC ISO timestamp`);
    const iso = new Date(milliseconds).toISOString();
    if (value !== iso) throw new Error(`${label} must be a canonical UTC ISO timestamp`);
    return { iso, milliseconds };
}

function engineTick(value: number | undefined): number | null {
    if (value === undefined) return null;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Engine tick must be a non-negative integer');
    return value;
}

function eventKey(value: string, label: string, maximum: number): string {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized.length > maximum || !/^[a-z0-9][a-z0-9.:-]*$/.test(normalized)) {
        throw new Error(`${label} is invalid`);
    }
    return normalized;
}

function eventDigest(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error('Simulation event source digest is invalid');
    return normalized;
}

function playerId(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9 _-]{0,63}$/.test(normalized)) throw new Error('Simulation player id is invalid');
    return normalized;
}

function sleepKey(value: string, label: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(normalized)) throw new Error(`${label} is invalid`);
    return normalized;
}

function sleepInput(value: StartPlayerSleepInput, simulationTime: string): StartPlayerSleepInput {
    if (!value || typeof value !== 'object' || (value.sleeperKind !== 'npc-agent'
        && value.sleeperKind !== 'human-player')) throw new Error('Sleeper kind is invalid');
    if (Object.keys(value).sort().join(',') !== 'access,sleepPlaceId,sleeperKind') {
        throw new Error('Sleep admission fields are invalid');
    }
    if (!value.access || (value.access.kind !== 'physical-presence'
        && value.access.kind !== 'bed-entitlement')) throw new Error('Sleep access kind is invalid');
    if (Object.keys(value.access).sort().join(',')
        !== 'evidenceId,kind,sourceDigest,validUntilSimulationTime') {
        throw new Error('Sleep access evidence fields are invalid');
    }
    if (value.sleeperKind === 'human-player' && value.access.kind !== 'bed-entitlement') {
        throw new Error('Human player sleep requires a bed entitlement');
    }
    const sourceDigest = eventDigest(value.access.sourceDigest);
    const validUntilSimulationTime = value.access.validUntilSimulationTime === null ? null
        : timestamp(value.access.validUntilSimulationTime, 'Sleep access expiry').iso;
    if (validUntilSimulationTime !== null && validUntilSimulationTime < simulationTime) {
        throw new Error('Sleep access evidence has expired');
    }
    return { sleeperKind: value.sleeperKind, sleepPlaceId: sleepKey(value.sleepPlaceId, 'Sleep place id'),
        access: { kind: value.access.kind, evidenceId: sleepKey(value.access.evidenceId, 'Sleep access evidence id'),
            sourceDigest, validUntilSimulationTime } };
}

function safeMilliseconds(value: bigint): number {
    const result = Number(value);
    if (!Number.isSafeInteger(result) || Math.abs(result) > 8_640_000_000_000_000) {
        throw new Error('Projected simulation time exceeds the safe timestamp range');
    }
    return result;
}

function profile(row: ClockRow): SimulationClockProfile {
    const parsed = validateSimulationClockProfile(JSON.parse(row.profile_json) as unknown);
    if (simulationClockProfileDigest(parsed) !== row.profile_digest) {
        throw new Error(`Simulation clock profile digest mismatch for ${row.clock_id}`);
    }
    return parsed;
}

function state(row: ClockRow): SimulationClockState {
    return { schemaVersion: SIMULATION_CLOCK_SCHEMA_VERSION, clockId: row.clock_id, profile: profile(row),
        profileDigest: row.profile_digest, status: row.status,
        anchorWallTime: new Date(row.anchor_wall_ms).toISOString(),
        anchorSimulationTime: new Date(row.anchor_simulation_ms).toISOString(),
        lastObservedWallTime: new Date(row.last_observed_wall_ms).toISOString(),
        lastSimulationTime: new Date(row.last_simulation_ms).toISOString(),
        nextEventSequence: row.next_event_sequence, revision: row.revision,
        createdAt: row.created_at, updatedAt: row.updated_at };
}

function projected(row: ClockRow, atWallMs: number): number {
    if (atWallMs < row.last_observed_wall_ms) throw new Error('Wall clock regression rejected');
    if (row.status === 'paused') return row.last_simulation_ms;
    const value = profile(row);
    const elapsed = BigInt(atWallMs - row.anchor_wall_ms);
    const advanced = elapsed * BigInt(value.rate.simulationMilliseconds)
        / BigInt(value.rate.wallMilliseconds);
    const simulationMs = safeMilliseconds(BigInt(row.anchor_simulation_ms) + advanced);
    if (simulationMs < row.last_simulation_ms) throw new Error('Simulation clock monotonicity violation');
    return simulationMs;
}

function observation(row: ClockRow, wallMs: number, simulationMs: number,
    tick: number | null): SimulationClockObservation {
    return { clockId: row.clock_id, wallTime: new Date(wallMs).toISOString(),
        simulationTime: new Date(simulationMs).toISOString(), engineTick: tick, status: row.status,
        profileDigest: row.profile_digest, revision: row.revision };
}

function boundStamp(row: EventStampRow): BoundSimulationEventStamp {
    return { clockId: row.clock_id, domain: row.domain, sourceId: row.source_id,
        sourceDigest: row.source_digest, sequence: row.sequence, wallTime: row.wall_time,
        simulationTime: row.simulation_time, engineTick: row.engine_tick, status: row.clock_status,
        profileDigest: row.profile_digest, revision: row.clock_revision };
}

function playerTimeState(row: PlayerTimeRow): PlayerTimeState {
    const sleepContext: PlayerSleepContext | null = row.rest === 'sleeping' && row.sleeper_kind
        && row.sleep_place_id && row.sleep_access_kind && row.sleep_access_evidence_id
        && row.sleep_access_source_digest ? {
            sleeperKind: row.sleeper_kind as PlayerSleepContext['sleeperKind'],
            sleepPlaceId: row.sleep_place_id,
            access: { kind: row.sleep_access_kind as PlayerSleepContext['access']['kind'],
                evidenceId: row.sleep_access_evidence_id, sourceDigest: row.sleep_access_source_digest,
                validUntilSimulationTime: row.sleep_access_valid_until },
            startedAtSimulationTime: row.rest_changed_at
        } : null;
    return { clockId: row.clock_id, playerId: row.player_id, presence: row.presence, rest: row.rest,
        sleepContext, offlineDelegation: row.offline_delegation, presenceChangedAt: row.presence_changed_at,
        restChangedAt: row.rest_changed_at, updatedAt: row.updated_at,
        updatedWallTime: row.updated_wall_time, revision: row.revision };
}

export function playerTimeCapabilities(value: PlayerTimeState): PlayerTimeCapabilities {
    const physicalExecutionAllowed = value.presence === 'online' && value.rest === 'awake';
    const reason = value.rest === 'sleeping' ? 'Sleeping is an explicit physical state.'
        : value.presence === 'offline' ? 'Offline avatars cannot execute physical actions.'
            : 'The online, awake avatar may execute bounded physical actions.';
    return { worldClockAdvances: true, physicalExecutionAllowed,
        offlineDelegationAllowed: false, reason };
}

export class SimulationClockStore {
    private readonly database: Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        try {
            this.migrate();
            this.database.run('PRAGMA journal_mode = WAL');
        } catch (error) {
            this.database.close(true);
            throw error;
        }
    }

    close(): void { this.database.close(true); }

    get(inputClockId: string): SimulationClockState | null {
        const row = this.row(clockId(inputClockId));
        return row ? state(row) : null;
    }

    create(input: CreateSimulationClockInput): SimulationClockState {
        const id = clockId(input.clockId);
        const value = validateSimulationClockProfile(input.profile);
        const digest = simulationClockProfileDigest(value);
        const wall = timestamp(input.wallTime, 'Initial wall time');
        const simulation = timestamp(input.simulationTime, 'Initial simulation time');
        const status = input.status ?? 'running';
        if (status !== 'running' && status !== 'paused') throw new Error('Simulation clock status is invalid');
        const transaction = this.database.transaction(() => {
            if (this.row(id)) throw new Error(`Simulation clock already exists: ${id}`);
            this.database.run(`INSERT INTO simulation_clock
                (clock_id,profile_json,profile_digest,status,anchor_wall_ms,anchor_simulation_ms,
                last_observed_wall_ms,last_simulation_ms,next_event_sequence,revision,created_at,updated_at)
                VALUES (?1,?2,?3,?4,?5,?6,?5,?6,1,1,?7,?7)`,
            [id, JSON.stringify(value), digest, status, wall.milliseconds, simulation.milliseconds, wall.iso]);
        });
        transaction.immediate();
        return this.requireRowState(id);
    }

    observe(inputClockId: string, wallTime: string, inputEngineTick?: number): SimulationClockObservation {
        const id = clockId(inputClockId);
        const wall = timestamp(wallTime, 'Observation wall time');
        const tick = engineTick(inputEngineTick);
        let result!: SimulationClockObservation;
        const transaction = this.database.transaction(() => {
            const current = this.requireRow(id);
            const simulationMs = projected(current, wall.milliseconds);
            this.database.run(`UPDATE simulation_clock SET last_observed_wall_ms=?2,last_simulation_ms=?3,
                updated_at=?4 WHERE clock_id=?1`, [id, wall.milliseconds, simulationMs, wall.iso]);
            result = observation({ ...current, last_observed_wall_ms: wall.milliseconds,
                last_simulation_ms: simulationMs, updated_at: wall.iso }, wall.milliseconds, simulationMs, tick);
        });
        transaction.immediate();
        return result;
    }

    nextEventStamp(inputClockId: string, wallTime: string, inputEngineTick?: number): SimulationEventStamp {
        const id = clockId(inputClockId);
        const wall = timestamp(wallTime, 'Event wall time');
        const tick = engineTick(inputEngineTick);
        let result!: SimulationEventStamp;
        const transaction = this.database.transaction(() => {
            const current = this.requireRow(id);
            const simulationMs = projected(current, wall.milliseconds);
            const sequence = current.next_event_sequence;
            this.database.run(`UPDATE simulation_clock SET last_observed_wall_ms=?2,last_simulation_ms=?3,
                next_event_sequence=next_event_sequence+1,updated_at=?4 WHERE clock_id=?1`,
            [id, wall.milliseconds, simulationMs, wall.iso]);
            result = { ...observation(current, wall.milliseconds, simulationMs, tick), sequence };
        });
        transaction.immediate();
        return result;
    }

    /**
     * Allocates one immutable, replay-safe stamp for an existing durable domain event.
     * A crash after this commit and before the caller's own commit can safely replay the
     * same source identity and digest without consuming a second sequence.
     */
    bindEvent(input: BindSimulationEventInput): { created: boolean; stamp: BoundSimulationEventStamp } {
        const id = clockId(input.clockId);
        const domain = eventKey(input.domain, 'Simulation event domain', 64);
        const sourceId = eventKey(input.sourceId, 'Simulation event source id', 500);
        const digest = eventDigest(input.sourceDigest);
        const wall = timestamp(input.wallTime, 'Simulation event binding wall time');
        const tick = engineTick(input.engineTick);
        let result!: { created: boolean; stamp: BoundSimulationEventStamp };
        const transaction = this.database.transaction(() => {
            const existing = this.eventRow(id, domain, sourceId);
            if (existing) {
                if (existing.source_digest !== digest) {
                    throw new Error('Simulation event source identity was reused with a different digest');
                }
                result = { created: false, stamp: boundStamp(existing) };
                return;
            }
            const current = this.requireRow(id);
            const simulationMs = projected(current, wall.milliseconds);
            const sequence = current.next_event_sequence;
            if (!Number.isSafeInteger(sequence) || sequence < 1) {
                throw new Error('Simulation event sequence is outside the safe integer range');
            }
            this.database.run(`INSERT INTO simulation_event_stamp
                (clock_id,domain,source_id,source_digest,sequence,wall_time,simulation_time,engine_tick,
                profile_digest,clock_status,clock_revision,created_at)
                VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?6)`,
            [id, domain, sourceId, digest, sequence, wall.iso, new Date(simulationMs).toISOString(), tick,
                current.profile_digest, current.status, current.revision]);
            this.database.run(`UPDATE simulation_clock SET last_observed_wall_ms=?2,last_simulation_ms=?3,
                next_event_sequence=next_event_sequence+1,updated_at=?4 WHERE clock_id=?1`,
            [id, wall.milliseconds, simulationMs, wall.iso]);
            result = { created: true, stamp: boundStamp(this.eventRow(id, domain, sourceId)!) };
        });
        transaction.immediate();
        return result;
    }

    getBoundEvent(inputClockId: string, domainInput: string, sourceIdInput: string): BoundSimulationEventStamp | null {
        const row = this.eventRow(clockId(inputClockId), eventKey(domainInput, 'Simulation event domain', 64),
            eventKey(sourceIdInput, 'Simulation event source id', 500));
        return row ? boundStamp(row) : null;
    }

    listBoundEvents(inputClockId: string, afterSequence = 0, limit = 100): BoundSimulationEventStamp[] {
        const id = clockId(inputClockId);
        if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
            throw new Error('Simulation event cursor is invalid');
        }
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
            throw new Error('Simulation event limit must be between 1 and 1000');
        }
        return (this.database.query(`SELECT * FROM simulation_event_stamp
            WHERE clock_id=?1 AND sequence>?2 ORDER BY sequence LIMIT ?3`)
            .all(id, afterSequence, limit) as EventStampRow[]).map(boundStamp);
    }

    getPlayerTimeState(inputClockId: string, inputPlayerId: string): PlayerTimeState | null {
        const row = this.database.query(`SELECT * FROM simulation_player_time_state
            WHERE clock_id=?1 AND player_id=?2`).get(clockId(inputClockId), playerId(inputPlayerId)) as PlayerTimeRow | null;
        return row ? playerTimeState(row) : null;
    }

    listPlayerTimeStates(inputClockId: string): PlayerTimeState[] {
        return (this.database.query(`SELECT * FROM simulation_player_time_state
            WHERE clock_id=?1 ORDER BY player_id`).all(clockId(inputClockId)) as PlayerTimeRow[])
            .map(playerTimeState);
    }

    recordPlayerPresence(inputClockId: string, inputPlayerId: string,
        presence: PlayerPresence, wallTime: string, inputEngineTick?: number): PlayerTimeState {
        if (presence !== 'online' && presence !== 'offline') throw new Error('Player presence is invalid');
        return this.transitionPlayerTime(inputClockId, inputPlayerId, 'presence', presence, wallTime, inputEngineTick);
    }

    recordPlayerRest(inputClockId: string, inputPlayerId: string,
        rest: PlayerRestState, wallTime: string, inputEngineTick?: number): PlayerTimeState {
        if (rest !== 'awake' && rest !== 'sleeping') throw new Error('Player rest state is invalid');
        if (rest === 'sleeping') throw new Error('Starting sleep requires verified sleep-place access');
        return this.transitionPlayerTime(inputClockId, inputPlayerId, 'rest', rest, wallTime, inputEngineTick);
    }

    startPlayerSleep(inputClockId: string, inputPlayerId: string, input: StartPlayerSleepInput,
        wallTime: string, inputEngineTick?: number): PlayerTimeState {
        return this.transitionPlayerTime(inputClockId, inputPlayerId, 'rest', 'sleeping', wallTime,
            inputEngineTick, input);
    }

    private transitionPlayerTime(inputClockId: string, inputPlayerId: string,
        field: 'presence' | 'rest', value: PlayerPresence | PlayerRestState,
        wallTime: string, inputEngineTick?: number, sleepAdmission?: StartPlayerSleepInput): PlayerTimeState {
        const id = clockId(inputClockId), player = playerId(inputPlayerId);
        const wall = timestamp(wallTime, 'Player time transition wall time');
        engineTick(inputEngineTick);
        const transaction = this.database.transaction(() => {
            const clock = this.requireRow(id); const simulationMs = projected(clock, wall.milliseconds);
            const simulationTime = new Date(simulationMs).toISOString();
            const current = this.getPlayerTimeState(id, player);
            const admission = sleepAdmission ? sleepInput(sleepAdmission, simulationTime) : null;
            this.database.run(`UPDATE simulation_clock SET last_observed_wall_ms=?2,last_simulation_ms=?3,
                updated_at=?4 WHERE clock_id=?1`, [id, wall.milliseconds, simulationMs, wall.iso]);
            if (!current) {
                const presence = field === 'presence' ? value as PlayerPresence : 'offline';
                const rest = field === 'rest' ? value as PlayerRestState : 'awake';
                this.database.run(`INSERT INTO simulation_player_time_state
                    (clock_id,player_id,presence,rest,offline_delegation,presence_changed_at,
                    rest_changed_at,updated_at,updated_wall_time,revision)
                    VALUES(?1,?2,?3,?4,'disabled',?5,?5,?5,?6,1)`,
                [id, player, presence, rest, simulationTime, wall.iso]);
                if (admission) this.database.run(`UPDATE simulation_player_time_state SET
                    sleeper_kind=?3,sleep_place_id=?4,sleep_access_kind=?5,sleep_access_evidence_id=?6,
                    sleep_access_source_digest=?7,sleep_access_valid_until=?8 WHERE clock_id=?1 AND player_id=?2`,
                [id, player, admission.sleeperKind, admission.sleepPlaceId, admission.access.kind,
                    admission.access.evidenceId, admission.access.sourceDigest,
                    admission.access.validUntilSimulationTime]);
            } else if (current[field] !== value) {
                const changedColumn = field === 'presence' ? 'presence_changed_at' : 'rest_changed_at';
                const clearSleep = field === 'rest' && value === 'awake';
                this.database.run(`UPDATE simulation_player_time_state SET ${field}=?3,${changedColumn}=?4,
                    updated_at=?4,updated_wall_time=?5,revision=revision+1,
                    sleeper_kind=?6,sleep_place_id=?7,sleep_access_kind=?8,sleep_access_evidence_id=?9,
                    sleep_access_source_digest=?10,sleep_access_valid_until=?11
                    WHERE clock_id=?1 AND player_id=?2`, [id, player, value, simulationTime, wall.iso,
                    admission?.sleeperKind ?? (clearSleep ? null : current.sleepContext?.sleeperKind ?? null),
                    admission?.sleepPlaceId ?? (clearSleep ? null : current.sleepContext?.sleepPlaceId ?? null),
                    admission?.access.kind ?? (clearSleep ? null : current.sleepContext?.access.kind ?? null),
                    admission?.access.evidenceId ?? (clearSleep ? null : current.sleepContext?.access.evidenceId ?? null),
                    admission?.access.sourceDigest ?? (clearSleep ? null : current.sleepContext?.access.sourceDigest ?? null),
                    admission?.access.validUntilSimulationTime
                        ?? (clearSleep ? null : current.sleepContext?.access.validUntilSimulationTime ?? null)]);
            } else if (admission) {
                const existing = current.sleepContext;
                if (!existing || existing.sleeperKind !== admission.sleeperKind
                    || existing.sleepPlaceId !== admission.sleepPlaceId
                    || existing.access.kind !== admission.access.kind
                    || existing.access.evidenceId !== admission.access.evidenceId
                    || existing.access.sourceDigest !== admission.access.sourceDigest
                    || existing.access.validUntilSimulationTime !== admission.access.validUntilSimulationTime) {
                    throw new Error('Sleeping state already has different access evidence; wake before changing beds');
                }
            }
        });
        transaction.immediate();
        return this.getPlayerTimeState(id, player)!;
    }

    pause(inputClockId: string, expectedRevision: number, wallTime: string): SimulationClockState {
        return this.transition(inputClockId, expectedRevision, wallTime, 'paused');
    }

    resume(inputClockId: string, expectedRevision: number, wallTime: string): SimulationClockState {
        return this.transition(inputClockId, expectedRevision, wallTime, 'running');
    }

    reconfigure(inputClockId: string, expectedRevision: number, nextProfile: SimulationClockProfile,
        wallTime: string): SimulationClockState {
        const id = clockId(inputClockId);
        const wall = timestamp(wallTime, 'Reconfiguration wall time');
        const value = validateSimulationClockProfile(nextProfile);
        const digest = simulationClockProfileDigest(value);
        const transaction = this.database.transaction(() => {
            const current = this.requireRevision(id, expectedRevision);
            const simulationMs = projected(current, wall.milliseconds);
            const update = this.database.run(`UPDATE simulation_clock SET profile_json=?3,profile_digest=?4,
                anchor_wall_ms=?5,anchor_simulation_ms=?6,last_observed_wall_ms=?5,last_simulation_ms=?6,
                revision=revision+1,updated_at=?7 WHERE clock_id=?1 AND revision=?2`,
            [id, expectedRevision, JSON.stringify(value), digest, wall.milliseconds, simulationMs, wall.iso]);
            if (update.changes !== 1) throw new Error('Simulation clock changed before reconfiguration');
        });
        transaction.immediate();
        return this.requireRowState(id);
    }

    private transition(inputClockId: string, expectedRevision: number, wallTime: string,
        target: SimulationClockStatus): SimulationClockState {
        const id = clockId(inputClockId);
        const wall = timestamp(wallTime, 'Transition wall time');
        const transaction = this.database.transaction(() => {
            const current = this.requireRevision(id, expectedRevision);
            const simulationMs = projected(current, wall.milliseconds);
            if (current.status === target) {
                this.database.run(`UPDATE simulation_clock SET last_observed_wall_ms=?2,
                    last_simulation_ms=?3,updated_at=?4 WHERE clock_id=?1`,
                [id, wall.milliseconds, simulationMs, wall.iso]);
                return;
            }
            const update = this.database.run(`UPDATE simulation_clock SET status=?3,anchor_wall_ms=?4,
                anchor_simulation_ms=?5,last_observed_wall_ms=?4,last_simulation_ms=?5,
                revision=revision+1,updated_at=?6 WHERE clock_id=?1 AND revision=?2`,
            [id, expectedRevision, target, wall.milliseconds, simulationMs, wall.iso]);
            if (update.changes !== 1) throw new Error('Simulation clock changed before transition');
        });
        transaction.immediate();
        return this.requireRowState(id);
    }

    private row(id: string): ClockRow | null {
        return this.database.query('SELECT * FROM simulation_clock WHERE clock_id=?1').get(id) as ClockRow | null;
    }

    private eventRow(id: string, domain: string, sourceId: string): EventStampRow | null {
        return this.database.query(`SELECT * FROM simulation_event_stamp
            WHERE clock_id=?1 AND domain=?2 AND source_id=?3`).get(id, domain, sourceId) as EventStampRow | null;
    }

    private requireRow(id: string): ClockRow {
        const found = this.row(id);
        if (!found) throw new Error(`Unknown simulation clock: ${id}`);
        return found;
    }

    private requireRevision(id: string, expectedRevision: number): ClockRow {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
            throw new Error('Simulation clock revision is invalid');
        }
        const found = this.requireRow(id);
        if (found.revision !== expectedRevision) throw new Error('Simulation clock revision conflict');
        return found;
    }

    private requireRowState(id: string): SimulationClockState { return state(this.requireRow(id)); }

    private migrate(): void {
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > SIMULATION_CLOCK_STORE_SCHEMA_VERSION) {
            throw new Error(`Simulation clock schema ${version} is newer than supported version ${SIMULATION_CLOCK_STORE_SCHEMA_VERSION}`);
        }
        if (version < 1) {
            const migration = this.database.transaction(() => {
                this.database.run(`CREATE TABLE simulation_clock (
                    clock_id TEXT PRIMARY KEY,profile_json TEXT NOT NULL,profile_digest TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('running','paused')),
                    anchor_wall_ms INTEGER NOT NULL,anchor_simulation_ms INTEGER NOT NULL,
                    last_observed_wall_ms INTEGER NOT NULL,last_simulation_ms INTEGER NOT NULL,
                    next_event_sequence INTEGER NOT NULL CHECK(next_event_sequence>=1),
                    revision INTEGER NOT NULL CHECK(revision>=1),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
                    CHECK(last_observed_wall_ms>=anchor_wall_ms),
                    CHECK(last_simulation_ms>=anchor_simulation_ms))`);
                this.database.run('PRAGMA user_version = 1');
            });
            migration.immediate();
        }
        if (version < 2) {
            const migration = this.database.transaction(() => {
                this.database.run(`CREATE TABLE simulation_event_stamp (
                    clock_id TEXT NOT NULL REFERENCES simulation_clock(clock_id) ON DELETE RESTRICT,
                    domain TEXT NOT NULL,source_id TEXT NOT NULL,source_digest TEXT NOT NULL,
                    sequence INTEGER NOT NULL CHECK(sequence>=1),wall_time TEXT NOT NULL,
                    simulation_time TEXT NOT NULL,engine_tick INTEGER CHECK(engine_tick IS NULL OR engine_tick>=0),
                    profile_digest TEXT NOT NULL,clock_status TEXT NOT NULL CHECK(clock_status IN ('running','paused')),
                    clock_revision INTEGER NOT NULL CHECK(clock_revision>=1),
                    created_at TEXT NOT NULL,PRIMARY KEY(clock_id,domain,source_id),UNIQUE(clock_id,sequence))`);
                this.database.run('PRAGMA user_version = 2');
            });
            migration.immediate();
        }
        if (version < 3) {
            const migration = this.database.transaction(() => {
                this.database.run(`CREATE TABLE simulation_player_time_state (
                    clock_id TEXT NOT NULL REFERENCES simulation_clock(clock_id) ON DELETE RESTRICT,
                    player_id TEXT NOT NULL,presence TEXT NOT NULL CHECK(presence IN ('online','offline')),
                    rest TEXT NOT NULL CHECK(rest IN ('awake','sleeping')),
                    offline_delegation TEXT NOT NULL CHECK(offline_delegation='disabled'),
                    presence_changed_at TEXT NOT NULL,rest_changed_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,updated_wall_time TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK(revision>=1),PRIMARY KEY(clock_id,player_id))`);
                this.database.run('PRAGMA user_version = 3');
            });
            migration.immediate();
        }
        if (version < 4) {
            const migration = this.database.transaction(() => {
                this.database.run('ALTER TABLE simulation_player_time_state ADD COLUMN sleeper_kind TEXT');
                this.database.run('ALTER TABLE simulation_player_time_state ADD COLUMN sleep_place_id TEXT');
                this.database.run('ALTER TABLE simulation_player_time_state ADD COLUMN sleep_access_kind TEXT');
                this.database.run('ALTER TABLE simulation_player_time_state ADD COLUMN sleep_access_evidence_id TEXT');
                this.database.run('ALTER TABLE simulation_player_time_state ADD COLUMN sleep_access_source_digest TEXT');
                this.database.run('ALTER TABLE simulation_player_time_state ADD COLUMN sleep_access_valid_until TEXT');
                this.database.run('PRAGMA user_version = 4');
            });
            migration.immediate();
        }
    }
}
