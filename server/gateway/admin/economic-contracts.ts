import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { economicContractsDbPath } from './paths.js';
import type { AdminSkillRun } from './skill-history.js';
import { extractEconomyEvents } from './transaction-telemetry.js';
import type { InstitutionKind } from './institution-treasury.js';

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

type StoredEconomicContractSettlementStatus = 'funded' | 'settling' | 'committed';
export type EconomicContractSettlementStatus = StoredEconomicContractSettlementStatus | 'released';

export interface EconomicContractSettlement {
    settlementId: string;
    contractId: string;
    party: 'a' | 'b';
    payerAgentId: string;
    payerKind: InstitutionKind;
    payerActorId: string;
    payeeAgentId: string;
    payeeUsername: string | null;
    payeeKind: InstitutionKind | null;
    payeeActorId: string | null;
    amountGp: number;
    reservationId: string;
    status: EconomicContractSettlementStatus;
    error: string;
    createdAt: string;
    updatedAt: string;
    committedAt: string | null;
    releasedAt: string | null;
}

export type CreateEconomicContractSettlement = Omit<EconomicContractSettlement,
    'contractId' | 'status' | 'error' | 'createdAt' | 'updatedAt' | 'committedAt' | 'releasedAt'>;

export interface EconomicContractPlayerEscrow {
    escrowId: string;
    contractId: string;
    party: 'a' | 'b';
    payerAgentId: string;
    payerUsername: string;
    payeeAgentId: string;
    payeeUsername: string;
    assets: { gp: number; items: Array<{ id: number; count: number }> };
    status: EconomicContractSettlementStatus;
    error: string;
    createdAt: string;
    updatedAt: string;
    committedAt: string | null;
    releasedAt: string | null;
}

export type CreateEconomicContractPlayerEscrow = Omit<EconomicContractPlayerEscrow,
    'contractId' | 'status' | 'error' | 'createdAt' | 'updatedAt' | 'committedAt' | 'releasedAt'>;

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
    status: 'active' | 'fulfilled' | 'cancelling' | 'defaulting' | 'cancelled' | 'defaulted';
    partyASatisfied: boolean;
    partyBSatisfied: boolean;
    evidence: EconomicContractEvidence[];
    settlements: EconomicContractSettlement[];
    playerEscrows: EconomicContractPlayerEscrow[];
    acceptedAt: string;
    fulfilledAt: string | null;
    resolvedAt: string | null;
    resolutionNote: string;
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
    fulfilled_at: string | null; resolution: 'active' | 'fulfilled' | 'cancelled' | 'defaulted';
    resolution_intent: string | null; resolution_note: string; resolution_started_at: string | null;
    resolved_at: string | null;
}

interface EvidenceRow {
    evidence_id: string; contract_id: string; party: 'a' | 'b'; actor_agent_id: string; run_id: string;
    journal_digest: string; matched_gp: number; matched_items_json: string; matched_service: number;
    economy_event_ids_json: string; recorded_at: string;
}

interface SettlementRow {
    settlement_id: string; contract_id: string; party: 'a' | 'b'; payer_agent_id: string;
    payer_kind: InstitutionKind; payer_actor_id: string; payee_agent_id: string;
    payee_username: string; payee_kind: InstitutionKind | null; payee_actor_id: string | null;
    amount_gp: number; reservation_id: string;
    status: StoredEconomicContractSettlementStatus; error: string; created_at: string;
    updated_at: string; committed_at: string | null; released_at: string | null;
}

interface PlayerEscrowRow {
    escrow_id: string; contract_id: string; party: 'a' | 'b'; payer_agent_id: string;
    payer_username: string; payee_agent_id: string; payee_username: string; assets_json: string;
    status: StoredEconomicContractSettlementStatus; error: string; created_at: string;
    updated_at: string; committed_at: string | null; released_at: string | null;
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

function settlement(row: SettlementRow): EconomicContractSettlement {
    return { settlementId: row.settlement_id, contractId: row.contract_id, party: row.party,
        payerAgentId: row.payer_agent_id, payerKind: row.payer_kind, payerActorId: row.payer_actor_id,
        payeeAgentId: row.payee_agent_id, payeeUsername: row.payee_username || null,
        payeeKind: row.payee_kind, payeeActorId: row.payee_actor_id, amountGp: row.amount_gp,
        reservationId: row.reservation_id, status: row.released_at ? 'released' : row.status, error: row.error,
        createdAt: row.created_at, updatedAt: row.updated_at,
        committedAt: row.committed_at, releasedAt: row.released_at };
}

function playerEscrow(row: PlayerEscrowRow): EconomicContractPlayerEscrow {
    return { escrowId: row.escrow_id, contractId: row.contract_id, party: row.party,
        payerAgentId: row.payer_agent_id, payerUsername: row.payer_username,
        payeeAgentId: row.payee_agent_id, payeeUsername: row.payee_username,
        assets: JSON.parse(row.assets_json) as EconomicContractPlayerEscrow['assets'],
        status: row.released_at ? 'released' : row.status, error: row.error, createdAt: row.created_at,
        updatedAt: row.updated_at, committedAt: row.committed_at, releasedAt: row.released_at };
}

function obligationSatisfied(required: EconomicObligation, records: EconomicContractEvidence[],
    automatedGp = 0, automatedItems: Array<{ id: number; count: number }> = [],
    ignoreAssetEvidence = false): boolean {
    const gp = automatedGp + (ignoreAssetEvidence ? 0 : records.reduce((total, item) => total + item.matchedGp, 0));
    const items = new Map<number, number>();
    for (const item of automatedItems) items.set(item.id, (items.get(item.id) ?? 0) + item.count);
    for (const record of ignoreAssetEvidence ? [] : records) for (const item of record.matchedItems) {
        items.set(item.id, (items.get(item.id) ?? 0) + item.count);
    }
    return gp >= required.gp
        && required.items.every(item => (items.get(item.id) ?? 0) >= item.count)
        && (!required.service || records.some(item => item.matchedService));
}

function contract(row: ContractRow, records: EconomicContractEvidence[], settlements: EconomicContractSettlement[],
    playerEscrows: EconomicContractPlayerEscrow[]): EconomicContract {
    const partyAProvides = JSON.parse(row.party_a_provides_json) as EconomicObligation;
    const partyBProvides = JSON.parse(row.party_b_provides_json) as EconomicObligation;
    return { contractId: row.contract_id, sourceOfferId: row.source_offer_id, kind: row.kind,
        partyAAgentId: row.party_a_agent_id, partyBAgentId: row.party_b_agent_id,
        title: row.title, summary: row.summary,
        partyAProvides, partyBProvides, termsDigest: row.terms_digest,
        status: row.resolution_intent === 'cancelled' ? 'cancelling'
            : row.resolution_intent === 'defaulted' ? 'defaulting' : row.resolution,
        partyASatisfied: obligationSatisfied(partyAProvides, records.filter(item => item.party === 'a'),
            settlements.filter(item => item.party === 'a' && item.status === 'committed')
                .reduce((total, item) => total + item.amountGp, 0)
                + playerEscrows.filter(item => item.party === 'a' && item.status === 'committed')
                    .reduce((total, item) => total + item.assets.gp, 0),
            playerEscrows.filter(item => item.party === 'a' && item.status === 'committed')
                .flatMap(item => item.assets.items), playerEscrows.some(item => item.party === 'a')),
        partyBSatisfied: obligationSatisfied(partyBProvides, records.filter(item => item.party === 'b'),
            settlements.filter(item => item.party === 'b' && item.status === 'committed')
                .reduce((total, item) => total + item.amountGp, 0)
                + playerEscrows.filter(item => item.party === 'b' && item.status === 'committed')
                    .reduce((total, item) => total + item.assets.gp, 0),
            playerEscrows.filter(item => item.party === 'b' && item.status === 'committed')
                .flatMap(item => item.assets.items), playerEscrows.some(item => item.party === 'b')),
        evidence: records, settlements, playerEscrows, acceptedAt: row.accepted_at,
        fulfilledAt: row.fulfilled_at, resolvedAt: row.resolved_at,
        resolutionNote: row.resolution_note, revision: row.revision };
}

function partySecured(current: EconomicContract, party: 'a' | 'b'): boolean {
    const required = party === 'a' ? current.partyAProvides : current.partyBProvides;
    const records = current.evidence.filter(item => item.party === party);
    const settlements = current.settlements.filter(item => item.party === party);
    const escrows = current.playerEscrows.filter(item => item.party === party);
    return obligationSatisfied(required, records,
        settlements.filter(item => item.status !== 'released').reduce((total, item) => total + item.amountGp, 0)
            + escrows.filter(item => item.status !== 'released').reduce((total, item) => total + item.assets.gp, 0),
        escrows.filter(item => item.status !== 'released').flatMap(item => item.assets.items),
        escrows.length > 0);
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
        this.addColumn('economic_contract', 'resolution', "TEXT NOT NULL DEFAULT 'active'");
        this.addColumn('economic_contract', 'resolution_intent', 'TEXT');
        this.addColumn('economic_contract', 'resolution_note', "TEXT NOT NULL DEFAULT ''");
        this.addColumn('economic_contract', 'resolution_started_at', 'TEXT');
        this.addColumn('economic_contract', 'resolved_at', 'TEXT');
        this.database.run(`UPDATE economic_contract SET resolution = 'fulfilled', resolved_at = fulfilled_at
            WHERE fulfilled_at IS NOT NULL AND resolution = 'active'`);
        this.database.run(`CREATE TABLE IF NOT EXISTS economic_contract_evidence (
            evidence_id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES economic_contract(contract_id),
            party TEXT NOT NULL CHECK (party IN ('a', 'b')), actor_agent_id TEXT NOT NULL,
            run_id TEXT NOT NULL UNIQUE, journal_digest TEXT NOT NULL, matched_gp INTEGER NOT NULL CHECK (matched_gp >= 0),
            matched_items_json TEXT NOT NULL, matched_service INTEGER NOT NULL CHECK (matched_service IN (0, 1)),
            economy_event_ids_json TEXT NOT NULL, recorded_at TEXT NOT NULL,
            UNIQUE (contract_id, party, journal_digest))`);
        this.database.run(`CREATE TABLE IF NOT EXISTS economic_contract_settlement (
            settlement_id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES economic_contract(contract_id),
            party TEXT NOT NULL CHECK (party IN ('a', 'b')), payer_agent_id TEXT NOT NULL,
            payer_kind TEXT NOT NULL CHECK (payer_kind IN ('business', 'faction')), payer_actor_id TEXT NOT NULL,
            payee_agent_id TEXT NOT NULL, payee_username TEXT NOT NULL, amount_gp INTEGER NOT NULL CHECK (amount_gp > 0),
            reservation_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK (status IN ('funded', 'settling', 'committed')),
            error TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, committed_at TEXT,
            UNIQUE (contract_id, party))`);
        this.database.run(`CREATE TABLE IF NOT EXISTS economic_contract_player_escrow (
            escrow_id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES economic_contract(contract_id),
            party TEXT NOT NULL CHECK (party IN ('a', 'b')), payer_agent_id TEXT NOT NULL,
            payer_username TEXT NOT NULL, payee_agent_id TEXT NOT NULL, payee_username TEXT NOT NULL,
            assets_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('funded', 'settling', 'committed')),
            error TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, committed_at TEXT,
            UNIQUE (contract_id, party))`);
        this.addColumn('economic_contract_settlement', 'released_at', 'TEXT');
        this.addColumn('economic_contract_settlement', 'payee_kind', 'TEXT');
        this.addColumn('economic_contract_settlement', 'payee_actor_id', 'TEXT');
        this.addColumn('economic_contract_player_escrow', 'released_at', 'TEXT');
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
        const settlements = (this.database.query(`SELECT * FROM economic_contract_settlement
            WHERE contract_id = ?1 ORDER BY party`).all(row.contract_id) as SettlementRow[]).map(settlement);
        const playerEscrows = (this.database.query(`SELECT * FROM economic_contract_player_escrow
            WHERE contract_id = ?1 ORDER BY party`).all(row.contract_id) as PlayerEscrowRow[]).map(playerEscrow);
        return contract(row, records, settlements, playerEscrows);
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
        now = new Date().toISOString(), contractId: string = randomUUID(),
        settlements: CreateEconomicContractSettlement[] = [],
        playerEscrows: CreateEconomicContractPlayerEscrow[] = []): { offer: EconomicOffer; contract: EconomicContract } {
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
            const parties = new Set<'a' | 'b'>();
            for (const payment of settlements) {
                if (parties.has(payment.party)) throw new Error('Contract settlement party is duplicated');
                parties.add(payment.party);
                const payerAgentId = payment.party === 'a' ? current.creatorAgentId : current.counterpartyAgentId;
                const payeeAgentId = payment.party === 'a' ? current.counterpartyAgentId : current.creatorAgentId;
                const required = payment.party === 'a' ? current.creatorProvides : current.counterpartyProvides;
                if (payment.payerAgentId !== payerAgentId || payment.payeeAgentId !== payeeAgentId
                    || payment.amountGp !== required.gp || required.gp <= 0
                    || !['business', 'faction'].includes(payment.payerKind)
                    || ((payment.payeeUsername === null) === (payment.payeeKind === null))
                    || ((payment.payeeKind === null) !== (payment.payeeActorId === null))
                    || (payment.payeeUsername !== null && !/^[a-z0-9]{1,12}$/.test(payment.payeeUsername))
                    || (payment.payeeKind !== null && !['business', 'faction'].includes(payment.payeeKind))
                    || (payment.payeeActorId !== null && !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(payment.payeeActorId))
                    || !/^[0-9a-f-]{36}$/i.test(payment.settlementId)
                    || !/^[a-z0-9][a-z0-9._-]{2,95}$/.test(payment.reservationId)) {
                    throw new Error('Contract settlement does not match the immutable offer terms');
                }
                this.database.run(`INSERT INTO economic_contract_settlement
                    (settlement_id, contract_id, party, payer_agent_id, payer_kind, payer_actor_id,
                        payee_agent_id, payee_username, payee_kind, payee_actor_id, amount_gp,
                        reservation_id, status, error, created_at, updated_at, committed_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'funded', '', ?13, ?13, NULL)`,
                [payment.settlementId, contractId, payment.party, payment.payerAgentId, payment.payerKind,
                    payment.payerActorId, payment.payeeAgentId, payment.payeeUsername?.toLowerCase() ?? '',
                    payment.payeeKind, payment.payeeActorId, payment.amountGp, payment.reservationId, acceptedAt]);
            }
            for (const held of playerEscrows) {
                if (parties.has(held.party)) throw new Error('Contract funding party is duplicated');
                parties.add(held.party);
                const payerAgentId = held.party === 'a' ? current.creatorAgentId : current.counterpartyAgentId;
                const payeeAgentId = held.party === 'a' ? current.counterpartyAgentId : current.creatorAgentId;
                const required = held.party === 'a' ? current.creatorProvides : current.counterpartyProvides;
                const expectedAssets = { gp: required.gp,
                    items: required.items.map(item => ({ id: item.id, count: item.count })) };
                if (held.payerAgentId !== payerAgentId || held.payeeAgentId !== payeeAgentId
                    || JSON.stringify(held.assets) !== JSON.stringify(expectedAssets)
                    || (held.assets.gp === 0 && held.assets.items.length === 0)
                    || !/^[0-9a-f-]{36}$/i.test(held.escrowId)
                    || !/^[a-z0-9]{1,12}$/.test(held.payerUsername)
                    || !/^[a-z0-9]{1,12}$/.test(held.payeeUsername)) {
                    throw new Error('Contract player escrow does not match the immutable offer terms');
                }
                this.database.run(`INSERT INTO economic_contract_player_escrow
                    (escrow_id, contract_id, party, payer_agent_id, payer_username,
                        payee_agent_id, payee_username, assets_json, status, error,
                        created_at, updated_at, committed_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'funded', '', ?9, ?9, NULL)`,
                [held.escrowId, contractId, held.party, held.payerAgentId, held.payerUsername,
                    held.payeeAgentId, held.payeeUsername, JSON.stringify(held.assets), acceptedAt]);
            }
        });
        transaction.immediate();
        const accepted = this.getOffer(offerId)!;
        return { offer: accepted, contract: this.getContract(accepted.contractId!)! };
    }

    getSettlement(settlementId: string): EconomicContractSettlement | null {
        const row = this.database.query(`SELECT * FROM economic_contract_settlement
            WHERE settlement_id = ?1`).get(settlementId) as SettlementRow | null;
        return row ? settlement(row) : null;
    }

    listReadySettlements(contractId: string): EconomicContractSettlement[] {
        const current = this.getContract(contractId);
        if (!current || current.status !== 'active') return [];
        return current.settlements.filter(item => item.status !== 'committed' && item.status !== 'released'
            && partySecured(current, item.party === 'a' ? 'b' : 'a'));
    }

    startSettlement(settlementId: string, now = new Date().toISOString()): EconomicContractSettlement {
        const current = this.getSettlement(settlementId);
        if (!current) throw new Error('Economic contract settlement does not exist');
        if (current.status === 'committed' || current.status === 'settling') return current;
        if (current.status === 'released') throw new Error('Released contract settlement cannot be started');
        const started = this.database.run(`UPDATE economic_contract_settlement SET status = 'settling', error = '',
            updated_at = ?2 WHERE settlement_id = ?1 AND status = 'funded' AND released_at IS NULL
                AND EXISTS (SELECT 1 FROM economic_contract contract
                    WHERE contract.contract_id = economic_contract_settlement.contract_id
                    AND contract.resolution = 'active' AND contract.resolution_intent IS NULL)`,
        [settlementId, isoTimestamp(now, 'now')]);
        if (started.changes !== 1) throw new Error('Contract stopped before settlement could start');
        return this.getSettlement(settlementId)!;
    }

    noteSettlementFailure(settlementId: string, message: string,
        now = new Date().toISOString()): EconomicContractSettlement {
        const current = this.getSettlement(settlementId);
        if (!current || current.status === 'committed' || current.status === 'released') {
            throw new Error('Contract settlement is not pending');
        }
        this.database.run(`UPDATE economic_contract_settlement SET status = 'settling', error = ?2,
            updated_at = ?3 WHERE settlement_id = ?1 AND status != 'committed'`,
        [settlementId, boundedText(message, 'settlementError', 500), isoTimestamp(now, 'now')]);
        return this.getSettlement(settlementId)!;
    }

    commitSettlement(settlementId: string, now = new Date().toISOString()): EconomicContract {
        const committedAt = isoTimestamp(now, 'now');
        const current = this.getSettlement(settlementId);
        if (!current) throw new Error('Economic contract settlement does not exist');
        if (current.status === 'committed') return this.getContract(current.contractId)!;
        if (current.status === 'released') throw new Error('Released contract settlement cannot be committed');
        const transaction = this.database.transaction(() => {
            const updated = this.database.run(`UPDATE economic_contract_settlement SET status = 'committed',
                error = '', committed_at = ?2, updated_at = ?2
                WHERE settlement_id = ?1 AND status = 'settling' AND released_at IS NULL`, [settlementId, committedAt]);
            if (updated.changes !== 1) throw new Error('Contract settlement changed before commit');
            const contractAfterPayment = this.getContract(current.contractId)!;
            this.database.run(`UPDATE economic_contract SET revision = revision + 1
                WHERE contract_id = ?1 AND fulfilled_at IS NULL`, [current.contractId]);
            if (contractAfterPayment.partyASatisfied && contractAfterPayment.partyBSatisfied) {
                this.database.run(`UPDATE economic_contract SET fulfilled_at = ?2,
                    resolution = 'fulfilled', resolved_at = ?2
                    WHERE contract_id = ?1 AND fulfilled_at IS NULL`, [current.contractId, committedAt]);
            }
        });
        transaction.immediate();
        return this.getContract(current.contractId)!;
    }

    getPlayerEscrow(escrowId: string): EconomicContractPlayerEscrow | null {
        const row = this.database.query(`SELECT * FROM economic_contract_player_escrow
            WHERE escrow_id = ?1`).get(escrowId) as PlayerEscrowRow | null;
        return row ? playerEscrow(row) : null;
    }

    listReadyPlayerEscrows(contractId: string): EconomicContractPlayerEscrow[] {
        const current = this.getContract(contractId);
        if (!current || current.status !== 'active') return [];
        return current.playerEscrows.filter(item => item.status !== 'committed' && item.status !== 'released'
            && partySecured(current, item.party === 'a' ? 'b' : 'a'));
    }

    startPlayerEscrowSettlement(escrowId: string,
        now = new Date().toISOString()): EconomicContractPlayerEscrow {
        const current = this.getPlayerEscrow(escrowId);
        if (!current) throw new Error('Economic contract player escrow does not exist');
        if (current.status === 'committed' || current.status === 'settling') return current;
        if (current.status === 'released') throw new Error('Released contract player escrow cannot be started');
        const started = this.database.run(`UPDATE economic_contract_player_escrow SET status = 'settling', error = '',
            updated_at = ?2 WHERE escrow_id = ?1 AND status = 'funded' AND released_at IS NULL
                AND EXISTS (SELECT 1 FROM economic_contract contract
                    WHERE contract.contract_id = economic_contract_player_escrow.contract_id
                    AND contract.resolution = 'active' AND contract.resolution_intent IS NULL)`,
        [escrowId, isoTimestamp(now, 'now')]);
        if (started.changes !== 1) throw new Error('Contract stopped before player escrow could settle');
        return this.getPlayerEscrow(escrowId)!;
    }

    notePlayerEscrowFailure(escrowId: string, message: string,
        now = new Date().toISOString()): EconomicContractPlayerEscrow {
        const current = this.getPlayerEscrow(escrowId);
        if (!current || current.status === 'committed' || current.status === 'released') {
            throw new Error('Contract player escrow is not pending');
        }
        this.database.run(`UPDATE economic_contract_player_escrow SET status = 'settling', error = ?2,
            updated_at = ?3 WHERE escrow_id = ?1 AND status != 'committed'`,
        [escrowId, boundedText(message, 'escrowError', 500), isoTimestamp(now, 'now')]);
        return this.getPlayerEscrow(escrowId)!;
    }

    commitPlayerEscrow(escrowId: string, now = new Date().toISOString()): EconomicContract {
        const committedAt = isoTimestamp(now, 'now');
        const current = this.getPlayerEscrow(escrowId);
        if (!current) throw new Error('Economic contract player escrow does not exist');
        if (current.status === 'committed') return this.getContract(current.contractId)!;
        if (current.status === 'released') throw new Error('Released contract player escrow cannot be committed');
        const transaction = this.database.transaction(() => {
            const updated = this.database.run(`UPDATE economic_contract_player_escrow SET status = 'committed',
                error = '', committed_at = ?2, updated_at = ?2
                WHERE escrow_id = ?1 AND status = 'settling' AND released_at IS NULL`, [escrowId, committedAt]);
            if (updated.changes !== 1) throw new Error('Contract player escrow changed before commit');
            const contractAfterPayment = this.getContract(current.contractId)!;
            this.database.run(`UPDATE economic_contract SET revision = revision + 1
                WHERE contract_id = ?1 AND fulfilled_at IS NULL`, [current.contractId]);
            if (contractAfterPayment.partyASatisfied && contractAfterPayment.partyBSatisfied) {
                this.database.run(`UPDATE economic_contract SET fulfilled_at = ?2,
                    resolution = 'fulfilled', resolved_at = ?2
                    WHERE contract_id = ?1 AND fulfilled_at IS NULL`, [current.contractId, committedAt]);
            }
        });
        transaction.immediate();
        return this.getContract(current.contractId)!;
    }

    markSettlementReleased(settlementId: string,
        now = new Date().toISOString()): EconomicContractSettlement {
        const current = this.getSettlement(settlementId);
        if (!current) throw new Error('Economic contract settlement does not exist');
        if (current.status === 'released') return current;
        if (current.status !== 'funded') throw new Error('Only unambiguous funded settlement may be released');
        const timestamp = isoTimestamp(now, 'now');
        const updated = this.database.run(`UPDATE economic_contract_settlement SET released_at = ?2,
            error = '', updated_at = ?2 WHERE settlement_id = ?1 AND status = 'funded'
                AND committed_at IS NULL AND released_at IS NULL`, [settlementId, timestamp]);
        if (updated.changes !== 1) throw new Error('Contract settlement changed before release');
        return this.getSettlement(settlementId)!;
    }

    markPlayerEscrowReleased(escrowId: string,
        now = new Date().toISOString()): EconomicContractPlayerEscrow {
        const current = this.getPlayerEscrow(escrowId);
        if (!current) throw new Error('Economic contract player escrow does not exist');
        if (current.status === 'released') return current;
        if (current.status !== 'funded') throw new Error('Only unambiguous funded player escrow may be released');
        const timestamp = isoTimestamp(now, 'now');
        const updated = this.database.run(`UPDATE economic_contract_player_escrow SET released_at = ?2,
            error = '', updated_at = ?2 WHERE escrow_id = ?1 AND status = 'funded'
                AND committed_at IS NULL AND released_at IS NULL`, [escrowId, timestamp]);
        if (updated.changes !== 1) throw new Error('Contract player escrow changed before release');
        return this.getPlayerEscrow(escrowId)!;
    }

    startResolution(contractId: string, resolution: 'cancelled' | 'defaulted',
        expectedRevision: number, note: string, now = new Date().toISOString()): EconomicContract {
        const current = this.getContract(contractId);
        if (!current) throw new Error('Economic contract does not exist');
        const resolutionNote = boundedText(note, 'resolutionNote', 240);
        if (current.status === resolution) {
            if (current.resolutionNote !== resolutionNote) throw new Error('Contract resolution replay changed its reason');
            return current;
        }
        const pendingStatus = resolution === 'cancelled' ? 'cancelling' : 'defaulting';
        if (current.status === pendingStatus) {
            if (current.resolutionNote !== resolutionNote) throw new Error('Contract resolution replay changed its reason');
            return current;
        }
        if (current.revision !== expectedRevision) throw new Error('Contract changed before resolution; refresh and try again');
        if (current.status !== 'active') throw new Error(`Contract cannot enter ${resolution} from ${current.status}`);
        if ([...current.settlements, ...current.playerEscrows].some(item => item.status === 'settling')) {
            throw new Error('Ambiguous settling funds must be retried or reconciled before contract resolution');
        }
        if (resolution === 'cancelled' && (current.evidence.length > 0
            || [...current.settlements, ...current.playerEscrows].some(item => item.status === 'committed'))) {
            throw new Error('Partially performed contract must be defaulted instead of cancelled');
        }
        const timestamp = isoTimestamp(now, 'now');
        const updated = this.database.run(`UPDATE economic_contract SET resolution_intent = ?2,
            resolution_note = ?3, resolution_started_at = ?4, revision = revision + 1
            WHERE contract_id = ?1 AND resolution = 'active' AND resolution_intent IS NULL AND revision = ?5
                AND NOT EXISTS (SELECT 1 FROM economic_contract_settlement payment
                    WHERE payment.contract_id = ?1 AND payment.status = 'settling' AND payment.released_at IS NULL)
                AND NOT EXISTS (SELECT 1 FROM economic_contract_player_escrow held
                    WHERE held.contract_id = ?1 AND held.status = 'settling' AND held.released_at IS NULL)
                AND (?2 = 'defaulted' OR (NOT EXISTS (SELECT 1 FROM economic_contract_evidence evidence
                    WHERE evidence.contract_id = ?1)
                    AND NOT EXISTS (SELECT 1 FROM economic_contract_settlement payment
                        WHERE payment.contract_id = ?1 AND payment.status = 'committed')
                    AND NOT EXISTS (SELECT 1 FROM economic_contract_player_escrow held
                        WHERE held.contract_id = ?1 AND held.status = 'committed')))`,
        [contractId, resolution, resolutionNote, timestamp, expectedRevision]);
        if (updated.changes !== 1) throw new Error('Contract changed before resolution; refresh and try again');
        return this.getContract(contractId)!;
    }

    completeResolution(contractId: string, resolution: 'cancelled' | 'defaulted',
        now = new Date().toISOString()): EconomicContract {
        const current = this.getContract(contractId);
        if (!current) throw new Error('Economic contract does not exist');
        if (current.status === resolution) return current;
        const expectedStatus = resolution === 'cancelled' ? 'cancelling' : 'defaulting';
        if (current.status !== expectedStatus) throw new Error('Contract resolution was not started');
        if ([...current.settlements, ...current.playerEscrows]
            .some(item => item.status !== 'committed' && item.status !== 'released')) {
            throw new Error('Contract still has unresolved funding');
        }
        const timestamp = isoTimestamp(now, 'now');
        const updated = this.database.run(`UPDATE economic_contract SET resolution = ?2,
            resolution_intent = NULL, resolved_at = ?3, revision = revision + 1
            WHERE contract_id = ?1 AND resolution = 'active' AND resolution_intent = ?2`,
        [contractId, resolution, timestamp]);
        if (updated.changes !== 1) throw new Error('Contract changed before resolution completion');
        return this.getContract(contractId)!;
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
        const assetsEscrowed = current.playerEscrows.some(item => item.party === party);
        const relevant = matchedService || (!assetsEscrowed && ((required.gp > 0 && matchedGp > 0)
            || required.items.some(item => (itemTotals.get(item.id)?.count ?? 0) > 0)));
        if (!relevant) throw new Error('Skill run contains no evidence relevant to this party obligation');
        const recordedAt = isoTimestamp(now, 'now');
        const transaction = this.database.transaction(() => {
            const locked = this.getContract(contractId);
            if (!locked || locked.status !== 'active' || locked.revision !== current.revision) {
                throw new Error('Economic contract changed before evidence recording');
            }
            this.database.run(`INSERT INTO economic_contract_evidence (evidence_id, contract_id, party,
                actor_agent_id, run_id, journal_digest, matched_gp, matched_items_json, matched_service,
                economy_event_ids_json, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
            [randomUUID(), contractId, party, actorAgentId, run.runId, journalDigest, matchedGp,
                JSON.stringify(matchedItems), matchedService ? 1 : 0,
                JSON.stringify(trades.map(item => item.id)), recordedAt]);
            const updated = this.getContract(contractId)!;
            if (updated.partyASatisfied && updated.partyBSatisfied) {
                this.database.run(`UPDATE economic_contract SET fulfilled_at = ?2,
                    resolution = 'fulfilled', resolved_at = ?2, revision = revision + 1
                    WHERE contract_id = ?1 AND fulfilled_at IS NULL`,
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
