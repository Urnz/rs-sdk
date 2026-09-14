import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { validateWorldGenesisResult } from './result.js';
import { WORLD_GENESIS_PROFILE_SCHEMA_VERSION, type WorldGenesisApplication,
    type WorldGenesisApplicationStatus, type WorldGenesisJsonValue, type WorldGenesisResult } from './types.js';

export const WORLD_GENESIS_RUN_STORE_SCHEMA_VERSION = 1 as const;

interface ApplicationRow {
    result_id: string; result_digest: string; status: WorldGenesisApplicationStatus; result_json: string;
    rollback_json: string; receipt_json: string | null; error: string | null; started_at_audit: string;
    updated_at_audit: string; completed_at_audit: string | null; revision: number;
}

function application(row: ApplicationRow): WorldGenesisApplication {
    return { schemaVersion: WORLD_GENESIS_PROFILE_SCHEMA_VERSION, resultId: row.result_id,
        resultDigest: row.result_digest, status: row.status,
        result: JSON.parse(row.result_json) as WorldGenesisResult,
        rollbackToken: JSON.parse(row.rollback_json) as WorldGenesisJsonValue,
        applyReceipt: row.receipt_json ? JSON.parse(row.receipt_json) as WorldGenesisJsonValue : null,
        error: row.error, startedAtAudit: row.started_at_audit, updatedAtAudit: row.updated_at_audit,
        completedAtAudit: row.completed_at_audit, revision: row.revision };
}

export class WorldGenesisRunStore {
    private readonly database: Database;
    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        try {
            this.database.run('PRAGMA journal_mode = WAL');
            const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
            if (version > WORLD_GENESIS_RUN_STORE_SCHEMA_VERSION) {
                throw new Error(`World genesis run schema ${version} is newer than supported`);
            }
            if (version < 1) {
                const migration = this.database.transaction(() => {
                    this.database.run(`CREATE TABLE world_genesis_application (
                        result_id TEXT PRIMARY KEY,result_digest TEXT NOT NULL UNIQUE,
                        status TEXT NOT NULL CHECK(status IN ('applying','applied','resetting','reset','rollback-required')),
                        result_json TEXT NOT NULL,rollback_json TEXT NOT NULL,receipt_json TEXT,error TEXT,
                        started_at_audit TEXT NOT NULL,updated_at_audit TEXT NOT NULL,completed_at_audit TEXT,
                        revision INTEGER NOT NULL CHECK(revision>=1))`);
                    this.database.run('PRAGMA user_version = 1');
                });
                migration.immediate();
            }
        } catch (error) { this.database.close(false); throw error; }
    }
    close(): void { this.database.close(false); }

    get(resultId: string): WorldGenesisApplication | null {
        const row = this.database.query('SELECT * FROM world_genesis_application WHERE result_id=?1')
            .get(resultId) as ApplicationRow | null;
        return row ? application(row) : null;
    }
    list(limit = 50): WorldGenesisApplication[] {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Genesis run list limit is invalid');
        return (this.database.query(`SELECT * FROM world_genesis_application
            ORDER BY started_at_audit DESC,result_id LIMIT ?1`).all(limit) as ApplicationRow[]).map(application);
    }
    begin(resultInput: WorldGenesisResult, rollbackToken: WorldGenesisJsonValue,
        now: string): WorldGenesisApplication {
        const result = validateWorldGenesisResult(resultInput), current = this.get(result.resultId);
        if (current) {
            if (current.resultDigest !== result.resultDigest) throw new Error('Genesis result id is bound to another digest');
            if (current.status === 'applied') return current;
            throw new Error(`Genesis result cannot start from ${current.status}`);
        }
        this.database.run(`INSERT INTO world_genesis_application
            VALUES(?1,?2,'applying',?3,?4,NULL,NULL,?5,?5,NULL,1)`,
        [result.resultId, result.resultDigest, JSON.stringify(result), JSON.stringify(rollbackToken), now]);
        return this.get(result.resultId)!;
    }
    finishApply(resultId: string, expectedRevision: number, receipt: WorldGenesisJsonValue,
        now: string): WorldGenesisApplication {
        const changed = this.database.run(`UPDATE world_genesis_application SET status='applied',receipt_json=?3,
            error=NULL,updated_at_audit=?4,completed_at_audit=?4,revision=revision+1
            WHERE result_id=?1 AND revision=?2 AND status='applying'`,
        [resultId, expectedRevision, JSON.stringify(receipt), now]);
        if (changed.changes !== 1) throw new Error('Genesis application changed before apply completion');
        return this.get(resultId)!;
    }
    requireRollback(resultId: string, expectedRevision: number, error: string,
        now: string): WorldGenesisApplication {
        const changed = this.database.run(`UPDATE world_genesis_application SET status='rollback-required',
            error=?3,updated_at_audit=?4,completed_at_audit=NULL,revision=revision+1
            WHERE result_id=?1 AND revision=?2 AND status IN ('applying','applied','resetting','rollback-required')`,
        [resultId, expectedRevision, error.slice(0, 2000), now]);
        if (changed.changes !== 1) throw new Error('Genesis application changed before rollback requirement');
        return this.get(resultId)!;
    }
    beginReset(resultId: string, expectedRevision: number, now: string): WorldGenesisApplication {
        const changed = this.database.run(`UPDATE world_genesis_application SET status='resetting',error=NULL,
            updated_at_audit=?3,completed_at_audit=NULL,revision=revision+1
            WHERE result_id=?1 AND revision=?2 AND status IN ('applied','applying','rollback-required')`,
        [resultId, expectedRevision, now]);
        if (changed.changes !== 1) throw new Error('Genesis application cannot enter reset');
        return this.get(resultId)!;
    }
    finishReset(resultId: string, expectedRevision: number, now: string): WorldGenesisApplication {
        const changed = this.database.run(`UPDATE world_genesis_application SET status='reset',error=NULL,
            updated_at_audit=?3,completed_at_audit=?3,revision=revision+1
            WHERE result_id=?1 AND revision=?2 AND status='resetting'`, [resultId, expectedRevision, now]);
        if (changed.changes !== 1) throw new Error('Genesis application changed before reset completion');
        return this.get(resultId)!;
    }
}
