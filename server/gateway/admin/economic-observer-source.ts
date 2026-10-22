import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { AgentStateStore, type AgentStateSimulationClock } from '../../../agent-state/store.js';
import { ECONOMIC_OBSERVER_POLICY, type EconomicFact, type EconomicObservation } from '../../../agent-state/economic-context.js';
import { OwnedDatabase } from '../../engine/src/io/OwnedDatabase.js';
import { businessManagerPathFor } from './business-agent-port.js';
import { estateHeld } from '../../../population-estate/schema.js';
import { populationNeedsOptions, populationNeedsBinding, readPopulationNeeds } from './needs-runtime.js';
import { readRentJournal, rentIds, type NativeRentOrder } from '../../../housing/native-rent.js';
import { agentStateDbPath, economicContractsDbPath, institutionTreasuryDbPath, repoRoot } from './paths.js';
import type { GatewayBotSnapshot } from './types.js';

export interface EconomicObserverSources {
    agentPath: string; businessPath?: string; contractsPath?: string; workspace?: string;
    simulationClock?: AgentStateSimulationClock; gatewayBots?: ReadonlyMap<string, GatewayBotSnapshot>;
    now: string;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function readSource(path: string, read: (db: OwnedDatabase) => void): void {
    const db = new OwnedDatabase(path, { readonly: true, strict: true });
    try { db.transaction(() => read(db)).deferred(); } finally { db.close(true); }
}

/** Source adapters read only observer-owned subjects and explicitly addressed offers.
 * A missing DB is unknown. No client/model-uploaded receipt or global avatar inventory is read.
 */
export function readEconomicObservation(agentId: string, options: EconomicObserverSources): EconomicObservation {
    const agents = new AgentStateStore(options.agentPath);
    const workspace = resolve(options.workspace ?? (options.agentPath === agentStateDbPath ? repoRoot : dirname(options.agentPath)));
    const needsOptions = populationNeedsOptions(workspace);
    try {
        const identity = agents.getIdentity(agentId), profile = agents.getControlProfile(agentId);
        if (!identity || !profile) throw new Error('Economic observer identity unavailable');
        const member = agents.getPopulationMember(agentId);
        const clock = options.simulationClock?.store.get(options.simulationClock.clockId);
        const binding = member ? populationNeedsBinding(needsOptions.worldId, member) : null;
        const observation: EconomicObservation = { agentId, binding: digest([needsOptions.worldId, identity.agentId,
            identity.createdAt, binding, profile.role, profile.subjectKind, profile.subjectId,
            clock?.clockId, clock?.profileDigest]), observedAt: options.now,
            simulationTime: clock?.lastSimulationTime ?? null, facts: [] };
        const fact = (key: string, value: EconomicFact['value'], source: string, cursor: string,
            observedAt: string | null = options.now, trust: EconomicFact['trust'] = 'native') => {
            const age = Date.parse(options.now) - Date.parse(observedAt ?? '');
            observation.facts.push({ key, value, source, cursor, observedAt, trust,
                freshness: value === null ? 'unknown' : age >= 0 && age <= ECONOMIC_OBSERVER_POLICY.maxAgeMs ? 'fresh' : 'stale' });
        };
        const unknown = (key: string, source: string) => fact(key, null, source, 'unavailable', null);
        if (profile.role === 'player' && (!profile.avatarPlayerUsername || identity.playerUsername !== profile.avatarPlayerUsername
            || (member && member.playerUsername !== profile.avatarPlayerUsername))) {
            unknown('lifecycle', 'exact-player-binding'); return observation;
        }
        if (member && (member.status !== 'active' || member.characterLifecycle.status !== 'active'
            || !clock || clock.clockId !== binding!.clockId || clock.profileDigest !== binding!.clockProfileDigest)) {
            unknown('lifecycle', 'population/clock'); return observation;
        }
        for (const action of agents.listPlayerActionRequests(agentId))
            fact(`work:${action.requestId}`, action.status, `player-action:${action.requestId}`, String(action.revision));
        const businessPath = options.businessPath ?? businessManagerPathFor(options.agentPath);
        if (existsSync(businessPath)) {
            try {
                readSource(businessPath, db => {
                    const employments = db.query(`SELECT e.employment_id,e.business_id,e.status,e.wage_gp,e.revision,
                        b.status business_status,b.revision business_revision FROM business_employment e
                        JOIN business b ON b.business_id=e.business_id WHERE e.worker_agent_id=?1 ORDER BY e.employment_id LIMIT 500`)
                        .all(agentId) as { employment_id: string; business_id: string; status: string; wage_gp: number;
                            revision: number; business_status: string; business_revision: number }[];
                    for (const e of employments) {
                        const held = estateHeld(db, 'business', e.business_id);
                        fact(`income:${e.employment_id}`, held ? null : e.status === 'ended' ? 'ended'
                            : e.business_status === 'active' ? 'active' : 'unavailable', `employment:${e.employment_id}`,
                        `${e.business_revision}:${e.revision}`);
                        fact(`wage-terms:${e.employment_id}`, e.wage_gp, `employment:${e.employment_id}`, String(e.revision));
                    }
                    if (profile.role !== 'institution' || profile.subjectKind !== 'business') return;
                    const business = db.query('SELECT business_id FROM business WHERE business_id=?1 AND owner_agent_id=?2')
                        .get(profile.subjectId, agentId) as { business_id: string } | null;
                    if (!business || estateHeld(db, 'business', business.business_id)) { unknown('stock', 'bound-business'); return; }
                    const inventory = db.query('SELECT item_id,count,revision FROM business_inventory WHERE business_id=?1 ORDER BY item_id')
                        .all(business.business_id) as { item_id: number; count: number; revision: number }[];
                    if (!inventory.length) unknown('stock', `business:${business.business_id}`);
                    for (const item of inventory) fact(`stock:${item.item_id}`, item.count, `business:${business.business_id}`, String(item.revision));
                    const partners = db.query('SELECT employment_id,status,revision FROM business_employment WHERE business_id=?1 ORDER BY employment_id')
                        .all(business.business_id) as { employment_id: string; status: string; revision: number }[];
                    for (const e of partners) fact(`partner:${e.employment_id}`, e.status === 'active' ? 'active' : 'ended',
                        `business:${business.business_id}`, String(e.revision));
                });
            } catch { unknown('income/stock', 'business-source'); }
        } else unknown('income/stock', 'business-source');

        const contractsPath = options.contractsPath ?? (options.agentPath === agentStateDbPath
            ? economicContractsDbPath : join(dirname(options.agentPath), 'contracts.sqlite'));
        if (existsSync(contractsPath)) {
            try {
                readSource(contractsPath, db => {
                    const offers = db.query(`SELECT offer_id,status,expires_at,revision FROM economic_offer
                        WHERE creator_agent_id=?1 OR counterparty_agent_id=?1 ORDER BY offer_id LIMIT 500`)
                        .all(agentId) as { offer_id: string; status: string; expires_at: string; revision: number }[];
                    for (const o of offers) {
                        const status = o.status === 'open' && o.expires_at <= options.now ? 'expired' : o.status;
                        fact(`offer:${o.offer_id}`, status, `offer:${o.offer_id}`, `${o.revision}@${status}`);
                    }
                    const contracts = db.query(`SELECT contract_id,resolution,resolution_intent,revision FROM economic_contract
                        WHERE party_a_agent_id=?1 OR party_b_agent_id=?1 ORDER BY contract_id LIMIT 500`)
                        .all(agentId) as { contract_id: string; resolution: string; resolution_intent: string | null; revision: number }[];
                    for (const c of contracts) fact(`contract:${c.contract_id}`, c.resolution_intent === 'cancelled' ? 'cancelling'
                        : c.resolution_intent === 'defaulted' ? 'defaulting' : c.resolution,
                        `contract:${c.contract_id}`, String(c.revision));
                });
            } catch { unknown('known-offers/contracts', 'contract-source'); }
        } else unknown('known-offers/contracts', 'contract-source');

        let cash: number | null = null;
        if (profile.role === 'player' && profile.avatarPlayerUsername) {
            const gateway = [...(options.gatewayBots?.entries() ?? [])].find(([name]) =>
                name.toLowerCase() === profile.avatarPlayerUsername!.toLowerCase())?.[1];
            const at = gateway ? new Date(gateway.lastStateReceivedAt).toISOString() : null;
            const age = Date.parse(options.now) - Date.parse(at ?? '');
            if (gateway?.status === 'active' && gateway.username.toLowerCase() === profile.avatarPlayerUsername.toLowerCase()
                && gateway.state?.player?.name?.toLowerCase() === profile.avatarPlayerUsername.toLowerCase()
                && !gateway.state.player.isDead && age >= 0 && age <= 5000)
                cash = gateway.state.inventory.filter(i => i.id === 995).reduce((sum, i) => sum + i.count, 0);
            fact('own-liquid-inventory-gp', cash, 'own-engine-observation', at ?? 'unavailable', at, 'observed');
        } else {
            unknown('own-liquid-inventory-gp', 'institution-no-avatar');
            if (profile.subjectKind === 'business' || profile.subjectKind === 'faction') {
                const path = options.agentPath === agentStateDbPath ? institutionTreasuryDbPath
                    : join(dirname(options.agentPath), 'institution-treasury.sqlite');
                try {
                    if (!existsSync(path)) throw new Error('Treasury unavailable');
                    readSource(path, db => {
                        const account = db.query('SELECT balance_gp,reserved_gp,revision FROM institution_treasury WHERE actor_kind=?1 AND actor_id=?2')
                            .get(profile.subjectKind, profile.subjectId) as { balance_gp: number; reserved_gp: number; revision: number } | null;
                        fact('own-treasury-available-gp', !account || estateHeld(db, 'actor', `${profile.subjectKind}:${profile.subjectId}`)
                            ? null : account.balance_gp - account.reserved_gp, 'bound-institution-treasury', String(account?.revision ?? 'unavailable'));
                    });
                } catch { unknown('own-treasury-available-gp', 'bound-institution-treasury'); }
            }
        }
        if (member && clock) {
            try {
                const needs = readPopulationNeeds(needsOptions, member).state;
                const clockAge = Date.parse(options.now) - Date.parse(clock.lastObservedWallTime);
                // Exact head only: no projection of missing physiological updates or silent zero hunger.
                if (!needs || needs.terminal || clock.status !== 'running' || clockAge < 0 || clockAge > 30000
                    || needs.state.observedAtSimulationTime !== clock.lastSimulationTime) throw new Error('Needs source is not at the clock head');
                for (const key of ['hunger', 'fatigue']) fact(key, needs.state.values.find(v => v.needId === key)?.value ?? null,
                    'durable-needs', String(needs.revision), clock.lastObservedWallTime);
            } catch { unknown('hunger', 'durable-needs'); unknown('fatigue', 'durable-needs'); }
        } else { unknown('hunger', 'durable-needs'); unknown('fatigue', 'durable-needs'); }

        const housingPath = join(workspace, '.local/economy/housing.sqlite');
        try {
            if (!member || !clock || !existsSync(housingPath)) throw new Error('Housing binding unavailable');
            const db = new OwnedDatabase(housingPath, { readonly: true, strict: true });
            try {
                const orders = readRentJournal<NativeRentOrder>(db, 'housing_native').filter(o => o.phase === 'active'
                    && o.binding.intent.tenant.agentId === agentId && o.binding.intent.tenant.lifecycleId === binding!.lifecycleId
                    && o.binding.intent.worldId === needsOptions.worldId && o.binding.intent.clockId === clock.clockId
                    && o.binding.intent.clockProfileDigest === clock.profileDigest);
                const order = orders.sort((a, b) => b.binding.intent.endsAt.localeCompare(a.binding.intent.endsAt))[0];
                if (!order) throw new Error('Exact native tenancy unavailable');
                const row = db.query("SELECT next_rent_due_at,rent_gp_per_period,revision FROM housing_tenancy WHERE tenancy_id=?1 AND tenant_agent_id=?2 AND status='active'")
                    .get(rentIds(order.binding.intent.operationId).tenancyId, agentId) as { next_rent_due_at: string; rent_gp_per_period: number; revision: number } | null;
                if (!row || row.rent_gp_per_period <= 0 || clock.status !== 'running'
                    || Date.parse(options.now) < Date.parse(clock.lastObservedWallTime)
                    || Date.parse(options.now) - Date.parse(clock.lastObservedWallTime) > 30000)
                    throw new Error('Rent source unavailable');
                fact('rent-due', row.next_rent_due_at <= clock.lastSimulationTime ? 'due' : 'not-due', 'native-tenancy', `${row.revision}:${clock.revision}`);
                fact('rent-next-simulation-time', row.next_rent_due_at, 'native-tenancy', String(row.revision));
                fact('cash-runway-periods', cash === null ? null : cash / row.rent_gp_per_period,
                    'own-cash/known-rent-only-estimate', digest([cash, row.revision]), options.now, 'observed');
            } finally { db.close(true); }
        } catch { unknown('rent-due', 'native-tenancy'); unknown('cash-runway-periods', 'known-rent-only-estimate'); }
        return observation;
    } finally { agents.close(); }
}
