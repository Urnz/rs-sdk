import type { Database } from 'bun:sqlite';
import { healthDigest } from '../population-health/policy.js';

export type EstateDomain = 'agents' | 'business' | 'contracts' | 'treasury' | 'banking' | 'property' | 'governance' | 'escrow';
export const ESTATE_DOMAINS: EstateDomain[] = ['agents','business','contracts','treasury','banking','property','governance','escrow'];
export interface EstateHold { scope: string; key: string }
export function estateHeld(database: Database, scope: string, key: string): boolean {
    const schema = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='population_estate_hold'");
    let available: boolean; try { available = !!schema.get(); } finally { schema.finalize(); }
    if (!available) return false;
    const query = database.prepare('SELECT 1 FROM population_estate_hold WHERE scope=?1 AND subject_key=?2');
    try { return !!query.get(scope,key); } finally { query.finalize(); }
}
export function installEstateSourceSchema(database: Database): void {
    database.run(`CREATE TABLE IF NOT EXISTS population_estate_source_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL)`);
    database.run('INSERT OR IGNORE INTO population_estate_source_schema VALUES(1,1)');
    const version = database.query('SELECT version FROM population_estate_source_schema WHERE singleton=1').get() as { version: number };
    if (version.version !== 1) throw new Error('Unsupported estate source schema');
    database.run(`CREATE TABLE IF NOT EXISTS population_estate_hold(scope TEXT NOT NULL,subject_key TEXT NOT NULL,
        estate_id TEXT NOT NULL,death_digest TEXT NOT NULL,PRIMARY KEY(scope,subject_key,estate_id))`);
    database.run(`CREATE TABLE IF NOT EXISTS population_estate_receipt(estate_id TEXT NOT NULL,domain TEXT NOT NULL,
        receipt_json TEXT NOT NULL,receipt_digest TEXT NOT NULL,PRIMARY KEY(estate_id,domain))`);
    database.run(`CREATE TABLE IF NOT EXISTS population_estate_write_permit(singleton INTEGER PRIMARY KEY CHECK(singleton=1),estate_id TEXT NOT NULL)`);
    if (database.query('SELECT 1 FROM population_estate_write_permit').get()) throw new Error('Estate write permit persisted outside its transaction');
}
interface Guard { table: string; expression: (prefix: 'OLD' | 'NEW') => string; insert?: boolean; update?: boolean; delete?: boolean }
const hold = (scope: string, expression: string) => `EXISTS(SELECT 1 FROM population_estate_hold WHERE scope='${scope}' AND subject_key=${expression})`;
const actor = (prefix: string, kind: string, id: string) => hold('actor', `${prefix}.${kind}||':'||${prefix}.${id}`);
const guards: Record<EstateDomain, Guard[]> = {
    agents: [
        { table: 'agent_economic_actor_link', expression: p => `${hold('agent', `${p}.agent_id`)} OR ${actor(p,'actor_kind','actor_id')}`, insert: true },
        { table: 'agent_commitment', expression: p => `${hold('agent', `${p}.agent_id`)} OR ${hold('agent-key', `${p}.actor_key`)}`, insert: true },
        { table: 'agent_relationship', insert: true, expression: p => `${hold('agent', `${p}.agent_id`)} OR ${hold('agent-key', `${p}.actor_key`)}` },
        { table: 'agent_player_action_request', expression: p => `${hold('agent', `${p}.requester_agent_id`)} OR ${hold('agent', `${p}.assignee_agent_id`)}`, insert: true }
    ],
    business: [
        { table: 'business', expression: p => `${hold('business', `${p}.business_id`)} OR ${hold('agent', `${p}.owner_agent_id`)}`, insert: true },
        { table: 'business_employment', expression: p => `${hold('agent', `${p}.worker_agent_id`)} OR ${hold('business', `${p}.business_id`)}`, insert: true },
        { table: 'business_inventory', expression: p => hold('business', `${p}.business_id`), insert: true },
        { table: 'business_policy_proposal', expression: p => `${hold('business', `${p}.business_id`)} OR ${hold('agent', `${p}.proposer_agent_id`)}`, insert: true }
    ],
    contracts: [
        { table: 'economic_offer', expression: p => `${hold('agent', `${p}.creator_agent_id`)} OR ${hold('agent', `${p}.counterparty_agent_id`)}`, insert: true },
        { table: 'economic_contract', expression: p => `${hold('contract', `${p}.contract_id`)} OR ${hold('agent', `${p}.party_a_agent_id`)} OR ${hold('agent', `${p}.party_b_agent_id`)}`, insert: true },
        ...['economic_contract_evidence','economic_contract_settlement','economic_contract_player_escrow'].map(table =>
            ({ table, expression: (p: 'OLD' | 'NEW') => hold('contract', `${p}.contract_id`), insert: true }))
    ],
    treasury: [
        { table: 'institution_treasury', expression: p => actor(p,'actor_kind','actor_id'), insert: true },
        { table: 'institution_treasury_reservation', expression: p => `${actor(p,'actor_kind','actor_id')} OR ${hold('reservation', `${p}.reservation_id`)}`, insert: true }
    ],
    banking: [
        { table: 'bank_loan', expression: p => `${hold('loan', `${p}.loan_id`)} OR ${actor(p,'borrower_kind','borrower_actor_id')} OR ${hold('actor', `'business:'||${p}.bank_treasury_actor_id`)}`, insert: true },
        { table: 'bank_deposit_account', expression: p => actor(p,'owner_kind','owner_actor_id'), insert: true },
        { table: 'bank_loan_collateral', expression: p => hold('loan', `${p}.loan_id`), insert: true },
        { table: 'economic_bank', expression: p => hold('actor', `'business:'||${p}.treasury_actor_id`), insert: true },
        { table: 'institution_domain_settlement', expression: p => `${actor(p,'payer_kind','payer_actor_id')} OR ${actor(p,'payee_kind','payee_actor_id')}`, insert: true }
    ],
    property: [
        { table: 'property_state', expression: p => p === 'NEW' ? actor(p,'owner_kind','owner_id')
            : `${hold('property', `${p}.property_id`)} OR ${actor(p,'owner_kind','owner_id')}`, insert: true },
        { table: 'property_purchase', expression: p => `${hold('property', `${p}.property_id`)} OR ${actor(p,'buyer_kind','buyer_id')}`, insert: true },
        { table: 'property_transfer', expression: p => `${hold('property', `${p}.property_id`)} OR ${actor(p,'from_kind','from_id')} OR ${actor(p,'to_kind','to_id')}`, insert: true },
        { table: 'property_genesis_assignment', expression: p => `${hold('property', `${p}.property_id`)} OR ${actor(p,'owner_kind','owner_id')}`, insert: true }
    ],
    governance: [
        { table: 'governance_obligation', expression: p => `${hold('obligation', `${p}.obligation_id`)} OR ${actor(p,'debtor_kind','debtor_id')} OR ${actor(p,'creditor_kind','creditor_id')}`, insert: true },
        { table: 'governance_obligation_resolution', expression: p => hold('obligation', `${p}.obligation_id`), insert: true },
        { table: 'governance_exemption', expression: p => hold('agent', `${p}.created_by_agent_id`), insert: true }
    ],
    escrow: [
        { table: 'player_inventory_escrow', expression: p => `${hold('username', `${p}.username`)} OR ${hold('username', `${p}.payee_username`)} OR ${hold('escrow', `${p}.escrow_id`)}`, insert: true }
    ]
};
export function installEstateGuards(database: Database, domain: EstateDomain): void {
    database.transaction(() => {
        installEstateSourceSchema(database);
        for (const guard of guards[domain]) {
        if (!database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1").get(guard.table)) continue;
        for (const operation of ['INSERT','UPDATE','DELETE'] as const) {
            if (operation === 'INSERT' && !guard.insert) continue;
            const prefix = operation === 'INSERT' ? 'NEW' : 'OLD';
            const held = operation === 'UPDATE' ? `${guard.expression('OLD')} OR ${guard.expression('NEW')}` : guard.expression(prefix);
            const condition = `(${held}) AND NOT EXISTS(SELECT 1 FROM population_estate_write_permit)`;
            database.run(`CREATE TRIGGER IF NOT EXISTS estate_guard_${guard.table}_${operation.toLowerCase()}
                BEFORE ${operation} ON ${guard.table} WHEN ${condition}
                BEGIN SELECT RAISE(ABORT,'Estate custody forbids ordinary economic mutation'); END`);
        }
        }
    }).immediate();
}
export function putEstateHolds(database: Database, estateId: string, deathDigest: string, holds: EstateHold[]): void {
    for (const item of holds) {
        database.run('INSERT OR IGNORE INTO population_estate_hold VALUES(?1,?2,?3,?4)', [item.scope,item.key,estateId,deathDigest]);
        const row = database.query('SELECT death_digest FROM population_estate_hold WHERE scope=?1 AND subject_key=?2 AND estate_id=?3')
            .get(item.scope,item.key,estateId) as { death_digest: string };
        if (row.death_digest !== deathDigest) throw new Error('Estate custody binding conflicts');
    }
}
export function estateSourceDigest(value: unknown): string { return healthDigest(value); }
