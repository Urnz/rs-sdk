import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { WitnessRecognitionPort, WitnessRecognitionSource } from './witness-identification.js';

export type WitnessRecognitionInput = Omit<WitnessRecognitionSource, 'recognitionDigest'>;
/** A server-owned authority must independently verify the complete candidate, not echo its hash. */
export type VerifyWitnessRecognition = (candidate: Readonly<WitnessRecognitionSource>) => string | null;
const ZERO = '0'.repeat(64), ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
const KEYS = ['recognitionId', 'eventId', 'observerUsername', 'recognizedPlayerUsername',
    'recognizedAgentId', 'attentionDecisionDigest', 'sourceEvidenceDigest', 'occurredAt'] as const;
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function identifier(value: unknown): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error('Invalid recognition identifier');
    return value;
}
function canonical(input: WitnessRecognitionInput): WitnessRecognitionInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Reflect.ownKeys(input).length !== KEYS.length || KEYS.some(key => !Object.hasOwn(input, key)))
        throw new Error('Invalid recognition field set');
    const value = Object.fromEntries(KEYS.map(key => [key, input[key]])) as WitnessRecognitionInput;
    identifier(value.recognitionId); identifier(value.eventId); identifier(value.recognizedAgentId);
    if (typeof value.observerUsername !== 'string' || typeof value.recognizedPlayerUsername !== 'string'
        || !/^[a-z0-9]{1,12}$/.test(value.observerUsername) || !/^[a-z0-9]{1,12}$/.test(value.recognizedPlayerUsername)
        || value.observerUsername === value.recognizedPlayerUsername)
        throw new Error('Invalid normalized recognition usernames');
    if (typeof value.attentionDecisionDigest !== 'string' || typeof value.sourceEvidenceDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(value.attentionDecisionDigest) || !/^[a-f0-9]{64}$/.test(value.sourceEvidenceDigest))
        throw new Error('Invalid recognition source digest');
    if (typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt))
        || new Date(value.occurredAt).toISOString() !== value.occurredAt)
        throw new Error('Invalid recognition timestamp');
    return value;
}
export function witnessRecognitionDigest(input: WitnessRecognitionInput): string { return hash(canonical(input)); }

/** Independent durable source boundary. This does not itself perform or authorize live recognition. */
export class WitnessRecognitionStore implements WitnessRecognitionPort {
    private readonly database: Database;
    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        try {
            const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
            if (version > 1) throw new Error(`Witness recognition schema ${version} is newer than supported version 1`);
            if (version === 0) this.database.transaction(() => {
                this.database.run(`CREATE TABLE witness_recognition (recognition_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,recognition_digest TEXT NOT NULL UNIQUE)`);
                this.database.run(`CREATE TABLE witness_recognition_audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    recognition_id TEXT NOT NULL UNIQUE REFERENCES witness_recognition(recognition_id),
                    previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
                this.database.run('PRAGMA user_version = 1');
            }).immediate();
        } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    list(): WitnessRecognitionSource[] {
        if (!this.verifyAuditChain()) throw new Error('Witness recognition audit is invalid');
        const rows = this.database.query('SELECT recognition_id FROM witness_recognition ORDER BY rowid').all() as { recognition_id: string }[];
        return rows.map(row => this.get(row.recognition_id)!);
    }
    getByDigest(digest: string): WitnessRecognitionSource | null {
        if (!this.verifyAuditChain()) throw new Error('Witness recognition audit is invalid');
        const row = this.database.query('SELECT recognition_id FROM witness_recognition WHERE recognition_digest=?1')
            .get(digest) as { recognition_id: string } | null;
        return row ? this.get(row.recognition_id) : null;
    }
    get(recognitionId: string): WitnessRecognitionSource | null {
        if (!this.verifyAuditChain()) throw new Error('Witness recognition audit is invalid');
        const row = this.database.query('SELECT payload,recognition_digest FROM witness_recognition WHERE recognition_id=?1')
            .get(identifier(recognitionId)) as { payload: string; recognition_digest: string } | null;
        return row ? { ...JSON.parse(row.payload), recognitionDigest: row.recognition_digest } : null;
    }
    record(input: WitnessRecognitionInput, verify: VerifyWitnessRecognition): WitnessRecognitionSource {
        const facts = canonical(input), value = Object.freeze({ ...facts, recognitionDigest: hash(facts) });
        if (typeof verify !== 'function') throw new Error('Trusted recognition verifier required');
        let result: WitnessRecognitionSource | null = null;
        this.database.transaction(() => {
            if (!this.verifyAuditChain()) throw new Error('Witness recognition audit is invalid');
            if (verify(value) !== value.recognitionDigest) throw new Error('Independent server recognition verification failed');
            if (!this.verifyAuditChain()) throw new Error('Witness recognition audit is invalid');
            const existing = this.get(value.recognitionId);
            if (existing) {
                if (JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('Recognition already exists with different source');
                result = existing; return;
            }
            this.database.run('INSERT INTO witness_recognition VALUES(?1,?2,?3)',
                [value.recognitionId, JSON.stringify(facts), value.recognitionDigest]);
            const previous = this.database.query('SELECT entry_hash FROM witness_recognition_audit ORDER BY sequence DESC LIMIT 1')
                .get() as { entry_hash: string } | null;
            const previousHash = previous?.entry_hash ?? ZERO;
            this.database.run('INSERT INTO witness_recognition_audit(recognition_id,previous_hash,entry_hash) VALUES(?1,?2,?3)',
                [value.recognitionId, previousHash, hash({ previousHash, recognition: value })]);
            result = { ...value };
        }).immediate();
        return result!;
    }
    verifyAuditChain(): boolean {
        try {
            const rows = this.database.query('SELECT * FROM witness_recognition ORDER BY rowid').all() as
                { recognition_id: string; payload: string; recognition_digest: string }[];
            const audits = this.database.query('SELECT * FROM witness_recognition_audit ORDER BY sequence').all() as
                { sequence: number; recognition_id: string; previous_hash: string; entry_hash: string }[];
            if (rows.length !== audits.length) return false;
            let head = ZERO;
            for (let index = 0; index < rows.length; index++) {
                const row = rows[index]!, audit = audits[index]!;
                const facts = canonical(JSON.parse(row.payload));
                const value = { ...facts, recognitionDigest: row.recognition_digest };
                if (JSON.stringify(facts) !== row.payload || facts.recognitionId !== row.recognition_id
                    || hash(facts) !== row.recognition_digest || audit.sequence !== index + 1
                    || audit.recognition_id !== row.recognition_id || audit.previous_hash !== head
                    || hash({ previousHash: head, recognition: value }) !== audit.entry_hash) return false;
                head = audit.entry_hash;
            }
            return true;
        } catch { return false; }
    }
}
