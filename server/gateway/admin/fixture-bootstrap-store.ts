import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

export type FixtureApplicationStatus = 'applying' | 'completed' | 'rollback-required' | 'rolled-back';
export interface FixtureApplication {
    fixtureId: string; baselineDigest: string; applyId: string; status: FixtureApplicationStatus;
    rollbackPlan: Record<string, unknown>; error: string | null; startedAt: string; updatedAt: string;
    completedAt: string | null; revision: number;
}
interface ApplicationRow { fixture_id: string; baseline_digest: string; apply_id: string;
    status: FixtureApplicationStatus; rollback_json: string; error: string | null; started_at: string;
    updated_at: string; completed_at: string | null; revision: number }

function application(row: ApplicationRow): FixtureApplication {
    return { fixtureId: row.fixture_id, baselineDigest: row.baseline_digest, applyId: row.apply_id,
        status: row.status, rollbackPlan: JSON.parse(row.rollback_json) as Record<string, unknown>,
        error: row.error, startedAt: row.started_at, updatedAt: row.updated_at,
        completedAt: row.completed_at, revision: row.revision };
}

/** Durable bootstrap journal. A crash leaves an explicit `applying` record for reconciliation. */
export class FixtureBootstrapStore {
    private readonly database: Database;
    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA journal_mode = WAL');
        this.database.run(`CREATE TABLE IF NOT EXISTS fixture_application (
            fixture_id TEXT PRIMARY KEY, baseline_digest TEXT NOT NULL, apply_id TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL CHECK(status IN ('applying','completed','rollback-required','rolled-back')),
            rollback_json TEXT NOT NULL, error TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            completed_at TEXT, revision INTEGER NOT NULL CHECK(revision >= 1))`);
        this.database.run(`CREATE TABLE IF NOT EXISTS fixture_provenance (
            fixture_id TEXT NOT NULL REFERENCES fixture_application(fixture_id), resource_key TEXT NOT NULL,
            baseline_digest TEXT NOT NULL, resource_digest TEXT NOT NULL, created_at TEXT NOT NULL,
            PRIMARY KEY(fixture_id, resource_key))`);
        // v2 migration: preserve completed rollback attempts so the same stable
        // fixture id can be safely applied again after its state was restored.
        this.database.run(`CREATE TABLE IF NOT EXISTS fixture_application_history (
            fixture_id TEXT NOT NULL, apply_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL,
            archived_at TEXT NOT NULL)`);
    }
    close(): void { this.database.close(true); }
    get(fixtureId: string): FixtureApplication | null {
        const row = this.database.query('SELECT * FROM fixture_application WHERE fixture_id=?1')
            .get(fixtureId) as ApplicationRow | null;
        return row ? application(row) : null;
    }
    begin(fixtureId: string, baselineDigest: string, applyId: string, rollbackPlan: Record<string, unknown>,
        now = new Date().toISOString()): FixtureApplication {
        const current = this.get(fixtureId);
        if (current) {
            if (current.baselineDigest !== baselineDigest && current.status !== 'rolled-back') {
                throw new Error('Fixture id is already bound to another baseline digest');
            }
            if (current.status === 'rolled-back') {
                this.database.run('BEGIN IMMEDIATE');
                try {
                    this.database.run(`INSERT INTO fixture_application_history VALUES(?1,?2,?3,?4)`,
                        [fixtureId, current.applyId, JSON.stringify(current), now]);
                    this.database.run('DELETE FROM fixture_provenance WHERE fixture_id=?1', [fixtureId]);
                    const result = this.database.run(`UPDATE fixture_application SET apply_id=?2,baseline_digest=?3,
                        status='applying',rollback_json=?4,error=NULL,started_at=?5,updated_at=?5,
                        completed_at=NULL,revision=revision+1
                        WHERE fixture_id=?1 AND revision=?6 AND status='rolled-back'`,
                    [fixtureId, applyId, baselineDigest, JSON.stringify(rollbackPlan), now, current.revision]);
                    if (result.changes !== 1) throw new Error('Fixture application changed before retry');
                    this.database.run('COMMIT');
                } catch (error) {
                    this.database.run('ROLLBACK');
                    throw error;
                }
                return this.get(fixtureId)!;
            }
            return current;
        }
        this.database.run(`INSERT INTO fixture_application VALUES(?1,?2,?3,'applying',?4,NULL,?5,?5,NULL,1)`,
            [fixtureId, baselineDigest, applyId, JSON.stringify(rollbackPlan), now]);
        return this.get(fixtureId)!;
    }
    updateRollback(fixtureId: string, expectedRevision: number, rollbackPlan: Record<string, unknown>,
        now = new Date().toISOString()): FixtureApplication {
        const result = this.database.run(`UPDATE fixture_application SET rollback_json=?3,updated_at=?4,
            revision=revision+1 WHERE fixture_id=?1 AND revision=?2 AND status IN ('applying','rollback-required')`,
        [fixtureId, expectedRevision, JSON.stringify(rollbackPlan), now]);
        if (result.changes !== 1) throw new Error('Fixture application changed before rollback update');
        return this.get(fixtureId)!;
    }
    requireRollback(fixtureId: string, expectedRevision: number, error: string,
        now = new Date().toISOString()): FixtureApplication {
        const result = this.database.run(`UPDATE fixture_application SET status='rollback-required',error=?3,
            updated_at=?4,completed_at=NULL,revision=revision+1 WHERE fixture_id=?1 AND revision=?2
            AND status IN ('applying','completed','rollback-required')`, [fixtureId, expectedRevision, error, now]);
        if (result.changes !== 1) throw new Error('Fixture application changed before rollback start');
        return this.get(fixtureId)!;
    }
    record(fixtureId: string, baselineDigest: string, resourceKey: string, resourceDigest: string,
        now = new Date().toISOString()): void {
        this.database.run(`INSERT INTO fixture_provenance VALUES(?1,?2,?3,?4,?5)
            ON CONFLICT(fixture_id,resource_key) DO UPDATE SET resource_digest=excluded.resource_digest
            WHERE fixture_provenance.baseline_digest=excluded.baseline_digest
            AND fixture_provenance.resource_digest=excluded.resource_digest`,
        [fixtureId, resourceKey, baselineDigest, resourceDigest, now]);
        const row = this.database.query(`SELECT baseline_digest,resource_digest FROM fixture_provenance
            WHERE fixture_id=?1 AND resource_key=?2`).get(fixtureId, resourceKey) as
            { baseline_digest: string; resource_digest: string } | null;
        if (!row || row.baseline_digest !== baselineDigest || row.resource_digest !== resourceDigest) {
            throw new Error(`Fixture provenance conflicts for ${resourceKey}`);
        }
    }
    finish(fixtureId: string, expectedRevision: number, status: 'completed' | 'rollback-required' | 'rolled-back',
        error: string | null, now = new Date().toISOString()): FixtureApplication {
        const result = this.database.run(`UPDATE fixture_application SET status=?3,error=?4,updated_at=?5,
            completed_at=CASE WHEN ?3 IN ('completed','rolled-back') THEN ?5 ELSE NULL END,revision=revision+1
            WHERE fixture_id=?1 AND revision=?2`, [fixtureId, expectedRevision, status, error, now]);
        if (result.changes !== 1) throw new Error('Fixture application changed before completion');
        return this.get(fixtureId)!;
    }
    listProvenance(fixtureId: string): Array<{ resourceKey: string; baselineDigest: string; resourceDigest: string }> {
        return (this.database.query(`SELECT resource_key,baseline_digest,resource_digest FROM fixture_provenance
            WHERE fixture_id=?1 ORDER BY resource_key`).all(fixtureId) as Array<{
                resource_key: string; baseline_digest: string; resource_digest: string }>).map(row => ({
            resourceKey: row.resource_key, baselineDigest: row.baseline_digest, resourceDigest: row.resource_digest }));
    }
    listHistory(fixtureId: string): FixtureApplication[] {
        return (this.database.query(`SELECT snapshot_json FROM fixture_application_history
            WHERE fixture_id=?1 ORDER BY archived_at,apply_id`).all(fixtureId) as Array<{
                snapshot_json: string }>).map(row => JSON.parse(row.snapshot_json) as FixtureApplication);
    }
}
