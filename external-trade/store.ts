import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { digest, hash, key, username, time, integer, object, validateExternalTradePolicy } from './policy.js';
import { check, ZERO, verifyNativeTrade, type NativeTrade } from './source.js';
import { summarizeTradeWindow, type TradeRun } from './measurement.js';

function validateRun(run: TradeRun): void {
    object(run, ['runId', 'resultDigest', 'profile', 'clockId', 'clockProfileDigest', 'startedAtSimulationTime', 'startedAtWallTime', 'sourceBindingDigest', 'participants', 'policy', 'sourceStart']);
    hash(run.sourceBindingDigest);
    key(run.runId); hash(run.resultDigest); key(run.clockId); hash(run.clockProfileDigest); time(run.startedAtSimulationTime); time(run.startedAtWallTime);
    object(run.profile, ['profileId', 'version', 'digest']); key(run.profile.profileId); hash(run.profile.digest);
    object(run.sourceStart, ['sequence', 'headHash']); integer(run.sourceStart.sequence); hash(run.sourceStart.headHash);
    check(run.sourceStart.sequence !== 0 || run.sourceStart.headHash === ZERO, 'External source start differs');
    const { digest: policyDigest, ...definition } = run.policy;
    check(validateExternalTradePolicy(definition).digest === policyDigest, 'External run policy digest differs');
    check(Array.isArray(run.participants) && run.participants.length > 0 && run.participants.length <= 10000, 'External participant registry is invalid');
    for (const actor of run.participants) { object(actor, ['agentId', 'username']); key(actor.agentId); username(actor.username);
        check(!run.policy.counterparties.some(partner => partner.username === actor.username), 'Internal actor cannot be an external partner'); }
    check(new Set(run.participants.map(actor => actor.agentId)).size === run.participants.length
        && new Set(run.participants.map(actor => actor.username)).size === run.participants.length, 'Duplicate external participant binding');
}
export class ExternalTradeStore {
    private readonly db: Database;
    constructor(path: string, readonly readOnly = false) {
        if (!readOnly) mkdirSync(dirname(path), { recursive: true });
        this.db = new Database(path, readOnly ? { readonly: true, strict: true } : { create: true, strict: true });
        try {
            const version = (this.db.query('PRAGMA user_version').get() as any).user_version;
            check(version <= 1 && (!readOnly || version === 1), 'Unsupported external trade schema');
            if (!readOnly && version === 0) this.db.transaction(() => {
                this.db.run('CREATE TABLE external_trade_run(run_id TEXT PRIMARY KEY,definition_json TEXT NOT NULL,definition_digest TEXT NOT NULL)');
                this.db.run(`CREATE TABLE external_trade_event(run_id TEXT NOT NULL,sequence INTEGER NOT NULL,event_id TEXT NOT NULL,
                    native_json TEXT NOT NULL,native_digest TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL,
                    PRIMARY KEY(run_id,sequence),UNIQUE(run_id,event_id))`);
                this.db.run(`CREATE TABLE external_trade_head(run_id TEXT PRIMARY KEY,sequence INTEGER NOT NULL,entry_hash TEXT NOT NULL)`);
                this.db.run('PRAGMA user_version=1');
            }).immediate();
        } catch (error) { this.close(); throw error; }
    }
    close(): void { (this.db as Database & { clearQueryCache(): void }).clearQueryCache(); this.db.close(true); }
    begin(run: TradeRun): void {
        if (this.readOnly) throw new Error('External trade source is read-only'); validateRun(run);
        this.db.transaction(() => {
            const prior = this.get(run.runId);
            if (prior) { check(digest(prior) === digest(run), 'External run binding conflict'); this.verify(run.runId); return; }
            this.db.run('INSERT INTO external_trade_run VALUES(?1,?2,?3)', [run.runId, JSON.stringify(run), digest(run)]);
            this.db.run('INSERT INTO external_trade_head VALUES(?1,0,?2)', [run.runId, digest(run)]);
        }).immediate();
    }
    get(runId: string): TradeRun | null {
        const row = this.db.query('SELECT * FROM external_trade_run WHERE run_id=?1').get(key(runId)) as any;
        if (!row) return null;
        const run = JSON.parse(row.definition_json) as TradeRun; validateRun(run);
        check(run.runId === row.run_id && digest(run) === row.definition_digest, 'External run definition is corrupt'); return run;
    }
    verify(runId: string): { run: TradeRun; trades: NativeTrade[]; headHash: string } {
        const run = this.get(runId); check(run, 'External trade run is unavailable');
        const rows = this.db.query('SELECT * FROM external_trade_event WHERE run_id=?1 ORDER BY sequence').all(runId) as any[],
            tail = this.db.query('SELECT * FROM external_trade_head WHERE run_id=?1').get(runId) as any;
        check(rows.length <= 100000, 'External ledger exceeds limit');
        let previous = digest(run), sourcePrevious = run.sourceStart.headHash;
        const trades = rows.map((row, index) => {
            const native = JSON.parse(row.native_json) as NativeTrade;
            check(row.sequence === index + 1 && native.sequence === run.sourceStart.sequence + row.sequence && row.event_id === native.event.eventId,
                'External ledger sequence differs');
            verifyNativeTrade(native, sourcePrevious); sourcePrevious = native.headHash;
            const entryHash = digest({ runId, sequence: row.sequence, nativeDigest: digest(native), previousHash: previous });
            check(row.native_digest === digest(native) && row.previous_hash === previous && row.entry_hash === entryHash, 'External ledger audit is corrupt');
            previous = entryHash; return native;
        });
        check(tail && tail.sequence === trades.length && tail.entry_hash === previous, 'External ledger tail differs');
        return { run, trades, headHash: previous };
    }
    assertBacking(runId: string, source: NativeTrade[]): void {
        const { run, trades } = this.verify(runId);
        check(run.sourceStart.sequence === 0 || source[run.sourceStart.sequence - 1]?.headHash === run.sourceStart.headHash, 'Native source baseline was removed or changed');
        for (const trade of trades) check(digest(source[trade.sequence - 1] ?? null) === digest(trade), 'Recorded native trade/clock backing was removed or changed');
    }
    observe(runId: string, source: NativeTrade[]): number {
        if (this.readOnly) throw new Error('External trade source is read-only');
        let added = 0;
        this.db.transaction(() => {
            this.assertBacking(runId, source);
            const { run, trades, headHash } = this.verify(runId);
            let previous = headHash, sourcePrevious = trades.at(-1)?.headHash ?? run.sourceStart.headHash;
            for (const native of source.slice(run.sourceStart.sequence + trades.length)) {
                const sequence = trades.length + added + 1;
                check(native.sequence === run.sourceStart.sequence + sequence, 'External source is not contiguous');
                verifyNativeTrade(native, sourcePrevious); sourcePrevious = native.headHash;
                const nativeDigest = digest(native), entryHash = digest({ runId, sequence, nativeDigest, previousHash: previous });
                this.db.run('INSERT INTO external_trade_event VALUES(?1,?2,?3,?4,?5,?6,?7)',
                    [runId, sequence, native.event.eventId, JSON.stringify(native), nativeDigest, previous, entryHash]);
                previous = entryHash; added++;
            }
            this.db.run('UPDATE external_trade_head SET sequence=?2,entry_hash=?3 WHERE run_id=?1', [runId, trades.length + added, previous]);
            // Derivation is part of this transaction: overflow or invalid facts roll back the entire observation batch.
            const verified = this.verify(runId);
            summarizeTradeWindow(run, verified.trades, run.startedAtSimulationTime, '+275760-09-13T00:00:00.000Z');
        }).immediate(); return added;
    }
    report(runId: string, from: string, to: string) {
        time(from); time(to); check(Date.parse(from) < Date.parse(to) && Number.isSafeInteger(Date.parse(to) - Date.parse(from)), 'External metric window is invalid');
        return this.db.transaction(() => this.buildReport(runId, from, to))();
    }
    reportBacked(runId: string, source: NativeTrade[], from: string, to: string) {
        time(from); time(to); check(Date.parse(from) < Date.parse(to) && Number.isSafeInteger(Date.parse(to) - Date.parse(from)), 'External metric window is invalid');
        return this.db.transaction(() => { this.assertBacking(runId, source); return this.buildReport(runId, from, to); })();
    }
    private buildReport(runId: string, from: string, to: string) {
        const { run, trades, headHash } = this.verify(runId);
        const { digest: metricDigest, ...measurement } = summarizeTradeWindow(run, trades, from, to);
        const definition = { ...measurement, journalHeadHash: headHash,
            observedThroughSourceSequence: trades.at(-1)?.sequence ?? run.sourceStart.sequence, registration: run };
        return { ...definition, digest: digest(definition) };
    }
}
