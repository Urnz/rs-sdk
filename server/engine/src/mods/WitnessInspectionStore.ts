import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

export interface EngineWitnessInspectionReceipt {
    recognitionId: string; eventId: string; observerUsername: string; recognizedPlayerUsername: string;
    sourceEvidenceDigest: string; occurredAt: string; engineTick: number;
    actorSessionToken: string; visualDigest: string; policyDigest: string; targetPlayerSlot: number; receiptDigest: string;
}
type Input = Omit<EngineWitnessInspectionReceipt, 'receiptDigest'>;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function canonical(value: Input): Input {
    if (!value || Object.keys(value).sort().join(',') !== ['recognitionId','eventId','observerUsername',
        'recognizedPlayerUsername','sourceEvidenceDigest','occurredAt','engineTick','actorSessionToken',
        'visualDigest','policyDigest','targetPlayerSlot'].sort().join(',')) throw new Error('Invalid inspection field set');
    if (![value.recognitionId,value.eventId,value.actorSessionToken].every(item => typeof item === 'string'
        && /^[a-z0-9][a-z0-9._:-]{1,127}$/i.test(item))
        || ![value.observerUsername,value.recognizedPlayerUsername].every(item => typeof item === 'string' && /^[a-z0-9]{1,12}$/.test(item))
        || value.observerUsername === value.recognizedPlayerUsername
        || ![value.sourceEvidenceDigest,value.visualDigest,value.policyDigest].every(item => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item))
        || !Number.isSafeInteger(value.engineTick) || value.engineTick < 0
        || !Number.isSafeInteger(value.targetPlayerSlot) || value.targetPlayerSlot < 0 || value.targetPlayerSlot > 2047
        || typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt)) || new Date(value.occurredAt).toISOString() !== value.occurredAt)
        throw new Error('Invalid inspection facts');
    return { recognitionId:value.recognitionId,eventId:value.eventId,observerUsername:value.observerUsername,
        recognizedPlayerUsername:value.recognizedPlayerUsername,sourceEvidenceDigest:value.sourceEvidenceDigest,
        occurredAt:value.occurredAt,engineTick:value.engineTick,actorSessionToken:value.actorSessionToken,
        visualDigest:value.visualDigest,policyDigest:value.policyDigest,targetPlayerSlot:value.targetPlayerSlot };
}
export class EngineWitnessInspectionStore {
    private readonly db: Database;
    constructor(path: string) {
        mkdirSync(dirname(path), { recursive:true }); this.db = new Database(path, {create:true,strict:true});
        try {
            const version = (this.db.query('PRAGMA user_version').get() as {user_version:number}).user_version;
            if (version > 1) throw new Error('Unsupported witness inspection schema');
            if (version === 0) this.db.transaction(() => {
                this.db.run('CREATE TABLE witness_inspection(sequence INTEGER PRIMARY KEY AUTOINCREMENT,recognition_id TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,receipt_digest TEXT UNIQUE NOT NULL,previous_hash TEXT NOT NULL,record_hash TEXT UNIQUE NOT NULL)');
                this.db.run('PRAGMA user_version=1');
            }).immediate();
        } catch (error) { this.db.close(true); throw error; }
    }
    close(): void { this.db.close(true); }
    get(id: string): EngineWitnessInspectionReceipt | null {
        if (!this.verifyChain()) throw new Error('Inspection source audit invalid');
        const row = this.db.query('SELECT payload,receipt_digest FROM witness_inspection WHERE recognition_id=?1').get(id) as {payload:string;receipt_digest:string}|null;
        return row ? {...JSON.parse(row.payload),receiptDigest:row.receipt_digest} : null;
    }
    append(input: Input): EngineWitnessInspectionReceipt {
        const facts = canonical(input), receiptDigest = hash(facts);
        let result: EngineWitnessInspectionReceipt | null = null;
        this.db.transaction(() => {
            const existing = this.get(facts.recognitionId);
            if (existing) {
                if (existing.receiptDigest !== receiptDigest) throw new Error('Inspection identity reused');
                result = existing; return;
            }
            const previousHash = (this.db.query('SELECT record_hash FROM witness_inspection ORDER BY sequence DESC LIMIT 1').get() as {record_hash:string}|null)?.record_hash ?? '0'.repeat(64);
            this.db.run('INSERT INTO witness_inspection(recognition_id,payload,receipt_digest,previous_hash,record_hash) VALUES(?1,?2,?3,?4,?5)',
                [facts.recognitionId,JSON.stringify(facts),receiptDigest,previousHash,hash({previousHash,receiptDigest})]);
            result = {...facts,receiptDigest};
        }).immediate();
        return result!;
    }
    verifyChain(): boolean {
        try {
            const rows = this.db.query('SELECT * FROM witness_inspection ORDER BY sequence').all() as Array<{sequence:number;recognition_id:string;payload:string;receipt_digest:string;previous_hash:string;record_hash:string}>;
            let head = '0'.repeat(64);
            return rows.every((row,index) => {
                const facts = canonical(JSON.parse(row.payload));
                const valid = row.sequence === index + 1 && facts.recognitionId === row.recognition_id
                    && JSON.stringify(facts) === row.payload && hash(facts) === row.receipt_digest
                    && row.previous_hash === head && hash({previousHash:head,receiptDigest:row.receipt_digest}) === row.record_hash;
                head = row.record_hash; return valid;
            });
        } catch { return false; }
    }
}
let store: EngineWitnessInspectionStore | null = null;
export function getWitnessInspectionStore(): EngineWitnessInspectionStore {
    return store ??= new EngineWitnessInspectionStore(process.env.THIEVING_WITNESS_INSPECTION_DB || 'data/mods/witness-inspections.sqlite');
}
