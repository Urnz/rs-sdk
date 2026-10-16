import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { AgentStateStore } from '../agent-state/store.js';
import { healthTime, healthDigest } from '../population-health/policy.js';
import { VerifiedEstateDeath } from './authority.js';
import { ESTATE_DOMAINS, type EstateDomain } from './schema.js';
import { validateEstatePolicy, type EstatePolicy } from './policy.js';
import { EstateSource, inspectEstateContext, type EstateSourceContext, type EstateSourceReceipt } from './source.js';
import { PopulationEstateStore, type EstateCase } from './store.js';
export interface EstateRuntimeOptions { statePath: string; engineDeathPath: string; policy: EstatePolicy; sources: Record<EstateDomain, string> }
export function runPopulationEstateCycle(options: EstateRuntimeOptions, now = new Date().toISOString(),
    afterSourceCommit?: (domain: EstateDomain) => void): { cases: EstateCase[]; authorityErrors: string[] } {
    healthTime(now); const { digest, ...definition } = options.policy, policy = validateEstatePolicy(definition);
    if (policy.digest !== digest) throw new Error('Estate policy digest conflicts');
    const sources = Object.fromEntries(ESTATE_DOMAINS.map(domain => [domain,resolve(options.sources[domain])])) as Record<EstateDomain,string>;
    if (!existsSync(sources.agents)) throw new Error('Estate AgentState authority is unavailable');
    const store = new PopulationEstateStore(options.statePath), agents = new AgentStateStore(sources.agents);
    const authorityErrors: string[] = [];
    try {
        for (const member of agents.listPopulationMembers()) {
            if (member.characterLifecycle.status !== 'deceased') continue;
            let authority: VerifiedEstateDeath;
            try { authority = VerifiedEstateDeath.load(sources.agents,options.engineDeathPath,member.agentId); }
            catch (error) {
                const reason = `${member.agentId}: ${String(error)}`; authorityErrors.push(reason);
                const existing = store.list().find(current => current.agentId === member.agentId);
                if (existing) store.finish(existing.estateId,policy,[`death-authority: ${reason}`],now < existing.updatedAt ? existing.updatedAt : now);
                continue;
            }
            store.open(authority,policy,sources,now);
            const inheritancePlan = store.get(authority.estateId)?.inheritance?.plan;
            const blockers: string[] = [], opened = new Map<EstateDomain,EstateSource>(), receipts = new Map<EstateDomain,EstateSourceReceipt>();
            let context: EstateSourceContext = { ownedBusinessIds: [], affectedContractAgentIds: [member.agentId], reservationIds: [], escrowIds: [] };
            let contextReady = true;
            try { context = inspectEstateContext(sources.agents,sources.business,sources.contracts,authority); }
            catch (error) { contextReady = false; blockers.push(`source-context: ${String(error)}`); }
            try {
                // Persistent barriers precede source mutations, so interrupted/rejected stages stay closed.
                for (const domain of ESTATE_DOMAINS) {
                    try { const source = new EstateSource(sources[domain],domain); opened.set(domain,source); source.freeze(authority,contextReady ? context : undefined); }
                    catch (error) { blockers.push(`${domain}: ${String(error)}`); }
                }
                if (contextReady) for (const domain of ESTATE_DOMAINS) {
                    const source = opened.get(domain); if (!source) continue;
                    try { const result = source.apply(authority,context,policy,now,inheritancePlan); afterSourceCommit?.(domain);
                        store.checkpoint(authority.estateId,domain,result.digest,now); receipts.set(domain,result.receipt); blockers.push(...result.receipt.blockers); }
                    catch (error) { blockers.push(`${domain}: ${String(error)}`); }
                }
                if (receipts.size === ESTATE_DOMAINS.length) {
                    try { blockers.push(...verifyEstateFunding(receipts)); }
                    catch (error) { blockers.push(`funding: ${String(error)}`); }
                }
                store.finish(authority.estateId,policy,blockers,now);
                const current = store.get(authority.estateId)!;
                if (current.status === 'custody-ready' && current.inheritance?.status === 'prepared') {
                    if (opened.get('property')!.inheritanceCompleted(receipts.get('property')!,current.inheritance.plan))
                        store.completeInheritance(current.estateId,current.inheritance.digest,now);
                }
            } finally { for (const source of opened.values()) source.close(); }
        }
        return { cases: store.list(), authorityErrors };
    } finally { agents.close(); store.close(); }
}

/** Known funding in one ledger cannot stand in for the independent money/escrow receipt. */
export function verifyEstateFunding(receipts: ReadonlyMap<EstateDomain,EstateSourceReceipt>): string[] {
    const rows = (domain: EstateDomain, table: string) => receipts.get(domain)!.claims.filter(claim => claim.table === table).map(claim => claim.facts);
    const blockers: string[] = [], reservations = rows('treasury','institution_treasury_reservation'), engineEscrows = rows('escrow','player_inventory_escrow');
    for (const payment of rows('contracts','economic_contract_settlement')) {
        const held = reservations.find(row => row.reservation_id === payment.reservation_id);
        const status = payment.released_at ? 'released' : payment.status;
        const expected = status === 'committed' ? 'committed' : status === 'released' ? 'released' : 'reserved';
        if (!held || held.actor_kind !== payment.payer_kind || held.actor_id !== payment.payer_actor_id
            || held.amount_gp !== payment.amount_gp || held.settlement_id !== payment.settlement_id || held.status !== expected)
            blockers.push(`funding: contract ${payment.contract_id} lacks matching treasury custody/receipt`);
    }
    for (const payment of rows('contracts','economic_contract_player_escrow')) {
        const held = engineEscrows.find(row => row.escrow_id === payment.escrow_id), status = payment.released_at ? 'released' : payment.status;
        const engineStatus = held?.committed_at ? 'committed' : held?.commit_started_at ? 'settling' : held?.status;
        const expected = status === 'funded' ? 'held' : status;
        if (!held || held.username !== payment.payer_username || engineStatus !== expected
            || healthDigest(JSON.parse(String(held.assets_json))) !== healthDigest(JSON.parse(String(payment.assets_json)))
            || status === 'committed' && held.payee_username !== payment.payee_username)
            blockers.push(`funding: contract ${payment.contract_id} lacks matching engine escrow custody/receipt`);
    }
    return blockers;
}
