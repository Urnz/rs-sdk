import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { economicContractsDbPath } from './paths.js';
import type { AdminSkillRun } from './skill-history.js';
import { extractEconomyEvents } from './transaction-telemetry.js';

export type EconomicOfferKind = 'trade' | 'work' | 'service';
export type EconomicOfferStatus = 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired';

export interface EconomicItemTerm { id: number; name: string; count: number }
export interface EconomicObligation {
    gp: number;
    items: EconomicItemTerm[];
    service: string | null;
    skill?: { id: string; version: string } | null;
}

export interface EconomicContractEvidence {
    evidenceId: string;
    contractId: string;
    party: 'a' | 'b';
    actorAgentId: string;
    runId: string;
    journalDigest: string;
    matchedGp: number;
    matchedItems: EconomicItemTerm[];
    matchedService: boolean;
    economyEventIds: string[];
    recordedAt: string;
}

export interface CreateEconomicOffer {
    creatorAgentId: string;
    counterpartyAgentId: string;
    kind: EconomicOfferKind;
    title: string;
    summary: string;
    creatorProvides: EconomicObligation;
    counterpartyProvides: EconomicObligation;
    expiresAt: string;
}

export interface EconomicOffer extends CreateEconomicOffer {
    offerId: string;
    termsDigest: string;
    status: EconomicOfferStatus;
    contractId: string | null;
    responseNote: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
}

export interface EconomicContract {
    contractId: string;
    sourceOfferId: string;
    kind: EconomicOfferKind;
    partyAAgentId: string;
    partyBAgentId: string;
    title: string;
    summary: string;
    partyAProvides: EconomicObligation;
    partyBProvides: EconomicObligation;
    termsDigest: string;
    status: 'active' | 'fulfilled';
    partyASatisfied: boolean;
    partyBSatisfied: boolean;
    evidence: EconomicContractEvidence[];
    acceptedAt: string;
    fulfilledAt: string | null;
    revision: number;
}

interface OfferRow {
    offer_id: string; creator_agent_id: string; counterparty_agent_id: string; kind: EconomicOfferKind;
    title: string; summary: string; creator_provides_json: string; counterparty_provides_json: string;
    terms_digest: string; status: EconomicOfferStatus; contract_id: string | null; response_note: string;
    expires_at: string; revision: number; created_at: string; updated_at: string;
}

interface ContractRow {
    contract_id: string; source_offer_id: string; kind: EconomicOfferKind; party_a_agent_id: string;
    party_b_agent_id: string; title: string; summary: string; party_a_provides_json: string;
    party_b_provides_json: string; terms_digest: string; status: 'active'; accepted_at: string; revision: number;
    fulfilled_at: string | null;
}

interface EvidenceRow {
    evidence_id: string; contract_id: string; party: 'a' | 'b'; actor_agent_id: string; run_id: string;
    journal_digest: string; matched_gp: number; matched_items_json: string; matched_service: number;
    economy_event_ids_json: string; recorded_at: string;
}

function agentId(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(normalized) || normalized.length > 64) {
        throw new Error(`${field} is invalid`);
    }
    return normalized;
}

function boundedText(value: string, field: string, maximum: number): string {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > maximum) throw new Error(`${field} must contain 1-${maximum} characters`);
    return normalized;
}

function isoTimestamp(value: string, field: string): string {
    if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
    return new Date(value).toISOString();
}

function obligation(value: EconomicObligation, field: string): EconomicObligation {
    if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.gp) || value.gp < 0
        || value.gp > 2_147_483_647 || !Array.isArray(value.items) || value.items.length > 20) {
        throw new Error(`${field} is invalid`);
    }
    const ids = new Set<number>();
    const items = value.items.map((item, index) => {
        if (!item || !Number.isSafeInteger(item.id) || item.id < 0 || item.id > 65_535
            || !Number.isSafeInteger(item.count) || item.count < 1 || item.count > 2_147_483_647
            || ids.has(item.id)) throw new Error(`${field}.items[${index}] is invalid or duplicated`);
        ids.add(item.id);
        return { id: item.id, name: boundedText(item.name, `${field}.items[${index}].name`, 80), count: item.count };
    }).sort((left, right) => left.id - right.id);
    const service = value.service === null || value.service === undefined || value.service.trim() === ''
        ? null : boundedText(value.service, `${field}.service`, 240);
    const skill = value.skill === null || value.skill === undefined ? null : {
        id: boundedText(value.skill.id, `${field}.skill.id`, 120),
        version: boundedText(value.skill.version, `${field}.skill.version`, 32)
    };
    if (skill && (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(skill.id)
        || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(skill.version))) {
        throw new Error(`${field}.skill is invalid`);
    }
    if (service && !skill) throw new Error(`${field}.service requires an exact evidence skill`);
    if (!service && skill) throw new Error(`${field}.skill requires a service obligation`);
    if (value.gp === 0 && items.length === 0 && !service) throw new Error(`${field} must contain an obligation`);
    return { gp: value.gp, items, service, skill };
}

function offer(row: OfferRow): EconomicOffer {
    return { offerId: row.offer_id, creatorAgentId: row.creator_agent_id,
        counterpartyAgentId: row.counterparty_agent_id, kind: row.kind, title: row.title, summary: row.summary,
        creatorProvides: JSON.parse(row.creator_provides_json) as EconomicObligation,
        counterpartyProvides: JSON.parse(row.counterparty_provides_json) as EconomicObligation,
        termsDigest: row.terms_digest, status: row.status, contractId: row.contract_id,
        responseNote: row.response_note, expiresAt: row.expires_at, revision: row.revision,
        createdAt: row.created_at, updatedAt: row.updated_at };
}

function evidence(row: EvidenceRow): EconomicContractEvidence {
    return { evidenceId: row.evidence_id, contractId: row.contract_id, party: row.party,
        actorAgentId: row.actor_agent_id, runId: row.run_id, journalDigest: row.journal_digest,
        matchedGp: row.matched_gp, matchedItems: JSON.parse(row.matched_items_json) as EconomicItemTerm[],
        matchedService: row.matched_service === 1,
        economyEventIds: JSON.parse(row.economy_event_ids_json) as string[], recordedAt: row.recorded_at };
}

function obligationSatisfied(required: EconomicObligation, records: EconomicContractEvidence[]): boolean {
    const gp = records.reduce((total, item) => total + item.matchedGp, 0);
    const items = new Map<number, number>();
    for (const record of records) for (const item of record.matchedItems) {
        items.set(item.id, (items.get(item.id) ?? 0) + item.count);
    }
    return gp >= required.gp
        && required.items.every(item => (items.get(item.id) ?? 0) >= item.count)
        && (!required.service || records.some(item => item.matchedService));
}

function contract(row: ContractRow, records: EconomicContractEvidence[]): EconomicContract {
    const partyAProvides = JSON.parse(row.party_a_provides_json) as EconomicObligation;
    const partyBProvides = JSON.parse(row.party_b_provides_json) as EconomicObligation;
    return { contractId: row.contract_id, sourceOfferId: row.source_offer_id, kind: row.kind,
        partyAAgentId: row.party_a_agent_id, partyBAgentId: row.party_b_agent_id,
        title: row.title, summary: row.summary,
        partyAProvides, partyBProvides, termsDigest: row.terms_digest,
        status: row.fulfilled_at ? 'fulfilled' : 'active',
        partyASatisfied: obligationSatisfied(partyAProvides, records.filter(item => item.party === 'a')),
        partyBSatisfied: obligationSatisfied(partyBProvides, records.filter(item => item.party === 'b')),
        evidence: records, acceptedAt: row.accepted_at, fulfilledAt: row.fulfilled_at, revision: row.revision };
}

export function validateEconomicOffer(input: CreateEconomicOffer, now = new Date().toISOString()): CreateEconomicOffer & { termsDigest: string } {
    if (!input || typeof input !== 'object' || !['trade', 'work', 'service'].includes(input.kind)) {
        throw new Error('Economic offer is invalid');
    }
    const creatorAgentId = agentId(input.creatorAgentId, 'creatorAgentId');
    const counterpartyAgentId = agentId(input.counterpartyAgentId, 'counterpartyAgentId');
    if (creatorAgentId === counterpartyAgentId) throw new Error('An offer requires two different agents');
    const normalized = { creatorAgentId, counterpartyAgentId, kind: input.kind,
        title: boundedText(input.title, 'title', 120), summary: boundedText(input.summary, 'summary', 320),
        creatorProvides: obligation(input.creatorProvides, 'creatorProvides'),
        counterpartyProvides: obligation(input.counterpartyProvides, 'counterpartyProvides'),
        expiresAt: isoTimestamp(input.expiresAt, 'expiresAt') };
    const current = Date.parse(isoTimestamp(now, 'now'));
    const expiry = Date.parse(normalized.expiresAt);
    if (expiry <= current || expiry > current + 365 * 24 * 60 * 60_000) {
        throw new Error('Offer expiry must be within the next 365 days');
    }
    const termsDigest = createHash('sha256').update(JSON.stringify({ schemaVersion: 1, ...normalized })).digest('hex');
    return { ...normalized, termsDigest };
}

export class EconomicContractStore {
    private readonly database: Database;

    constructor(path = economicContractsDbPath) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        this.database.run(`CREATE TABLE IF NOT EXISTS economic_offer (
            offer_id TEXT PRIMARY KEY, creator_agent_id TEXT NOT NULL, counterparty_agent_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('trade', 'work', 'service')), title TEXT NOT NULL, summary TEXT NOT NULL,
            creator_provides_json TEXT NOT NULL, counterparty_provides_json TEXT NOT NULL, terms_digest TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('open', 'accepted', 'declined', 'withdrawn', 'expired')),
            contract_id TEXT UNIQUE, response_note TEXT NOT NULL, expires_at TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK (revision >= 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS economic_contract (
            contract_id TEXT PRIMARY KEY, source_offer_id TEXT NOT NULL UNIQUE REFERENCES economic_offer(offer_id),
            kind TEXT NOT NULL CHECK (kind IN ('trade', 'work', 'service')),
            party_a_agent_id TEXT NOT NULL, party_b_agent_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
            party_a_provides_json TEXT NOT NULL, party_b_provides_json TEXT NOT NULL, terms_digest TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status = 'active'), accepted_at TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK (revision >= 1))`);
        this.addColumn('economic_contract', 'fulfilled_at', 'TEXT');
        this.database.run(`CREATE TABLE IF NOT EXISTS economic_contract_evidence (
            evidence_id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES economic_contract(contract_id),
            party TEXT NOT NULL CHECK (party IN ('a', 'b')), actor_agent_id TEXT NOT NULL,
            run_id TEXT NOT NULL UNIQUE, journal_digest TEXT NOT NULL, matched_gp INTEGER NOT NULL CHECK (matched_gp >= 0),
            matched_items_json TEXT NOT NULL, matched_service INTEGER NOT NULL CHECK (matched_service IN (0, 1)),
            economy_event_ids_json TEXT NOT NULL, recorded_at TEXT NOT NULL,
            UNIQUE (contract_id, party, journal_digest))`);
    }

    private addColumn(table: string, column: string, declaration: string): void {
        const columns = this.database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!columns.some(entry => entry.name === column)) this.database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
    }

    close(): void { this.database.close(true); }

    expire(now = new Date().toISOString()): number {
        return this.database.run(`UPDATE economic_offer SET status = 'expired', revision = revision + 1,
            updated_at = ?1 WHERE status = 'open' AND expires_at <= ?1`, [isoTimestamp(now, 'now')]).changes;
    }

    getOffer(offerId: string): EconomicOffer | null {
        const row = this.database.query('SELECT * FROM economic_offer WHERE offer_id = ?1')
            .get(offerId) as OfferRow | null;
        return row ? offer(row) : null;
    }

    listOffers(limit = 100, now = new Date().toISOString()): EconomicOffer[] {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Offer list limit is invalid');
        this.expire(now);
        return (this.database.query(`SELECT * FROM economic_offer ORDER BY created_at DESC, offer_id DESC LIMIT ?1`)
            .all(limit) as OfferRow[]).map(offer);
    }

    listContracts(limit = 100): EconomicContract[] {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Contract list limit is invalid');
        return (this.database.query(`SELECT * FROM economic_contract ORDER BY accepted_at DESC, contract_id DESC LIMIT ?1`)
            .all(limit) as ContractRow[]).map(row => this.contract(row));
    }

    getContract(contractId: string): EconomicContract | null {
        const row = this.database.query('SELECT * FROM economic_contract WHERE contract_id = ?1')
            .get(contractId) as ContractRow | null;
        return row ? this.contract(row) : null;
    }

    private contract(row: ContractRow): EconomicContract {
        const records = (this.database.query(`SELECT * FROM economic_contract_evidence
            WHERE contract_id = ?1 ORDER BY recorded_at, evidence_id`).all(row.contract_id) as EvidenceRow[]).map(evidence);
        return contract(row, records);
    }

    create(input: CreateEconomicOffer, now = new Date().toISOString(), offerId = randomUUID()): EconomicOffer {
        const value = validateEconomicOffer(input, now);
        this.database.run(`INSERT INTO economic_offer (offer_id, creator_agent_id, counterparty_agent_id, kind,
            title, summary, creator_provides_json, counterparty_provides_json, terms_digest, status, contract_id,
            response_note, expires_at, revision, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open', NULL, '', ?10, 1, ?11, ?11)`,
        [offerId, value.creatorAgentId, value.counterpartyAgentId, value.kind, value.title, value.summary,
            JSON.stringify(value.creatorProvides), JSON.stringify(value.counterpartyProvides), value.termsDigest,
            value.expiresAt, isoTimestamp(now, 'now')]);
        return this.getOffer(offerId)!;
    }

    withdraw(offerId: string, actorAgentId: string, expectedRevision: number, note: string,
        now = new Date().toISOString()): EconomicOffer {
        this.expire(now);
        const current = this.getOffer(offerId);
        if (!current || current.creatorAgentId !== agentId(actorAgentId, 'actorAgentId')) {
            throw new Error('Only the offer creator may withdraw it');
        }
        if (current.status !== 'open') return current;
        const result = this.database.run(`UPDATE economic_offer SET status = 'withdrawn', response_note = ?4,
            revision = revision + 1, updated_at = ?5 WHERE offer_id = ?1 AND creator_agent_id = ?2
                AND revision = ?3 AND status = 'open'`,
        [offerId, current.creatorAgentId, expectedRevision, boundedText(note, 'responseNote', 240), isoTimestamp(now, 'now')]);
        if (result.changes !== 1) throw new Error('Offer changed before withdrawal; refresh and try again');
        return this.getOffer(offerId)!;
    }

    decline(offerId: string, actorAgentId: string, expectedRevision: number, note: string,
        now = new Date().toISOString()): EconomicOffer {
        this.expire(now);
        const current = this.getOffer(offerId);
        if (!current || current.counterpartyAgentId !== agentId(actorAgentId, 'actorAgentId')) {
            throw new Error('Only the named counterparty may decline this offer');
        }
        if (current.status !== 'open') return current;
        const result = this.database.run(`UPDATE economic_offer SET status = 'declined', response_note = ?4,
            revision = revision + 1, updated_at = ?5 WHERE offer_id = ?1 AND counterparty_agent_id = ?2
                AND revision = ?3 AND status = 'open'`,
        [offerId, current.counterpartyAgentId, expectedRevision, boundedText(note, 'responseNote', 240), isoTimestamp(now, 'now')]);
        if (result.changes !== 1) throw new Error('Offer changed before decline; refresh and try again');
        return this.getOffer(offerId)!;
    }

    accept(offerId: string, actorAgentId: string, expectedRevision: number,
        now = new Date().toISOString(), contractId = randomUUID()): { offer: EconomicOffer; contract: EconomicContract } {
        const acceptedAt = isoTimestamp(now, 'now');
        this.expire(acceptedAt);
        const transaction = this.database.transaction(() => {
            const current = this.getOffer(offerId);
            if (!current || current.counterpartyAgentId !== agentId(actorAgentId, 'actorAgentId')) {
                throw new Error('Only the named counterparty may accept this offer');
            }
            if (current.status === 'accepted' && current.contractId) return;
            if (current.status !== 'open') throw new Error(`Offer is no longer open: ${current.status}`);
            if ((current.creatorProvides.service && !current.creatorProvides.skill)
                || (current.counterpartyProvides.service && !current.counterpartyProvides.skill)) {
                throw new Error('Legacy service offer has no exact evidence skill; replace the offer before acceptance');
            }
            const updated = this.database.run(`UPDATE economic_offer SET status = 'accepted', contract_id = ?4,
                response_note = 'Accepted by named counterparty.', revision = revision + 1, updated_at = ?5
                WHERE offer_id = ?1 AND counterparty_agent_id = ?2 AND revision = ?3 AND status = 'open'`,
            [offerId, current.counterpartyAgentId, expectedRevision, contractId, acceptedAt]);
            if (updated.changes !== 1) throw new Error('Offer changed before acceptance; refresh and try again');
            this.database.run(`INSERT INTO economic_contract (contract_id, source_offer_id, kind,
                party_a_agent_id, party_b_agent_id, title, summary, party_a_provides_json,
                party_b_provides_json, terms_digest, status, accepted_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'active', ?11, 1)`,
            [contractId, offerId, current.kind, current.creatorAgentId, current.counterpartyAgentId,
                current.title, current.summary, JSON.stringify(current.creatorProvides),
                JSON.stringify(current.counterpartyProvides), current.termsDigest, acceptedAt]);
        });
        transaction.immediate();
        const accepted = this.getOffer(offerId)!;
        return { offer: accepted, contract: this.getContract(accepted.contractId!)! };
    }

    recordRunEvidence(contractId: string, actorAgentIdInput: string, run: AdminSkillRun,
        avatarByAgentId: ReadonlyMap<string, string | null>, now = new Date().toISOString()): EconomicContract {
        const actorAgentId = agentId(actorAgentIdInput, 'actorAgentId');
        const current = this.getContract(contractId);
        if (!current) throw new Error('Economic contract does not exist');
        const party = current.partyAAgentId === actorAgentId ? 'a'
            : current.partyBAgentId === actorAgentId ? 'b' : null;
        if (!party) throw new Error('Only a contract party may submit run evidence');
        const actorAvatar = avatarByAgentId.get(actorAgentId)?.trim().toLowerCase() ?? null;
        const counterpartyAgentId = party === 'a' ? current.partyBAgentId : current.partyAAgentId;
        const counterpartyAvatar = avatarByAgentId.get(counterpartyAgentId)?.trim().toLowerCase() ?? null;
        if (!actorAvatar || run.username !== actorAvatar) throw new Error('Skill run does not belong to the exact party avatar');
        const startedAt = Date.parse(run.startedAt);
        if (run.status !== 'completed' || !Number.isFinite(startedAt)
            || startedAt < Date.parse(current.acceptedAt)) {
            throw new Error('Only a completed post-acceptance skill run may prove performance');
        }
        const journalDigest = createHash('sha256').update(JSON.stringify(run)).digest('hex');
        const existing = this.database.query(`SELECT * FROM economic_contract_evidence
            WHERE run_id = ?1`).get(run.runId) as EvidenceRow | null;
        if (existing) {
            if (existing.contract_id !== contractId || existing.actor_agent_id !== actorAgentId
                || existing.journal_digest !== journalDigest) {
                throw new Error('Skill run evidence is already claimed or its journal changed');
            }
            return current;
        }
        if (current.status !== 'active') throw new Error('Economic contract is already fulfilled');
        const required = party === 'a' ? current.partyAProvides : current.partyBProvides;
        const trades = extractEconomyEvents({ runId: run.runId, username: run.username,
            skillId: run.skill.id, events: run.events }).filter(item => !item.partial && item.kind === 'player-trade'
                && !!counterpartyAvatar && item.counterparty?.trim().toLowerCase() === counterpartyAvatar);
        const matchedGp = trades.reduce((total, item) => total + Math.max(0, -item.coinsDelta), 0);
        const itemTotals = new Map<number, EconomicItemTerm>();
        for (const event of trades) for (const item of event.itemsOut) {
            if (item.id === null) continue;
            const previous = itemTotals.get(item.id);
            itemTotals.set(item.id, { id: item.id, name: item.name,
                count: (previous?.count ?? 0) + item.quantity });
        }
        const matchedItems = [...itemTotals.values()].sort((left, right) => left.id - right.id);
        const matchedService = Boolean(required.service && required.skill
            && required.skill.id === run.skill.id && required.skill.version === run.skill.version);
        const relevant = matchedService || (required.gp > 0 && matchedGp > 0)
            || required.items.some(item => (itemTotals.get(item.id)?.count ?? 0) > 0);
        if (!relevant) throw new Error('Skill run contains no evidence relevant to this party obligation');
        const recordedAt = isoTimestamp(now, 'now');
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO economic_contract_evidence (evidence_id, contract_id, party,
                actor_agent_id, run_id, journal_digest, matched_gp, matched_items_json, matched_service,
                economy_event_ids_json, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
            [randomUUID(), contractId, party, actorAgentId, run.runId, journalDigest, matchedGp,
                JSON.stringify(matchedItems), matchedService ? 1 : 0,
                JSON.stringify(trades.map(item => item.id)), recordedAt]);
            const updated = this.getContract(contractId)!;
            if (updated.partyASatisfied && updated.partyBSatisfied) {
                this.database.run(`UPDATE economic_contract SET fulfilled_at = ?2,
                    revision = revision + 1 WHERE contract_id = ?1 AND fulfilled_at IS NULL`,
                [contractId, recordedAt]);
            } else {
                this.database.run(`UPDATE economic_contract SET revision = revision + 1
                    WHERE contract_id = ?1 AND fulfilled_at IS NULL`, [contractId]);
            }
        });
        transaction.immediate();
        return this.getContract(contractId)!;
    }
}
