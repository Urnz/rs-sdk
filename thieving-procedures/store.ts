import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { ActorIdentification, ThievingDiscoveryEvidence, ThievingDiscoveryObservation,
    ThievingDiscoverySource, ThievingDiscoveryVerifier, ThievingItemDelta, ThievingOutcomeEvidence,
    ThievingOutcomeReceipt, ThievingOutcomeVerifier, ThievingProcedureEffect, ThievingProcedureKind,
    ThievingProcedureResult, ThievingTarget } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
const VERSION = /^\d+\.\d+\.\d+$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ZERO = '0'.repeat(64);
const KINDS: ThievingProcedureKind[] = ['pickpocket', 'lockpick-door', 'container-theft', 'property-burglary'];
const RESULTS: ThievingProcedureResult[] = ['succeeded', 'failed', 'blocked'];
const EFFECTS: ThievingProcedureEffect[] = ['none', 'item-transfer', 'lock-opened', 'entry-completed'];
const DISCOVERY: ThievingDiscoverySource[] = ['direct-witness', 'guard-line-of-sight', 'alarm',
    'physical-trace', 'owner-loss-report'];
const IDENTIFICATION: ActorIdentification[] = ['none', 'direct', 'inferred'];

type OutcomeRow = { receipt_id: string; evidence_id: string; procedure_id: string; procedure_version: string;
    procedure_kind: ThievingProcedureKind; actor_agent_id: string; player_username: string; target_json: string;
    result: ThievingProcedureResult; effect: ThievingProcedureEffect; transferred_items_json: string;
    thieving_xp_delta: number; started_at_engine_tick: number; ended_at_engine_tick: number; source_event_id: string;
    source_evidence_digest: string; occurred_at: string; receipt_digest: string; recorded_at: string };
type DiscoveryRow = { observation_id: string; evidence_id: string; outcome_receipt_id: string;
    source: ThievingDiscoverySource; observer_agent_id: string | null; actor_identification: ActorIdentification;
    suspect_agent_id: string | null; facts_json: string; source_evidence_digest: string; occurred_at: string;
    observation_digest: string; recorded_at: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function id(value: string, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function timestamp(value: string, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
        throw new Error(`${field} is invalid`);
    }
    return value;
}
function integer(value: number, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${field} is invalid`);
    return value;
}
function exact(value: object, keys: string[], field: string): void {
    const actual = Object.keys(value).sort(), expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new Error(`${field} fields are invalid`);
    }
}
function target(value: ThievingTarget): ThievingTarget {
    if (!value || typeof value !== 'object') throw new Error('target is invalid');
    exact(value, ['kind', 'typeId', 'instanceIndex', 'name', 'x', 'z', 'level'], 'target');
    if (!['npc', 'loc'].includes(value.kind) || typeof value.name !== 'string' || !value.name.trim()
        || value.name.length > 100) throw new Error('target is invalid');
    const instanceIndex = value.instanceIndex === null ? null
        : integer(value.instanceIndex, 'target.instanceIndex', 0, 65_535);
    if ((value.kind === 'npc') !== (instanceIndex !== null)) throw new Error('target instance index is invalid');
    return { kind: value.kind, typeId: integer(value.typeId, 'target.typeId', 0, 65_535), instanceIndex,
        name: value.name.trim(), x: integer(value.x, 'target.x', 0, 16_383),
        z: integer(value.z, 'target.z', 0, 16_383), level: integer(value.level, 'target.level', 0, 3) };
}
function items(values: ThievingItemDelta[]): ThievingItemDelta[] {
    if (!Array.isArray(values) || values.length > 28) throw new Error('transferredItems is invalid');
    const seen = new Set<number>();
    return values.map((value, index) => {
        if (!value || typeof value !== 'object') throw new Error(`transferredItems[${index}] is invalid`);
        exact(value, ['itemId', 'itemName', 'quantity'], `transferredItems[${index}]`);
        const itemId = integer(value.itemId, `transferredItems[${index}].itemId`, 0, 65_535);
        if (seen.has(itemId) || typeof value.itemName !== 'string' || !value.itemName.trim()
            || value.itemName.length > 100) throw new Error('transferredItems is invalid');
        seen.add(itemId);
        return { itemId, itemName: value.itemName.trim(),
            quantity: integer(value.quantity, `transferredItems[${index}].quantity`, 1, 2_147_483_647) };
    }).sort((left, right) => left.itemId - right.itemId);
}
function receipt(row: OutcomeRow): ThievingOutcomeReceipt {
    return { receiptId: row.receipt_id, evidenceId: row.evidence_id, procedureId: row.procedure_id,
        procedureVersion: row.procedure_version, procedureKind: row.procedure_kind,
        actorAgentId: row.actor_agent_id, playerUsername: row.player_username,
        target: JSON.parse(row.target_json) as ThievingTarget, result: row.result, effect: row.effect,
        transferredItems: JSON.parse(row.transferred_items_json) as ThievingItemDelta[],
        thievingXpDelta: row.thieving_xp_delta, startedAtEngineTick: row.started_at_engine_tick,
        endedAtEngineTick: row.ended_at_engine_tick, sourceEventId: row.source_event_id,
        sourceEvidenceDigest: row.source_evidence_digest, occurredAt: row.occurred_at,
        receiptDigest: row.receipt_digest, recordedAt: row.recorded_at };
}
function observation(row: DiscoveryRow): ThievingDiscoveryObservation {
    return { observationId: row.observation_id, evidenceId: row.evidence_id,
        outcomeReceiptId: row.outcome_receipt_id, source: row.source, observerAgentId: row.observer_agent_id,
        actorIdentification: row.actor_identification, suspectAgentId: row.suspect_agent_id,
        facts: JSON.parse(row.facts_json) as string[], sourceEvidenceDigest: row.source_evidence_digest,
        occurredAt: row.occurred_at, observationDigest: row.observation_digest, recordedAt: row.recorded_at };
}

export class ThievingProcedureStore {
    private readonly database: Database;
    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        this.migrate();
    }
    close(): void { this.database.close(true); }
    getOutcome(receiptIdInput: string): ThievingOutcomeReceipt | null {
        const row = this.database.query('SELECT * FROM thieving_outcome WHERE receipt_id=?1')
            .get(id(receiptIdInput, 'receiptId')) as OutcomeRow | null;
        return row ? receipt(row) : null;
    }
    recordOutcome(receiptIdInput: string, input: ThievingOutcomeEvidence, verify?: ThievingOutcomeVerifier,
        recordedAtInput = new Date().toISOString()): ThievingOutcomeReceipt {
        const receiptId = id(receiptIdInput, 'receiptId'), evidence = this.validateOutcome(input);
        const recordedAt = timestamp(recordedAtInput, 'recordedAt');
        if (!verify?.(evidence)) throw new Error('Thieving outcome evidence is not trusted server evidence');
        const receiptDigest = hash({ receiptId, evidence }), existing = this.getOutcome(receiptId);
        if (existing) {
            if (existing.receiptDigest !== receiptDigest) throw new Error('Thieving receipt id was reused');
            return existing;
        }
        if (this.database.query('SELECT 1 FROM thieving_outcome WHERE evidence_id=?1').get(evidence.evidenceId)) {
            throw new Error('Thieving outcome evidence was already consumed');
        }
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO thieving_outcome VALUES(
                ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)`,
            [receiptId, evidence.evidenceId, evidence.procedureId, evidence.procedureVersion, evidence.procedureKind,
                evidence.actorAgentId, evidence.playerUsername, JSON.stringify(evidence.target), evidence.result,
                evidence.effect, JSON.stringify(evidence.transferredItems), evidence.thievingXpDelta,
                evidence.startedAtEngineTick, evidence.endedAtEngineTick, evidence.sourceEventId,
                evidence.sourceEvidenceDigest, evidence.occurredAt, receiptDigest, recordedAt]);
            this.audit('outcome', receiptId, receiptDigest, recordedAt);
        });
        transaction.immediate();
        return this.getOutcome(receiptId)!;
    }
    getDiscovery(observationIdInput: string): ThievingDiscoveryObservation | null {
        const row = this.database.query('SELECT * FROM thieving_discovery WHERE observation_id=?1')
            .get(id(observationIdInput, 'observationId')) as DiscoveryRow | null;
        return row ? observation(row) : null;
    }
    recordDiscovery(observationIdInput: string, input: ThievingDiscoveryEvidence,
        verify?: ThievingDiscoveryVerifier, recordedAtInput = new Date().toISOString()): ThievingDiscoveryObservation {
        const observationId = id(observationIdInput, 'observationId'), evidence = this.validateDiscovery(input);
        const recordedAt = timestamp(recordedAtInput, 'recordedAt'), outcome = this.getOutcome(evidence.outcomeReceiptId);
        if (!outcome) throw new Error('Discovery requires a persisted Thieving outcome');
        if (evidence.actorIdentification === 'direct' && evidence.suspectAgentId !== outcome.actorAgentId) {
            throw new Error('Direct witness identification does not match the world-truth actor');
        }
        if (Date.parse(evidence.occurredAt) < Date.parse(outcome.occurredAt)) {
            throw new Error('Discovery cannot occur before the Thieving outcome');
        }
        if (!verify?.(evidence, outcome)) throw new Error('Thieving discovery evidence is not trusted');
        const observationDigest = hash({ observationId, evidence }), existing = this.getDiscovery(observationId);
        if (existing) {
            if (existing.observationDigest !== observationDigest) throw new Error('Discovery observation id was reused');
            return existing;
        }
        if (this.database.query('SELECT 1 FROM thieving_discovery WHERE evidence_id=?1').get(evidence.evidenceId)) {
            throw new Error('Discovery evidence was already consumed');
        }
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO thieving_discovery VALUES(
                ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`, [observationId, evidence.evidenceId,
                evidence.outcomeReceiptId, evidence.source, evidence.observerAgentId, evidence.actorIdentification,
                evidence.suspectAgentId, JSON.stringify(evidence.facts), evidence.sourceEvidenceDigest,
                evidence.occurredAt, observationDigest, recordedAt]);
            this.audit('discovery', observationId, observationDigest, recordedAt);
        });
        transaction.immediate();
        return this.getDiscovery(observationId)!;
    }
    listDiscoveries(outcomeReceiptIdInput: string): ThievingDiscoveryObservation[] {
        return (this.database.query('SELECT * FROM thieving_discovery WHERE outcome_receipt_id=?1 ORDER BY occurred_at,observation_id')
            .all(id(outcomeReceiptIdInput, 'outcomeReceiptId')) as DiscoveryRow[]).map(observation);
    }
    /** Global audit order permits downstream consumers to backfill without inventing a new source clock. */
    listDiscoveriesAfter(afterSequence: number, limit = 100): Array<{
        sequence: number; observation: ThievingDiscoveryObservation }> {
        if (!Number.isSafeInteger(afterSequence) || afterSequence < 0
            || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
            throw new Error('Discovery page bounds are invalid');
        const rows = this.database.query(`SELECT a.sequence, d.* FROM thieving_audit a
            JOIN thieving_discovery d ON d.observation_id=a.entry_id
            WHERE a.entry_kind='discovery' AND a.sequence>?1 ORDER BY a.sequence LIMIT ?2`)
            .all(afterSequence, limit) as Array<DiscoveryRow & { sequence: number }>;
        return rows.map(row => ({ sequence: row.sequence, observation: observation(row) }));
    }
    verifyAuditChain(): boolean {
        const rows = this.database.query('SELECT * FROM thieving_audit ORDER BY sequence').all() as Array<{
            entry_kind: string; entry_id: string; entry_digest: string; recorded_at: string;
            previous_hash: string; entry_hash: string }>;
        const counts = this.database.query(`SELECT
            (SELECT COUNT(*) FROM thieving_outcome) + (SELECT COUNT(*) FROM thieving_discovery) AS events`)
            .get() as { events: number };
        if (rows.length !== counts.events) return false;
        let previous = ZERO;
        for (const row of rows) {
            const payload = { kind: row.entry_kind, id: row.entry_id, digest: row.entry_digest,
                recordedAt: row.recorded_at };
            if (row.entry_kind === 'outcome') {
                const source = this.getOutcome(row.entry_id);
                if (!source) return false;
                const { receiptId, receiptDigest, recordedAt: unused, ...evidence } = source;
                void unused;
                if (receiptDigest !== row.entry_digest || hash({ receiptId, evidence }) !== receiptDigest) return false;
            } else if (row.entry_kind === 'discovery') {
                const source = this.getDiscovery(row.entry_id);
                if (!source) return false;
                const { observationId, observationDigest, recordedAt: unused, ...evidence } = source;
                void unused;
                if (observationDigest !== row.entry_digest
                    || hash({ observationId, evidence }) !== observationDigest) return false;
            } else return false;
            if (row.previous_hash !== previous || row.entry_hash !== hash({ previousHash: previous, payload })) return false;
            previous = row.entry_hash;
        }
        return true;
    }
    private validateOutcome(value: ThievingOutcomeEvidence): ThievingOutcomeEvidence {
        if (!value || typeof value !== 'object') throw new Error('Thieving outcome evidence is invalid');
        exact(value, ['evidenceId', 'procedureId', 'procedureVersion', 'procedureKind', 'actorAgentId',
            'playerUsername', 'target', 'result', 'effect', 'transferredItems', 'thievingXpDelta',
            'startedAtEngineTick', 'endedAtEngineTick', 'sourceEventId', 'sourceEvidenceDigest', 'occurredAt'], 'outcome');
        if (!VERSION.test(value.procedureVersion) || !KINDS.includes(value.procedureKind)
            || !RESULTS.includes(value.result) || !EFFECTS.includes(value.effect)
            || typeof value.playerUsername !== 'string' || !value.playerUsername.trim() || value.playerUsername.length > 12
            || !DIGEST.test(value.sourceEvidenceDigest)) throw new Error('Thieving outcome evidence is invalid');
        const transferredItems = items(value.transferredItems);
        const thievingXpDelta = integer(value.thievingXpDelta, 'thievingXpDelta', 0, 2_147_483_647);
        const started = integer(value.startedAtEngineTick, 'startedAtEngineTick', 0, Number.MAX_SAFE_INTEGER);
        const ended = integer(value.endedAtEngineTick, 'endedAtEngineTick', started, Number.MAX_SAFE_INTEGER);
        if (value.result !== 'succeeded' && (value.effect !== 'none' || transferredItems.length > 0 || thievingXpDelta > 0)) {
            throw new Error('Unsuccessful Thieving outcomes cannot claim effects');
        }
        if (value.result === 'succeeded' && value.effect === 'none') throw new Error('Successful Thieving outcome has no effect');
        if (value.effect === 'item-transfer' && transferredItems.length === 0) throw new Error('Item transfer has no items');
        if (value.effect !== 'item-transfer' && transferredItems.length > 0) throw new Error('Items require an item-transfer effect');
        const effectMatchesKind = (value.procedureKind === 'pickpocket' || value.procedureKind === 'container-theft')
            ? value.effect === 'item-transfer' : value.procedureKind === 'property-burglary'
                ? value.effect === 'entry-completed' : value.effect === 'lock-opened' || value.effect === 'entry-completed';
        if (value.result === 'succeeded' && !effectMatchesKind) throw new Error('Thieving effect does not match procedure');
        return { evidenceId: id(value.evidenceId, 'evidenceId'), procedureId: id(value.procedureId, 'procedureId'),
            procedureVersion: value.procedureVersion, procedureKind: value.procedureKind,
            actorAgentId: id(value.actorAgentId, 'actorAgentId'), playerUsername: value.playerUsername.trim().toLowerCase(),
            target: target(value.target), result: value.result, effect: value.effect, transferredItems,
            thievingXpDelta, startedAtEngineTick: started, endedAtEngineTick: ended,
            sourceEventId: id(value.sourceEventId, 'sourceEventId'), sourceEvidenceDigest: value.sourceEvidenceDigest,
            occurredAt: timestamp(value.occurredAt, 'occurredAt') };
    }
    private validateDiscovery(value: ThievingDiscoveryEvidence): ThievingDiscoveryEvidence {
        if (!value || typeof value !== 'object') throw new Error('Thieving discovery evidence is invalid');
        exact(value, ['evidenceId', 'outcomeReceiptId', 'source', 'observerAgentId', 'actorIdentification',
            'suspectAgentId', 'facts', 'sourceEvidenceDigest', 'occurredAt'], 'discovery');
        if (!DISCOVERY.includes(value.source) || !IDENTIFICATION.includes(value.actorIdentification)
            || !DIGEST.test(value.sourceEvidenceDigest) || !Array.isArray(value.facts) || value.facts.length < 1
            || value.facts.length > 20 || value.facts.some(fact => typeof fact !== 'string' || !fact.trim()
                || fact.length > 300)) throw new Error('Thieving discovery evidence is invalid');
        const observerAgentId = value.observerAgentId === null ? null : id(value.observerAgentId, 'observerAgentId');
        const suspectAgentId = value.suspectAgentId === null ? null : id(value.suspectAgentId, 'suspectAgentId');
        if ((value.actorIdentification === 'none') !== (suspectAgentId === null)) {
            throw new Error('Actor identification and suspect must remain consistent');
        }
        return { evidenceId: id(value.evidenceId, 'evidenceId'), outcomeReceiptId: id(value.outcomeReceiptId,
            'outcomeReceiptId'), source: value.source, observerAgentId, actorIdentification: value.actorIdentification,
            suspectAgentId, facts: value.facts.map(fact => fact.trim()), sourceEvidenceDigest: value.sourceEvidenceDigest,
            occurredAt: timestamp(value.occurredAt, 'occurredAt') };
    }
    private audit(kind: 'outcome' | 'discovery', entryId: string, digest: string, recordedAt: string): void {
        const previous = (this.database.query('SELECT entry_hash FROM thieving_audit ORDER BY sequence DESC LIMIT 1')
            .get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
        const payload = { kind, id: entryId, digest, recordedAt };
        this.database.run(`INSERT INTO thieving_audit(entry_kind,entry_id,entry_digest,recorded_at,previous_hash,entry_hash)
            VALUES(?1,?2,?3,?4,?5,?6)`, [kind, entryId, digest, recordedAt, previous,
            hash({ previousHash: previous, payload })]);
    }
    private migrate(): void {
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > 1) throw new Error(`Thieving procedure schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        const transaction = this.database.transaction(() => {
            this.database.run(`CREATE TABLE thieving_outcome(
                receipt_id TEXT PRIMARY KEY,evidence_id TEXT NOT NULL UNIQUE,procedure_id TEXT NOT NULL,
                procedure_version TEXT NOT NULL,procedure_kind TEXT NOT NULL,actor_agent_id TEXT NOT NULL,
                player_username TEXT NOT NULL,target_json TEXT NOT NULL,result TEXT NOT NULL,effect TEXT NOT NULL,
                transferred_items_json TEXT NOT NULL,thieving_xp_delta INTEGER NOT NULL,
                started_at_engine_tick INTEGER NOT NULL,ended_at_engine_tick INTEGER NOT NULL,
                source_event_id TEXT NOT NULL UNIQUE,source_evidence_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,
                receipt_digest TEXT NOT NULL,recorded_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE thieving_discovery(
                observation_id TEXT PRIMARY KEY,evidence_id TEXT NOT NULL UNIQUE,
                outcome_receipt_id TEXT NOT NULL REFERENCES thieving_outcome(receipt_id),source TEXT NOT NULL,
                observer_agent_id TEXT,actor_identification TEXT NOT NULL,suspect_agent_id TEXT,facts_json TEXT NOT NULL,
                source_evidence_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,observation_digest TEXT NOT NULL,
                recorded_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE thieving_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_kind TEXT NOT NULL,entry_id TEXT NOT NULL,entry_digest TEXT NOT NULL,recorded_at TEXT NOT NULL,
                previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,UNIQUE(entry_kind,entry_id))`);
            this.database.run('PRAGMA user_version = 1');
        });
        transaction.immediate();
    }
}
