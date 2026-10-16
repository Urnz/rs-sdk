import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

export interface CheckpointSearchedItem { itemId: number; quantity: number }
export interface EngineCheckpointInspectionRecord {
    sourceKind: 'completed-server-search';
    inspectionId: string; jurisdictionId: string; locationId: string; checkpointId: string;
    authorityId: string; inspectorAgentId: string; subjectAgentId: string; occurredAt: string;
    engineTick: number; searchedItems: CheckpointSearchedItem[];
    sourceEvidenceDigest: string; eventDigest: string;
}
export interface EngineCheckpointDetectionRecord {
    sourceKind: 'explicit-server-recognition';
    detectionId: string; inspectionId: string; subjectAgentId: string; assetId: string; itemId: number;
    result: 'recognized-stolen' | 'not-recognized'; occurredAt: string; engineTick: number;
    sourceEvidenceDigest: string; eventDigest: string;
}
export type CheckpointInspectionInput = Omit<EngineCheckpointInspectionRecord,
    'sourceKind' | 'sourceEvidenceDigest' | 'eventDigest'>;
export type CheckpointDetectionInput = Omit<EngineCheckpointDetectionRecord,
    'sourceKind' | 'sourceEvidenceDigest' | 'eventDigest'>;

type Kind = 'inspection' | 'detection';
type Row = { sequence: number; kind: Kind; event_id: string; inspection_id: string;
    subject_agent_id: string; asset_id: string | null; payload_json: string; event_digest: string;
    previous_hash: string; record_hash: string };
const ZERO = '0'.repeat(64), ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function id(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function time(value: unknown, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value)
        throw new Error(`${field} is invalid`);
    return value;
}
function uint(value: unknown, field: string, max = 2_147_483_647): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max)
        throw new Error(`${field} is invalid`);
    return Number(value);
}
function exact(value: object, keys: string[], field: string): void {
    if (Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
        throw new Error(`${field} fields are invalid`);
}
function inspection(input: CheckpointInspectionInput): CheckpointInspectionInput {
    exact(input, ['inspectionId','jurisdictionId','locationId','checkpointId','authorityId','inspectorAgentId',
        'subjectAgentId','occurredAt','engineTick','searchedItems'], 'Checkpoint inspection');
    for (const key of ['inspectionId','jurisdictionId','locationId','checkpointId','authorityId',
        'inspectorAgentId','subjectAgentId'] as const) id(input[key], key);
    time(input.occurredAt, 'occurredAt'); uint(input.engineTick, 'engineTick');
    if (!Array.isArray(input.searchedItems) || input.searchedItems.length > 28)
        throw new Error('searchedItems is invalid');
    const searchedItems = input.searchedItems.map((item, index) => {
        exact(item, ['itemId','quantity'], `searchedItems[${index}]`);
        return { itemId: uint(item.itemId, 'itemId', 65_535), quantity: uint(item.quantity, 'quantity') };
    }).filter(item => item.quantity > 0).sort((left, right) => left.itemId - right.itemId);
    if (new Set(searchedItems.map(item => item.itemId)).size !== searchedItems.length)
        throw new Error('searchedItems contains duplicate item ids');
    return { inspectionId: input.inspectionId, jurisdictionId: input.jurisdictionId,
        locationId: input.locationId, checkpointId: input.checkpointId, authorityId: input.authorityId,
        inspectorAgentId: input.inspectorAgentId, subjectAgentId: input.subjectAgentId,
        occurredAt: input.occurredAt, engineTick: input.engineTick, searchedItems };
}
function detection(input: CheckpointDetectionInput): CheckpointDetectionInput {
    exact(input, ['detectionId','inspectionId','subjectAgentId','assetId','itemId','result','occurredAt','engineTick'],
        'Checkpoint detection');
    for (const key of ['detectionId','inspectionId','subjectAgentId','assetId'] as const) id(input[key], key);
    if (input.result !== 'recognized-stolen' && input.result !== 'not-recognized')
        throw new Error('Checkpoint detection result is invalid');
    return { detectionId: input.detectionId, inspectionId: input.inspectionId,
        subjectAgentId: input.subjectAgentId, assetId: input.assetId,
        itemId: uint(input.itemId, 'itemId', 65_535), result: input.result,
        occurredAt: time(input.occurredAt, 'occurredAt'), engineTick: uint(input.engineTick, 'engineTick') };
}
function inspectionRecord(input: CheckpointInspectionInput, eventDigest = hash(input)):
    EngineCheckpointInspectionRecord {
    return { sourceKind: 'completed-server-search', ...input,
        sourceEvidenceDigest: eventDigest, eventDigest };
}
function detectionRecord(input: CheckpointDetectionInput, eventDigest = hash(input)):
    EngineCheckpointDetectionRecord {
    return { sourceKind: 'explicit-server-recognition', ...input,
        sourceEvidenceDigest: eventDigest, eventDigest };
}

/** Engine-owned append-only journal. A negative recognition occupies the same one-shot asset key as a success. */
export class CheckpointEvidenceStore {
    private readonly database: Database;
    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    getInspection(inspectionId: string): EngineCheckpointInspectionRecord | null {
        this.assertChain();
        const row = this.database.query("SELECT * FROM checkpoint_engine_evidence WHERE kind='inspection' AND event_id=?1")
            .get(id(inspectionId, 'inspectionId')) as Row | null;
        return row ? inspectionRecord(inspection(JSON.parse(row.payload_json)), row.event_digest) : null;
    }
    getDetection(detectionId: string): EngineCheckpointDetectionRecord | null {
        this.assertChain();
        const row = this.database.query("SELECT * FROM checkpoint_engine_evidence WHERE kind='detection' AND event_id=?1")
            .get(id(detectionId, 'detectionId')) as Row | null;
        return row ? detectionRecord(detection(JSON.parse(row.payload_json)), row.event_digest) : null;
    }
    appendInspection(value: CheckpointInspectionInput): EngineCheckpointInspectionRecord {
        const input = inspection(value), eventDigest = hash(input);
        const existing = this.getInspection(input.inspectionId);
        if (existing) {
            if (existing.eventDigest !== eventDigest) throw new Error('Checkpoint inspection identity was reused');
            return existing;
        }
        this.insert('inspection', input.inspectionId, input.inspectionId, input.subjectAgentId, null, input, eventDigest);
        return this.getInspection(input.inspectionId)!;
    }
    appendDetection(value: CheckpointDetectionInput): EngineCheckpointDetectionRecord {
        const input = detection(value), eventDigest = hash(input);
        const byId = this.getDetection(input.detectionId);
        if (byId) {
            if (byId.eventDigest !== eventDigest) throw new Error('Checkpoint detection identity was reused');
            return byId;
        }
        const inspected = this.getInspection(input.inspectionId);
        if (!inspected || inspected.subjectAgentId !== input.subjectAgentId
            || input.engineTick < inspected.engineTick || Date.parse(input.occurredAt) < Date.parse(inspected.occurredAt)
            || !inspected.searchedItems.some(item => item.itemId === input.itemId && item.quantity > 0))
            throw new Error('Checkpoint detection does not match the completed search');
        const previous = this.database.query("SELECT payload_json FROM checkpoint_engine_evidence WHERE kind='detection' AND inspection_id=?1 AND asset_id=?2")
            .get(input.inspectionId, input.assetId) as { payload_json: string } | null;
        if (previous) throw new Error('Checkpoint asset detection was already decided and cannot be rerolled');
        this.insert('detection', input.detectionId, input.inspectionId, input.subjectAgentId,
            input.assetId, input, eventDigest);
        return this.getDetection(input.detectionId)!;
    }
    verifyChain(): boolean {
        try {
            const rows = this.database.query('SELECT * FROM checkpoint_engine_evidence ORDER BY sequence').all() as Row[];
            let head = ZERO;
            const inspections = new Map<string, CheckpointInspectionInput>(), decisions = new Set<string>();
            for (let index = 0; index < rows.length; index++) {
                const row = rows[index]!, input = row.kind === 'inspection'
                    ? inspection(JSON.parse(row.payload_json)) : detection(JSON.parse(row.payload_json));
                const eventId = row.kind === 'inspection'
                    ? (input as CheckpointInspectionInput).inspectionId : (input as CheckpointDetectionInput).detectionId;
                if (row.sequence !== index + 1 || row.event_id !== eventId || row.event_digest !== hash(input)
                    || row.previous_hash !== head || row.record_hash !== hash({ previousHash: head,
                        kind: row.kind, eventDigest: row.event_digest })) return false;
                if (row.kind === 'inspection') {
                    const value = input as CheckpointInspectionInput;
                    if (row.inspection_id !== value.inspectionId || row.subject_agent_id !== value.subjectAgentId
                        || row.asset_id !== null || inspections.has(value.inspectionId)) return false;
                    inspections.set(value.inspectionId, value);
                } else {
                    const value = input as CheckpointDetectionInput, source = inspections.get(value.inspectionId);
                    const decisionKey = `${value.inspectionId}\0${value.assetId}`;
                    if (!source || row.inspection_id !== value.inspectionId || row.subject_agent_id !== value.subjectAgentId
                        || row.asset_id !== value.assetId || source.subjectAgentId !== value.subjectAgentId
                        || value.engineTick < source.engineTick || Date.parse(value.occurredAt) < Date.parse(source.occurredAt)
                        || !source.searchedItems.some(item => item.itemId === value.itemId && item.quantity > 0)
                        || decisions.has(decisionKey)) return false;
                    decisions.add(decisionKey);
                }
                head = row.record_hash;
            }
            return true;
        } catch { return false; }
    }
    private assertChain(): void { if (!this.verifyChain()) throw new Error('Checkpoint engine evidence audit is invalid'); }
    private insert(kind: Kind, eventId: string, inspectionId: string, subjectAgentId: string,
        assetId: string | null, input: CheckpointInspectionInput | CheckpointDetectionInput,
        eventDigest: string): void {
        this.database.transaction(() => {
            this.assertChain();
            const previousHash = (this.database.query('SELECT record_hash FROM checkpoint_engine_evidence ORDER BY sequence DESC LIMIT 1')
                .get() as { record_hash: string } | null)?.record_hash ?? ZERO;
            this.database.run(`INSERT INTO checkpoint_engine_evidence(kind,event_id,inspection_id,subject_agent_id,
                asset_id,payload_json,event_digest,previous_hash,record_hash) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
            [kind,eventId,inspectionId,subjectAgentId,assetId,JSON.stringify(input),eventDigest,previousHash,
                hash({ previousHash, kind, eventDigest })]);
        }).immediate();
    }
    private migrate(): void {
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > 1) throw new Error(`Checkpoint engine evidence schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        this.database.transaction(() => {
            this.database.run(`CREATE TABLE checkpoint_engine_evidence(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL CHECK(kind IN ('inspection','detection')),event_id TEXT NOT NULL,
                inspection_id TEXT NOT NULL,subject_agent_id TEXT NOT NULL,asset_id TEXT,payload_json TEXT NOT NULL,
                event_digest TEXT NOT NULL,previous_hash TEXT NOT NULL,record_hash TEXT NOT NULL UNIQUE,
                UNIQUE(kind,event_id))`);
            this.database.run(`CREATE UNIQUE INDEX checkpoint_engine_asset_decision
                ON checkpoint_engine_evidence(inspection_id,asset_id) WHERE kind='detection'`);
            this.database.run('PRAGMA user_version=1');
        }).immediate();
    }
}

let defaultStore: CheckpointEvidenceStore | null = null;
export function getCheckpointEvidenceStore(): CheckpointEvidenceStore {
    return defaultStore ??= new CheckpointEvidenceStore(process.env.CHECKPOINT_ENGINE_EVIDENCE_DB
        || 'data/mods/checkpoint-engine-evidence.sqlite');
}
