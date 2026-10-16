import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { healthDigest } from '../population-health/policy.js';
import { VerifiedEstateDeath, assertVerifiedEstateDeath } from './authority.js';
import type { EstatePolicy } from './policy.js';
import { installEstateGuards, putEstateHolds, type EstateDomain, type EstateHold } from './schema.js';
import type { InheritancePlan } from './inheritance-policy.js';
import { verifyInheritanceTransfers } from './inheritance-transfer.js';

type Row = Record<string, string | number | null>;
export interface EstateClaim { table: string; disposition: string; facts: Row }
interface Effect { table: string; keyColumn: string; key: string; expected: Row }
interface SealedSourceRow { table: string; key: Row; digest: string | null }
export interface EstateSourceReceipt {
    schemaVersion: 1; estateId: string; domain: EstateDomain; deathDigest: string; policyDigest: string;
    claims: EstateClaim[]; holds: EstateHold[]; effects: Effect[]; sealedRows: SealedSourceRow[]; blockers: string[]; admittedAt: string;
}
export interface EstateSourceContext { ownedBusinessIds: string[]; affectedContractAgentIds: string[]; reservationIds: string[]; escrowIds: string[] }
const verifiedContexts = new WeakMap<object,string>();
function verifyContext(authority: VerifiedEstateDeath, context: EstateSourceContext): void {
    if (verifiedContexts.get(context) !== authority.estateId) throw new Error('Unverified estate source context');
}
const required: Record<EstateDomain, string[]> = {
    agents: ['agent_population_death','agent_character_lifecycle','agent_economic_actor_link','agent_relationship','agent_commitment','agent_player_action_request'],
    business: ['business','business_employment','business_policy_proposal','business_inventory'],
    contracts: ['economic_offer','economic_contract','economic_contract_evidence','economic_contract_settlement','economic_contract_player_escrow'],
    treasury: ['institution_treasury','institution_treasury_reservation'],
    banking: ['bank_loan','bank_deposit_account','bank_loan_collateral','economic_bank','institution_domain_settlement'],
    property: ['property_state','property_purchase'], governance: ['governance_obligation','governance_obligation_resolution'],
    escrow: ['player_inventory_escrow','player_inventory_escrow_audit','player_escrow_authority']
};
const tables = new Set(Object.values(required).flat());
function queryRows(db: Database, table: string): Row[] {
    if (!tables.has(table)) throw new Error('Unknown estate source table');
    return db.query(`SELECT * FROM ${table}`).all() as Row[];
}
function matchingActor(row: Row, kind: string, id: string, authority: VerifiedEstateDeath, context: EstateSourceContext): boolean {
    return row[kind] === 'player' && row[id] === authority.death.playerUsername
        || row[kind] === 'business' && context.ownedBusinessIds.includes(String(row[id]));
}
export function inspectEstateContext(agentPath: string, businessPath: string, contractsPath: string,
    authority: VerifiedEstateDeath): EstateSourceContext {
    assertVerifiedEstateDeath(authority);
    const context: EstateSourceContext = { ownedBusinessIds: [], affectedContractAgentIds: [authority.death.agentId], reservationIds: [], escrowIds: [] };
    if (!existsSync(businessPath)) throw new Error('Business ownership source is unavailable');
    const business = new Database(businessPath, { readonly: true, strict: true });
    try { context.ownedBusinessIds = business.query('SELECT business_id FROM business WHERE owner_agent_id=?1 ORDER BY business_id')
        .all(authority.death.agentId).map(row => String((row as Row).business_id)); }
    finally { business.close(true); }
    const agents = new Database(agentPath, { readonly: true, strict: true });
    try { for (const row of agents.query("SELECT agent_id,subject_id FROM agent_control_profile WHERE subject_kind='business'").all() as Row[])
        if (context.ownedBusinessIds.includes(String(row.subject_id))) context.affectedContractAgentIds.push(String(row.agent_id)); }
    finally { agents.close(true); }
    if (!existsSync(contractsPath)) throw new Error('Contract funding source is unavailable');
    const contracts = new Database(contractsPath, { readonly: true, strict: true });
    try { for (const row of queryRows(contracts,'economic_contract_settlement'))
        if (context.affectedContractAgentIds.includes(String(row.payer_agent_id)) || context.affectedContractAgentIds.includes(String(row.payee_agent_id)))
            context.reservationIds.push(String(row.reservation_id));
        for (const row of queryRows(contracts,'economic_contract_player_escrow'))
            if (context.affectedContractAgentIds.includes(String(row.payer_agent_id)) || context.affectedContractAgentIds.includes(String(row.payee_agent_id)))
                context.escrowIds.push(String(row.escrow_id)); }
    finally { contracts.close(true); }
    for (const values of Object.values(context)) Object.freeze(values);
    Object.freeze(context); verifiedContexts.set(context,authority.estateId); return context;
}

export class EstateSource {
    private readonly db: Database;
    private readonly statements = new Set<{ finalize(): void }>();
    constructor(readonly path: string, readonly domain: EstateDomain) {
        if (!existsSync(path)) throw new Error(`${domain}: authoritative source is unavailable`);
        this.db = new Database(path, { strict: true });
        this.db.query = new Proxy(this.db.query,{apply:(target,receiver,args)=>{
            const statement = Reflect.apply(target,receiver,args); this.statements.add(statement); return statement;
        }});
        try {
            for (const table of required[domain]) if (!this.db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1").get(table))
                throw new Error(`${domain}: required source table ${table} is missing`);
            const checks = this.db.query('PRAGMA quick_check').all() as { quick_check: string }[];
            if (checks.length !== 1 || checks[0]!.quick_check !== 'ok' || this.db.query('PRAGMA foreign_key_check').all().length)
                throw new Error(`${domain}: economic source integrity is invalid`);
            installEstateGuards(this.db, domain);
        } catch (error) { this.close(); throw error; }
    }
    close(): void { for (const statement of this.statements) statement.finalize(); this.statements.clear(); this.db.close(true); }
    inheritanceCompleted(receipt: EstateSourceReceipt, plan: InheritancePlan): boolean {
        if (this.domain !== 'property') throw new Error('Inheritance requires Property source');
        return verifyInheritanceTransfers(this.db,receipt,plan).size === plan.assets.length;
    }
    private basicHolds(authority: VerifiedEstateDeath, context: EstateSourceContext): EstateHold[] {
        const holds: EstateHold[] = [{ scope: 'agent', key: authority.death.agentId }, { scope: 'agent-key', key: authority.death.agentId },
            { scope: 'agent-key', key: authority.death.playerUsername }, { scope: 'username', key: authority.death.playerUsername },
            { scope: 'agent-key', key: `agent:${authority.death.agentId}` }, { scope: 'agent-key', key: `player:${authority.death.playerUsername}` },
            { scope: 'actor', key: `player:${authority.death.playerUsername}` }];
        for (const id of context.ownedBusinessIds) holds.push({ scope: 'business', key: id }, { scope: 'actor', key: `business:${id}` });
        if (this.domain === 'contracts' || this.domain === 'agents') for (const id of context.affectedContractAgentIds) holds.push({ scope: 'agent', key: id });
        if (this.domain === 'treasury') for (const id of context.reservationIds) holds.push({ scope: 'reservation', key: id });
        if (this.domain === 'escrow') for (const id of context.escrowIds) holds.push({ scope: 'escrow', key: id });
        return holds;
    }
    freeze(authority: VerifiedEstateDeath, context?: EstateSourceContext): void {
        assertVerifiedEstateDeath(authority);
        if (context) verifyContext(authority,context);
        context ??= { ownedBusinessIds: [], affectedContractAgentIds: [authority.death.agentId], reservationIds: [], escrowIds: [] };
        const scope = context;
        this.db.transaction(() => {
            const context = scope, holds = this.basicHolds(authority, context);
            if (this.domain === 'contracts') for (const row of queryRows(this.db,'economic_contract'))
                if (context.affectedContractAgentIds.includes(String(row.party_a_agent_id)) || context.affectedContractAgentIds.includes(String(row.party_b_agent_id)))
                    holds.push({ scope: 'contract', key: String(row.contract_id) });
            if (this.domain === 'property') {
                for (const row of queryRows(this.db,'property_state')) if (matchingActor(row,'owner_kind','owner_id',authority,context))
                    holds.push({ scope: 'property', key: String(row.property_id) });
                for (const row of queryRows(this.db,'property_purchase')) if (row.status === 'pending' && matchingActor(row,'buyer_kind','buyer_id',authority,context))
                    holds.push({ scope: 'property', key: String(row.property_id) });
            }
            if (this.domain === 'banking') for (const row of queryRows(this.db,'bank_loan'))
                if (matchingActor(row,'borrower_kind','borrower_actor_id',authority,context) || context.ownedBusinessIds.includes(String(row.bank_treasury_actor_id)))
                    holds.push({ scope: 'loan', key: String(row.loan_id) });
            if (this.domain === 'governance') for (const row of queryRows(this.db,'governance_obligation'))
                if (matchingActor(row,'debtor_kind','debtor_id',authority,context) || matchingActor(row,'creditor_kind','creditor_id',authority,context))
                    holds.push({ scope: 'obligation', key: String(row.obligation_id) });
            putEstateHolds(this.db, authority.estateId, authority.death.eventDigest, holds);
        }).immediate();
    }
    private effect(effects: Effect[], table: string, keyColumn: string, key: string, expected: Row): void {
        if (!tables.has(table) || !/^[a-z_]+$/.test(keyColumn) || Object.keys(expected).some(key => !/^[a-z_]+$/.test(key))) throw new Error('Unknown estate effect');
        const keys = Object.keys(expected);
        const result = this.db.run(`UPDATE ${table} SET ${keys.map((key,index) => `${key}=?${index + 2}`).join(',')}
            WHERE ${keyColumn}=?1`, [key,...keys.map(key => expected[key]!)]);
        if (result.changes !== 1) throw new Error('Estate source changed during custody');
        effects.push({ table,keyColumn,key,expected });
    }
    private verifyReceipt(receipt: EstateSourceReceipt, plan?: InheritancePlan): void {
        const inherited = receipt.domain === 'property' ? verifyInheritanceTransfers(this.db,receipt,plan) : new Set<string>();
        for (const item of receipt.holds) {
            if (item.scope === 'property' && inherited.has(item.key)) continue;
            const hold = this.db.query('SELECT death_digest FROM population_estate_hold WHERE scope=?1 AND subject_key=?2 AND estate_id=?3')
                .get(item.scope,item.key,receipt.estateId) as Row | null;
            if (!hold || hold.death_digest !== receipt.deathDigest) throw new Error('Estate source custody hold disappeared');
        }
        for (const item of receipt.effects) {
            if (item.table === 'property_state' && inherited.has(item.key)) continue;
            if (!tables.has(item.table) || !/^[a-z_]+$/.test(item.keyColumn)) throw new Error('Estate receipt effect key is invalid');
            const row = this.db.query(`SELECT * FROM ${item.table} WHERE ${item.keyColumn}=?1`).get(item.key) as Row | null;
            if (!row || Object.entries(item.expected).some(([key,value]) => row[key] !== value)) throw new Error('Estate source custody effect changed');
        }
        for (const item of receipt.sealedRows) {
            if (item.table === 'property_state' && inherited.has(String(item.key.property_id))) continue;
            if (!tables.has(item.table) || !Object.keys(item.key).length || Object.keys(item.key).some(key => !/^[a-z_]+$/.test(key)))
                throw new Error('Estate sealed source key is invalid');
            const keys = Object.keys(item.key), row = this.db.query(`SELECT * FROM ${item.table} WHERE ${keys.map((key,index) => `${key}=?${index + 1}`).join(' AND ')}`)
                .get(...keys.map(key => item.key[key]!)) as Row | null;
            if ((row ? healthDigest(row) : null) !== item.digest) throw new Error('Estate economic source changed after custody');
        }
        if (receipt.domain === 'agents') {
            const grants = this.db.query("SELECT 1 FROM agent_economic_actor_link WHERE agent_id=?1 AND role<>'self'").get(receipt.claims
                .find(item => item.table === 'agent_character_lifecycle')?.facts.agent_id ?? '');
            if (grants) throw new Error('Deceased treasury authority was restored');
        }
    }
    apply(authority: VerifiedEstateDeath, context: EstateSourceContext, policy: EstatePolicy, now: string, plan?: InheritancePlan): { receipt: EstateSourceReceipt; digest: string } {
        assertVerifiedEstateDeath(authority); verifyContext(authority,context); let answer!: { receipt: EstateSourceReceipt; digest: string };
        this.db.transaction(() => {
            const existing = this.db.query('SELECT * FROM population_estate_receipt WHERE estate_id=?1 AND domain=?2')
                .get(authority.estateId,this.domain) as Row | null;
            if (existing) {
                const receipt = JSON.parse(String(existing.receipt_json)) as EstateSourceReceipt;
                if (healthDigest(receipt) !== existing.receipt_digest || receipt.deathDigest !== authority.death.eventDigest
                    || receipt.policyDigest !== policy.digest || receipt.estateId !== authority.estateId || receipt.domain !== this.domain)
                    throw new Error('Estate source receipt conflicts');
                this.verifyReceipt(receipt,plan); if (this.domain === 'escrow') this.verifyEscrowAudit();
                answer = { receipt, digest: String(existing.receipt_digest) }; return;
            }
            this.db.run('INSERT INTO population_estate_write_permit VALUES(1,?1)', [authority.estateId]);
            const claims: EstateClaim[] = [], holds = this.basicHolds(authority, context), effects: Effect[] = [], blockers: string[] = [];
            const collect = (table: string, disposition: string, predicate: (row: Row) => boolean) => {
                const rows = queryRows(this.db, table).filter(predicate);
                if (rows.length + claims.length > policy.maximumRowsPerSource) throw new Error('Estate source row budget exceeded');
                for (const facts of rows) claims.push({ table, disposition, facts: structuredClone(facts) });
                return rows;
            };
            const agent = authority.death.agentId, username = authority.death.playerUsername;
            if (this.domain === 'agents') {
                collect('agent_character_lifecycle','terminal-identity', row => row.agent_id === agent);
                collect('agent_economic_actor_link','authority-revoked', row => row.agent_id === agent && row.role !== 'self');
                const actorKeys = [agent,username,`agent:${agent}`,`player:${username}`,...context.ownedBusinessIds.map(id=>`business:${id}`)];
                collect('agent_relationship','reported-claim-not-added-to-contract-total', row => context.affectedContractAgentIds.includes(String(row.agent_id)) || actorKeys.includes(String(row.actor_key)));
                collect('agent_commitment','obligation-in-estate-custody', row => row.status === 'open' && (context.affectedContractAgentIds.includes(String(row.agent_id)) || actorKeys.includes(String(row.actor_key))));
                for (const key of actorKeys) holds.push({scope:'agent-key',key});
                for (const row of collect('agent_player_action_request','work-reward-claim', row => context.affectedContractAgentIds.includes(String(row.requester_agent_id)) || row.assignee_agent_id === agent)) {
                    if (['pending','accepted','approved'].includes(String(row.status))) this.effect(effects,'agent_player_action_request','request_id',String(row.request_id),
                        { status: 'cancelled', resolved_at: now, updated_at: now, revision: Number(row.revision) + 1 });
                    else if (['running','settling'].includes(String(row.status))) blockers.push(`agents: ambiguous player work ${row.request_id}`);
                }
                this.db.run("DELETE FROM agent_economic_actor_link WHERE agent_id=?1 AND role<>'self'", [agent]);
            } else if (this.domain === 'business') {
                for (const row of collect('business','business-ownership-custody-separate-legal-person', row => row.owner_agent_id === agent)) {
                    if (row.status === 'active') this.effect(effects,'business','business_id',String(row.business_id),
                        { status: 'dormant', updated_at: now, revision: Number(row.revision) + 1 });
                }
                for (const row of collect('business_employment','role-ended-no-unearned-wage-created', row => row.worker_agent_id === agent)) {
                    if (row.status === 'active') this.effect(effects,'business_employment','employment_id',String(row.employment_id),
                        { status: 'ended', ended_at: now, updated_at: now, revision: Number(row.revision) + 1 });
                }
                collect('business_inventory','institutional-inventory-retained', row => context.ownedBusinessIds.includes(String(row.business_id)));
                collect('business_policy_proposal','policy-authority-suspended', row => context.ownedBusinessIds.includes(String(row.business_id)) || row.proposer_agent_id === agent);
            } else if (this.domain === 'contracts') {
                const parties = context.affectedContractAgentIds;
                for (const row of collect('economic_offer','offer-closed', row => parties.includes(String(row.creator_agent_id)) || parties.includes(String(row.counterparty_agent_id)))) {
                    if (row.status === 'open') this.effect(effects,'economic_offer','offer_id',String(row.offer_id),
                        { status: 'withdrawn', response_note: `Estate custody ${authority.estateId}`, updated_at: now, revision: Number(row.revision) + 1 });
                }
                const contracts = collect('economic_contract','performance-closed-obligations-retained', row => parties.includes(String(row.party_a_agent_id)) || parties.includes(String(row.party_b_agent_id)));
                const ids = contracts.filter(row => row.resolution === 'active').map(row => String(row.contract_id));
                for (const id of ids) holds.push({ scope: 'contract', key: id });
                for (const table of ['economic_contract_evidence','economic_contract_settlement','economic_contract_player_escrow'])
                    for (const row of collect(table,'funding-and-earned-claims-retained', row => contracts.some(contract => contract.contract_id === row.contract_id)))
                        if (row.status === 'settling' && row.released_at === null) blockers.push(`contracts: ambiguous settlement ${row.settlement_id ?? row.escrow_id}`);
            } else if (this.domain === 'treasury') {
                collect('institution_treasury','institutional-money-not-personal-inheritance', row => row.actor_kind === 'business' && context.ownedBusinessIds.includes(String(row.actor_id)));
                collect('institution_treasury_reservation','reservation-retained-not-refunded-or-paid', row => row.actor_kind === 'business' && context.ownedBusinessIds.includes(String(row.actor_id))
                    || context.reservationIds.includes(String(row.reservation_id)));
            } else if (this.domain === 'banking') {
                const loans = collect('bank_loan','institutional-loan-preserved-not-personal-debt', row => matchingActor(row,'borrower_kind','borrower_actor_id',authority,context)
                    || context.ownedBusinessIds.includes(String(row.bank_treasury_actor_id)));
                for (const row of loans) holds.push({ scope: 'loan', key: String(row.loan_id) });
                collect('bank_loan_collateral','collateral-encumbrance-retained', row => loans.some(loan => loan.loan_id === row.loan_id));
                collect('bank_deposit_account','institutional-deposit-preserved', row => matchingActor(row,'owner_kind','owner_actor_id',authority,context));
                collect('economic_bank','bank-ownership-custody', row => context.ownedBusinessIds.includes(String(row.treasury_actor_id)));
                for (const row of collect('institution_domain_settlement','institutional-settlement-receipt', row => matchingActor(row,'payer_kind','payer_actor_id',authority,context)
                    || matchingActor(row,'payee_kind','payee_actor_id',authority,context)))
                    if (row.status === 'settling') blockers.push(`banking: ambiguous institution settlement ${row.settlement_id}`);
            } else if (this.domain === 'property') {
                for (const row of collect('property_state','title-in-estate-custody-original-owner-preserved', row => matchingActor(row,'owner_kind','owner_id',authority,context))) {
                    holds.push({ scope: 'property', key: String(row.property_id) });
                    if (row.status === 'owned') this.effect(effects,'property_state','property_id',String(row.property_id),
                        { status: 'locked', updated_at: now, version: Number(row.version) + 1 });
                }
                for (const row of collect('property_purchase','purchase-proof-retained', row => matchingActor(row,'buyer_kind','buyer_id',authority,context))) {
                    if (row.status === 'pending') { holds.push({ scope: 'property', key: String(row.property_id) });
                        blockers.push(`property: ambiguous pending purchase ${row.transaction_id}`); }
                }
            } else if (this.domain === 'governance') {
                const obligations = collect('governance_obligation','authoritative-debt-or-receivable-retained', row => matchingActor(row,'debtor_kind','debtor_id',authority,context)
                    || matchingActor(row,'creditor_kind','creditor_id',authority,context));
                for (const row of obligations) holds.push({ scope: 'obligation', key: String(row.obligation_id) });
                collect('governance_obligation_resolution','previous-legal-resolution-retained', row => obligations.some(obligation => obligation.obligation_id === row.obligation_id));
            } else {
                const escrow = collect('player_inventory_escrow','engine-escrow-custody-no-wallet-mutation', row => row.username === username || row.payee_username === username
                    || context.escrowIds.includes(String(row.escrow_id)));
                for (const row of escrow) if (['pending','releasing','reconcile'].includes(String(row.status))
                    || row.commit_started_at !== null && row.committed_at === null) blockers.push(`escrow: ambiguous engine escrow ${row.escrow_id}`);
                this.verifyEscrowAudit();
            }
            putEstateHolds(this.db, authority.estateId, authority.death.eventDigest, holds);
            const sealedRows: SealedSourceRow[] = claims.map(claim => {
                const columns = this.db.query(`PRAGMA table_info(${claim.table})`).all() as Array<{ name: string; pk: number }>;
                const keys = columns.filter(column => column.pk).sort((a,b) => a.pk - b.pk).map(column => column.name);
                if (!keys.length) throw new Error('Estate source requires an immutable primary key');
                const key = Object.fromEntries(keys.map(key => [key,claim.facts[key]!])) as Row;
                const row = this.db.query(`SELECT * FROM ${claim.table} WHERE ${keys.map((key,index) => `${key}=?${index + 1}`).join(' AND ')}`)
                    .get(...keys.map(key => claim.facts[key]!)) as Row | null;
                return { table: claim.table, key, digest: row ? healthDigest(row) : null };
            });
            const receipt: EstateSourceReceipt = { schemaVersion: 1, estateId: authority.estateId, domain: this.domain,
                deathDigest: authority.death.eventDigest, policyDigest: policy.digest, claims, holds, effects, sealedRows, blockers, admittedAt: now };
            const digest = healthDigest(receipt);
            this.db.run('INSERT INTO population_estate_receipt VALUES(?1,?2,?3,?4)', [authority.estateId,this.domain,JSON.stringify(receipt),digest]);
            this.verifyReceipt(receipt); answer = { receipt, digest };
            this.db.run('DELETE FROM population_estate_write_permit');
        }).immediate();
        return answer;
    }
    private verifyEscrowAudit(): void {
        const marker = this.db.query('SELECT * FROM player_escrow_authority').all() as Row[];
        if (marker.length !== 1 || ![1,2].includes(Number(marker[0]!.schema_version))) throw new Error('Shared player escrow authority is invalid');
        const rows = this.db.query('SELECT * FROM player_inventory_escrow').all() as Row[];
        const audit = this.db.query('SELECT * FROM player_inventory_escrow_audit ORDER BY sequence').all() as Row[];
        const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
        const authority = marker[0]!;
        const facts = authority.schema_version === 1 ? { schema_version: 1, legacy_baseline_count: authority.legacy_baseline_count, created_at: authority.created_at }
            : { schema_version: 2, legacy_baseline_count: authority.legacy_baseline_count,
                legacy_archive_digest: authority.legacy_archive_digest, created_at: authority.created_at };
        if (hash(facts) !== authority.digest || authority.schema_version === 1 && authority.legacy_baseline_count !== 0)
            throw new Error('Shared player escrow authority digest is invalid');
        if (authority.schema_version === 2) {
            const archive = this.db.query('SELECT sequence,record_json,record_digest FROM player_escrow_legacy_archive ORDER BY sequence').all() as Row[];
            if (archive.length !== authority.legacy_baseline_count || archive.some((row,index) => row.sequence !== index + 1
                || createHash('sha256').update(String(row.record_json)).digest('hex') !== row.record_digest)
                || hash(archive.map(row => row.record_json)) !== authority.legacy_archive_digest) throw new Error('Shared escrow legacy archive is invalid');
        }
        let previous = '0'.repeat(64); const latest = new Map<string,string>();
        for (const entry of audit) {
            const expected = hash({ previous, payload: { escrowId: entry.escrow_id, operation: entry.operation,
                rowDigest: entry.row_digest, occurredAt: entry.occurred_at } });
            if (entry.previous_hash !== previous || entry.entry_hash !== expected) throw new Error('Shared escrow estate audit is invalid');
            previous = String(entry.entry_hash); latest.set(String(entry.escrow_id),String(entry.row_digest));
        }
        for (const row of rows) {
            const digest = hash(Object.entries(row).sort(([left],[right]) => left.localeCompare(right)));
            if (latest.get(String(row.escrow_id)) !== digest) throw new Error('Engine escrow has no matching immutable audit');
        }
        if (latest.size !== rows.length) throw new Error('Shared escrow audit rows are missing');
    }
}
