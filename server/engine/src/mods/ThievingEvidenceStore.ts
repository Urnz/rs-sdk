import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { ThievingSightSnapshot } from './ThievingSightCandidates.js';
import type { EngineHousingStorageAccessSnapshot } from '../../../../housing/engine-storage-runtime.js';

export type EngineThievingKind = 'pickpocket' | 'lockpick-door' | 'container-theft' | 'property-burglary';
export type EngineThievingEffect = 'item-transfer' | 'lock-opened' | 'entry-completed';

export interface EngineThievingTarget {
    kind: 'npc' | 'loc';
    typeId: number;
    instanceIndex: number | null;
    name: string;
    x: number;
    z: number;
    level: number;
}

export interface EngineThievingItemDelta {
    itemId: number;
    itemName: string;
    quantity: number;
}

export interface EnginePropertyAccessSnapshot {
    propertyId: string;
    entryPointId: string;
    owner: { kind: 'player' | 'business' | 'faction'; id: string } | null;
    propertyStateVersion: number;
    actorAuthorized: boolean;
    /** Present for new Property entry events; legacy evidence remains readable without it. */
    lockLevel?: number;
}

export interface EngineThievingEvidence {
    eventId: string;
    playerUsername: string;
    procedureKind: EngineThievingKind;
    target: EngineThievingTarget;
    effect: EngineThievingEffect;
    transferredItems: EngineThievingItemDelta[];
    thievingXpDelta: number;
    startedAtEngineTick: number;
    endedAtEngineTick: number;
    occurredAt: string;
    propertyAccess?: EnginePropertyAccessSnapshot;
    storageAccess?: EngineHousingStorageAccessSnapshot;
    sightSnapshot?: ThievingSightSnapshot;
}

export interface EngineThievingEvidenceRecord extends EngineThievingEvidence {
    eventDigest: string;
    previousHash: string;
    recordHash: string;
}

interface EvidenceRow {
    sequence: number; event_id: string; player_username: string; procedure_kind: EngineThievingKind;
    target_json: string; effect: EngineThievingEffect; transferred_items_json: string;
    thieving_xp_delta: number; started_at_engine_tick: number; ended_at_engine_tick: number;
    occurred_at: string; property_access_json: string | null; storage_access_json: string | null;
    sight_snapshot_json: string | null;
    event_digest: string; previous_hash: string; record_hash: string;
}

const ZERO_HASH = '0'.repeat(64);

function digest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeEvidence(input: EngineThievingEvidence): EngineThievingEvidence {
    return { eventId: input.eventId, playerUsername: input.playerUsername,
        procedureKind: input.procedureKind, target: input.target, effect: input.effect,
        transferredItems: input.transferredItems, thievingXpDelta: input.thievingXpDelta,
        startedAtEngineTick: input.startedAtEngineTick, endedAtEngineTick: input.endedAtEngineTick,
        occurredAt: input.occurredAt, ...(input.propertyAccess ? { propertyAccess: input.propertyAccess } : {}),
        ...(input.storageAccess ? { storageAccess: input.storageAccess } : {}),
        ...(input.sightSnapshot ? { sightSnapshot: input.sightSnapshot } : {}) };
}

function evidenceFromRow(row: EvidenceRow): EngineThievingEvidenceRecord {
    const record: EngineThievingEvidenceRecord = {
        eventId: row.event_id,
        playerUsername: row.player_username,
        procedureKind: row.procedure_kind,
        target: JSON.parse(row.target_json) as EngineThievingTarget,
        effect: row.effect,
        transferredItems: JSON.parse(row.transferred_items_json) as EngineThievingItemDelta[],
        thievingXpDelta: row.thieving_xp_delta,
        startedAtEngineTick: row.started_at_engine_tick,
        endedAtEngineTick: row.ended_at_engine_tick,
        occurredAt: row.occurred_at,
        eventDigest: row.event_digest,
        previousHash: row.previous_hash,
        recordHash: row.record_hash
    };
    if (row.property_access_json) record.propertyAccess = JSON.parse(row.property_access_json) as EnginePropertyAccessSnapshot;
    if (row.storage_access_json) record.storageAccess = JSON.parse(row.storage_access_json) as EngineHousingStorageAccessSnapshot;
    if (row.sight_snapshot_json) record.sightSnapshot = JSON.parse(row.sight_snapshot_json) as ThievingSightSnapshot;
    return record;
}

export class ThievingEvidenceStore {
    private readonly database: Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run(`CREATE TABLE IF NOT EXISTS thieving_engine_evidence (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE,
            player_username TEXT NOT NULL,
            procedure_kind TEXT NOT NULL CHECK (procedure_kind IN
                ('pickpocket','lockpick-door','container-theft','property-burglary')),
            target_json TEXT NOT NULL,
            effect TEXT NOT NULL CHECK (effect IN ('item-transfer','lock-opened','entry-completed')),
            transferred_items_json TEXT NOT NULL,
            thieving_xp_delta INTEGER NOT NULL CHECK (thieving_xp_delta >= 0),
            started_at_engine_tick INTEGER NOT NULL CHECK (started_at_engine_tick >= 0),
            ended_at_engine_tick INTEGER NOT NULL CHECK (ended_at_engine_tick >= started_at_engine_tick),
            occurred_at TEXT NOT NULL,
            property_access_json TEXT,
            storage_access_json TEXT,
            sight_snapshot_json TEXT,
            event_digest TEXT NOT NULL,
            previous_hash TEXT NOT NULL,
            record_hash TEXT NOT NULL UNIQUE)`);
        const columns = this.database.query('PRAGMA table_info(thieving_engine_evidence)').all() as Array<{ name: string }>;
        if (!columns.some(column => column.name === 'property_access_json')) {
            this.database.run('ALTER TABLE thieving_engine_evidence ADD COLUMN property_access_json TEXT');
        }
        if (!columns.some(column => column.name === 'sight_snapshot_json')) {
            this.database.run('ALTER TABLE thieving_engine_evidence ADD COLUMN sight_snapshot_json TEXT');
        }
        if (!columns.some(column => column.name === 'storage_access_json')) {
            this.database.run('ALTER TABLE thieving_engine_evidence ADD COLUMN storage_access_json TEXT');
        }
    }

    close(): void {
        this.database.close(true);
    }

    get(eventId: string): EngineThievingEvidenceRecord | null {
        const row = this.database.query('SELECT * FROM thieving_engine_evidence WHERE event_id = ?1')
            .get(eventId) as EvidenceRow | null;
        return row ? evidenceFromRow(row) : null;
    }

    listAfter(sequence: number, limit = 100): Array<EngineThievingEvidenceRecord & { sequence: number }> {
        if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Evidence sequence is invalid');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error('Evidence limit is invalid');
        return (this.database.query(`SELECT * FROM thieving_engine_evidence
            WHERE sequence > ?1 ORDER BY sequence LIMIT ?2`).all(sequence, limit) as EvidenceRow[])
            .map(row => ({ sequence: row.sequence, ...evidenceFromRow(row) }));
    }

    append(input: EngineThievingEvidence): EngineThievingEvidenceRecord {
        const evidence = normalizeEvidence(input);
        const eventDigest = digest(evidence);
        const existing = this.get(evidence.eventId);
        if (existing) {
            if (existing.eventDigest !== eventDigest) throw new Error('Thieving engine event id was reused');
            return existing;
        }
        const previousHash = (this.database.query(`SELECT record_hash FROM thieving_engine_evidence
            ORDER BY sequence DESC LIMIT 1`).get() as { record_hash: string } | null)?.record_hash ?? ZERO_HASH;
        const recordHash = digest({ previousHash, eventDigest });
        this.database.run(`INSERT INTO thieving_engine_evidence
            (event_id,player_username,procedure_kind,target_json,effect,transferred_items_json,
                thieving_xp_delta,started_at_engine_tick,ended_at_engine_tick,occurred_at,property_access_json,
                storage_access_json,sight_snapshot_json,event_digest,previous_hash,record_hash)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)`,
        [evidence.eventId, evidence.playerUsername, evidence.procedureKind, JSON.stringify(evidence.target), evidence.effect,
            JSON.stringify(evidence.transferredItems), evidence.thievingXpDelta, evidence.startedAtEngineTick,
            evidence.endedAtEngineTick, evidence.occurredAt,
            evidence.propertyAccess ? JSON.stringify(evidence.propertyAccess) : null,
            evidence.storageAccess ? JSON.stringify(evidence.storageAccess) : null,
            evidence.sightSnapshot ? JSON.stringify(evidence.sightSnapshot) : null,
            eventDigest, previousHash, recordHash]);
        return this.get(evidence.eventId)!;
    }

    verifyChain(): boolean {
        const rows = this.database.query('SELECT * FROM thieving_engine_evidence ORDER BY sequence')
            .all() as EvidenceRow[];
        let previousHash = ZERO_HASH;
        for (const row of rows) {
            const record = evidenceFromRow(row);
            const { eventDigest, previousHash: storedPrevious, recordHash, ...evidence } = record;
            if (storedPrevious !== previousHash || digest(evidence) !== eventDigest
                || digest({ previousHash, eventDigest }) !== recordHash) return false;
            previousHash = recordHash;
        }
        return true;
    }
}

let defaultStore: ThievingEvidenceStore | null = null;

export function getThievingEvidenceStore(): ThievingEvidenceStore {
    if (!defaultStore) defaultStore = new ThievingEvidenceStore('data/mods/thieving-engine-evidence.sqlite');
    return defaultStore;
}
