import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentStateStore, type AgentStateSimulationClock } from '../../../agent-state/store.js';
import { canonicalSkillParameters } from '../../../agent-state/skill-binding.js';
import type { AgentPopulationMember } from '../../../agent-state/types.js';
import type { LivelihoodAction, LivelihoodJournalEntry } from '../../../agent-state/livelihood.js';
import type { SimulationClockObservation } from '../../../simulation-clock/types.js';
import { playerTimeCapabilities } from '../../../simulation-clock/store.js';
import { workDigest } from '../../../business-work/binding.js';
import { readBusinessFacilityGrant } from './business-facility-grant.js';
import { BusinessWorkStore, loadDefaultBusinessWorkPolicyCatalog } from '../../../business-work/work.js';
import { decideBusinessStock, loadDefaultBusinessStockPolicyCatalog } from '../../../business-stock-policy/policy.js';
import { readFoodCommerce } from '../../../agent-operated-shop/native-commerce.js';
import { readRentJournal, nativeHousingCatalogs, type NativeRentOrder, type HousingNativeOptions } from '../../../housing/native-rent.js';
import { OwnedDatabase } from '../../engine/src/io/OwnedDatabase.js';
import type { FacilityAccessGrantEvidence } from '../../../facility-capability/types.js';
import { loadNativeKitchenPolicy } from '../../../production-workflow/native-kitchen-policy.js';
import { SOCIETY_TRAVEL_SITES } from '../../../agent-skills/society-travel.js';
import { businessManagerPathFor, inspectBusinessForAgent, validateBusinessPlayerActionForAgent } from './business-agent-port.js';
import { BusinessManagerStore } from './business-manager.js';
import { createAdminBusinessWorkRequest } from './agent-state.js';
import { populationNeedsOptions, populationNeedsBinding, readPopulationNeeds, readPopulationFoodApplications } from './needs-runtime.js';
import { reservePopulationKitchen } from './native-kitchen.js';
import { reservePopulationRental, requestNativeHousing, finalizePopulationRental } from './native-housing.js';
import { reservePopulationFoodCommerce, requestNativeFoodCommerce, reconcilePopulationFoodCommerce } from './native-food-commerce.js';
import { resolveAdminSkillForAgent, type AdminAgentSkillCatalogOptions } from './skill-catalog.js';
import type { GatewayBotSnapshot } from './types.js';
import type { LivelihoodPorts, LivelihoodReceipt } from './livelihood-runtime.js';
import { isLivelihoodPolicy, LIVELIHOOD_BINDING_SOURCE, type LivelihoodSnapshot } from './livelihood-policy.js';
import { repoRoot } from './paths.js';
import { loadSurvivalProfile } from '../../../needs/survival.js';
import { executeFoodSkillRequest, foodSkillActionId } from './native-food-skills.js';
import { readSkillRun } from './skill-history.js';
import type { SocietyFoodRequest } from '../../../sdk/society-food.js';

export interface LivelihoodSourceOptions {
    agentPath: string; gatewayBots(): Map<string, GatewayBotSnapshot>;
    activeSkill(username: string): unknown; simulationClock?: AgentStateSimulationClock;
    workspace?: string; skillCatalog?: AdminAgentSkillCatalogOptions;
    requestCommerce?: typeof requestNativeFoodCommerce;
}
/** Read only existing, audited domain projections; absence never becomes a zero balance or entitlement. */
function domainRows<T>(path: string, table: string, read: (db: OwnedDatabase) => T[]): T[] {
    if (!existsSync(path)) return [];
    const db = new OwnedDatabase(path, { readonly: true, strict: true });
    try { let rows: T[] = []; db.transaction(() => {
        if (db.query("SELECT 1 FROM sqlite_master WHERE name=?1").get(table)) rows = read(db);
    }).deferred(); return rows; } finally { db.close(true); }
}

export function createLivelihoodPorts(options: LivelihoodSourceOptions): LivelihoodPorts {
    const workspace = options.workspace ?? repoRoot, needsOptions = populationNeedsOptions(workspace);
    const businessPath = businessManagerPathFor(options.agentPath);
    const sendCommerce = options.requestCommerce ?? requestNativeFoodCommerce;
    const housing: HousingNativeOptions = { workspace, worldId: needsOptions.worldId, housingPath: join(workspace, '.local/economy/housing.sqlite'),
        propertyPath: join(workspace, '.local/admin/properties.sqlite'), checkpointPath: resolve(workspace, 'server/engine',
            process.env.PLAYER_CHECKPOINT_DATABASE ?? process.env.GE_DATABASE ?? 'data/player-checkpoints.sqlite') };
    const commerce = { ...housing, businessPath, treasuryPath: join(workspace, '.local/economy/institution-treasury.sqlite'),
        journalPath: join(workspace, '.local/economy/food-commerce.sqlite'),
        tradePath: resolve(workspace, 'server/engine', process.env.TRADE_EVIDENCE_DB ?? 'data/mods/trade-evidence.sqlite') };
    const agents = <T>(read: (s: AgentStateStore) => T): T => { const s = new AgentStateStore(options.agentPath);
        try { return read(s); } finally { s.close(); } };
    const gateway = (name: string) => [...options.gatewayBots().entries()].find(([key]) => key.toLowerCase() === name)?.[1];
    const fresh = (name: string) => { const b = gateway(name); return !!b?.state?.player && b.status === 'active'
        && Date.now() - b.lastStateReceivedAt <= 5000 && !b.state.player.isDead && b.controllers === 0 && !options.activeSkill(name); };
    const clock = (): SimulationClockObservation => {
        const shared = options.simulationClock, state = shared?.store.get(shared.clockId);
        if (!shared || !state) throw new Error('Routine clock source unavailable');
        return { clockId: state.clockId, profileDigest: state.profileDigest, simulationTime: state.lastSimulationTime,
            wallTime: state.lastObservedWallTime, revision: state.revision, status: state.status, engineTick: null };
    };
    const member = (id: string) => { const m = agents(s => s.getPopulationMember(id));
        if (!m || m.status !== 'active' || m.characterLifecycle.status !== 'active') throw new Error('Active population binding required'); return m; };
    const rentalOrders = () => domainRows(housing.housingPath, 'housing_native_schema', db => readRentJournal<NativeRentOrder>(db, 'housing_native'));
    const commerceOrders = () => domainRows(businessPath, 'business_food_commerce_schema', readFoodCommerce);

    const facilityGrant = (businessId: string, worker: AgentPopulationMember, capability: string, c: SimulationClockObservation) =>
        readBusinessFacilityGrant(workspace, businessPath, businessId, worker.agentId, capability, c);

    // Catalog prices are standing policy terms, not inferred observations of another avatar's inventory.
    const travel = (m: AgentPopulationMember, site: keyof typeof SOCIETY_TRAVEL_SITES, cause: string): LivelihoodAction | undefined => {
        const target = SOCIETY_TRAVEL_SITES[site], p = gateway(m.playerUsername)?.state?.player;
        if (!p || !fresh(m.playerUsername) || (p.level === target.level
            && p.worldX === target.x && p.worldZ === target.z)) return;
        // The fixed route is admitted only against the corresponding native site configuration.
        const kitchen = loadNativeKitchenPolicy(workspace).heat;
        if (kitchen.x !== SOCIETY_TRAVEL_SITES.kitchen.x - 1 || kitchen.z !== SOCIETY_TRAVEL_SITES.kitchen.z || kitchen.level !== 0) return;
        if (site === 'housing' && !nativeHousingCatalogs(workspace).native.beds.every(b => b.level === 0
            && Math.max(Math.abs(b.x - target.x), Math.abs(b.z - target.z)) <= 1)) return;
        const known = agents(s => s.listSkillKnowledge(m.agentId)).filter(k => k.skill.id === 'procedure.travel.native-sites'
            && ['known', 'preferred'].includes(k.status)).sort((a, b) => Number(b.status === 'preferred') - Number(a.status === 'preferred')
                || b.skill.version.localeCompare(a.skill.version, undefined, { numeric: true }))[0];
        if (known) return { kind: 'skill', skill: known.skill, binding: { sourceKind: 'approved-policy',
            sourceId: `${LIVELIHOOD_BINDING_SOURCE}:travel:${cause}`, parameters: { site } } };
    };
    const standingCommerce = (m: AgentPopulationMember, kind: 'sale' | 'procurement', revision: number, c: SimulationClockObservation):
        { action: LivelihoodAction } | { blocked: 'commerce-meeting-route-required' } | undefined => {
        if (!existsSync(businessPath)) return undefined;
        let routeBlocked = false;
        const manager = new BusinessManagerStore(businessPath); let businesses;
        try { businesses = manager.list(500); } finally { manager.close(); }
        for (const policy of loadDefaultBusinessStockPolicyCatalog().policies.filter(p => p.itemId === (kind === 'sale' ? 379 : 377))
            .sort((a, b) => a.policyId.localeCompare(b.policyId))) {
            const business = businesses.find(b => b.businessId === policy.businessId && b.status === 'active' && b.activePolicy);
            if (!business) continue;
            const stock = domainRows(businessPath, 'business_inventory', db => db.query(
                'SELECT count FROM business_inventory WHERE business_id=?1 AND item_id=?2'
            ).all(business.businessId, policy.itemId) as { count: number }[])[0]?.count ?? 0;
            const decision = decideBusinessStock(policy, loadDefaultBusinessStockPolicyCatalog(), stock);
            if (kind === 'sale' ? decision.sale.availableUnits < 1 : !decision.procurement || decision.procurement.quantity < 1) continue;
            const candidates = [business.ownerAgentId, ...business.employments.filter(e => e.status === 'active').map(e => e.workerAgentId)]
                .filter(id => id !== m.agentId);
            for (const workerId of [...new Set(candidates)].sort()) {
                const enrollment = agents(s => s.getAutonomyEnrollment(workerId));
                if (!isLivelihoodPolicy(enrollment) || !enrollment || !['desired', 'running'].includes(enrollment.status)) continue;
                let worker: AgentPopulationMember;
                try { worker = member(workerId); facilityGrant(business.businessId, worker, 'storage.secure', c); } catch { continue; }
                if (!fresh(worker.playerUsername)) continue;
                const price = kind === 'sale' ? policy.pricing.saleUnitPriceGp : policy.procurement.maxUnitPriceGp;
                const own = gateway(m.playerUsername)?.state?.inventory ?? [];
                if (kind === 'sale' && own.filter(i => i.id === 995).reduce((n, i) => n + i.count, 0) < price) continue;
                if (kind === 'procurement' && !own.some(i => i.id === 377 && i.count > 0)) continue;
                const site = loadNativeKitchenPolicy(workspace).heat, self = gateway(m.playerUsername)?.state?.player,
                    peer = gateway(worker.playerUsername)?.state?.player;
                const near = (p: typeof self) => !!p && p.level === site.level
                    && Math.max(Math.abs(p.worldX - site.x), Math.abs(p.worldZ - site.z)) <= 3;
                if (!near(self) || !near(peer) || Math.max(Math.abs(self!.worldX - peer!.worldX), Math.abs(self!.worldZ - peer!.worldZ)) > 2) {
                    const route = travel(m, 'kitchen', `commerce:${business.businessId}:${kind}`);
                    if (route) return { action: route };
                    routeBlocked = true; continue;
                }
                return { action: { kind: 'commerce', operationId: `routine-food.${workDigest([m.agentId, populationNeedsBinding(needsOptions.worldId, m).lifecycleId,
                    revision, policy.policyId, workerId, kind]).slice(0, 48)}`, quote: { businessId: business.businessId,
                    workerAgentId: workerId, kind, quantity: 1, unitPriceGp: price } } };
            }
        }
        return routeBlocked ? { blocked: 'commerce-meeting-route-required' } : undefined;
    };

    const snapshot = async (agentId: string): Promise<LivelihoodSnapshot> => {
        const survival = loadSurvivalProfile(workspace);
        const profile = agents(s => s.getControlProfile(agentId));
        if (!profile) throw new Error('Routine profile unavailable');
        const c = clock();
        if (profile.role === 'institution' && profile.subjectKind === 'business') {
            const business = inspectBusinessForAgent(agentId, options.agentPath);
            const result: LivelihoodSnapshot = { lifecycle: `business:${business.businessId}:${business.createdAt}:${c.clockId}:${c.profileDigest}`, alive: business.status === 'active',
                role: 'business', clockRunning: c.status === 'running', physicalAllowed: false, needs: null };
            if (!business.activePolicy) return result;
            const manager = new BusinessManagerStore(businessPath);
            let inventory; try { inventory = manager.listInventory(business.businessId); } finally { manager.close(); }
            const catalog = loadDefaultBusinessStockPolicyCatalog(), policy = catalog.policies.find(p => p.businessId === business.businessId && p.itemId === 379);
            if (!policy) return result;
            if (!decideBusinessStock(policy, catalog, inventory.find(i => i.itemId === 379)?.count ?? 0).procurement)
                return { ...result, stockWaiting: 'stock-satisfied' };
            const work = new BusinessWorkStore(businessPath);
            try {
                // Existing reservation/shift is reconciled by SI-A08, never a second order for the same stock gap.
                if (work.bindings().some(b => { const o = work.get(b.workOrderId); return o?.businessId === business.businessId
                    && (o.status === 'scheduled' || o.status === 'running' || (o.status === 'completed' && o.wageStatus !== 'paid')); }))
                    return { ...result, stockWaiting: 'stock-work-in-progress' };
            } finally { work.close(); }
            const wp = loadDefaultBusinessWorkPolicyCatalog().policies.find(p => p.businessId === business.businessId && p.requiredSkill.id === 'procedure.food.cook-lobster');
            const employment = business.employments.filter(e => e.status === 'active' && e.roleDefinitionId === wp?.roleDefinitionId)
                .sort((a, b) => a.employmentId.localeCompare(b.employmentId))[0];
            if (wp && employment) {
                // A legitimate input wait is not an authority failure or a reason to quarantine the business.
                if ((inventory.find(i => i.itemId === 377)?.count ?? 0) < 1)
                    return { ...result, stockWaiting: 'stock-input-required' };
                result.stock = { kind: 'stock', businessId: business.businessId, policyId: wp.policyId, employmentId: employment.employmentId };
            }
            return result;
        }
        const population = agents(s => s.getPopulationMember(agentId));
        if (population && (population.status !== 'active' || population.characterLifecycle.status !== 'active'))
            return { lifecycle: populationNeedsBinding(needsOptions.worldId, population).lifecycleId, alive: false,
                role: 'player', clockRunning: c.status === 'running', physicalAllowed: false, needs: null };
        const m = member(agentId), binding = populationNeedsBinding(needsOptions.worldId, m);
        if (m.playerUsername !== profile.avatarPlayerUsername || profile.role !== 'player'
            || agents(s => s.getIdentity(agentId)?.playerUsername) !== m.playerUsername) throw new Error('Exact player-avatar binding required');
        const b = gateway(m.playerUsername), needs = readPopulationNeeds(needsOptions, m).state;
        const time = options.simulationClock?.store.getPlayerTimeState(c.clockId, m.playerUsername);
        let covered = false;
        try {
            const nutrition = readPopulationFoodApplications(needsOptions), through = nutrition.through;
            const profile = options.simulationClock?.store.get(c.clockId)?.profile;
            const maxLag = profile ? 30000 * profile.rate.simulationMilliseconds / profile.rate.wallMilliseconds : 0;
            covered = !!needs && nutrition.status === 'available' && nutrition.pending === 0 && !!through
                && through.clockId === c.clockId && through.profileDigest === c.profileDigest
                && Date.parse(through.wallTime) >= Date.now() - 30000 && Date.parse(through.wallTime) <= Date.now() + 5000
                && needs.state.observedAtSimulationTime <= through.simulationTime && through.simulationTime <= c.simulationTime
                && Date.parse(c.simulationTime) - Date.parse(needs.state.observedAtSimulationTime) <= maxLag;
        } catch {
            // A newly admitted lifecycle at the exact initial clock may precede the first native source DB.
            // Existing but damaged/missing receipt history never gets this bootstrap exception.
            covered = !!needs && !needs.lastFoodReceipt && needs.state.observedAtSimulationTime === c.simulationTime
                && !existsSync(housing.checkpointPath) && !existsSync(join(workspace, 'server/engine/data/market.sqlite'));
        }
        const result: LivelihoodSnapshot = { lifecycle: binding.lifecycleId,
            ...(survival ? { hungerThreshold: survival.hungerThreshold } : {}),
            alive: m.characterLifecycle.status === 'active' && !b?.state?.player?.isDead, role: 'player', clockRunning: c.status === 'running',
            physicalAllowed: fresh(m.playerUsername) && !!time && playerTimeCapabilities(time).physicalExecutionAllowed,
            needs: needs && !needs.terminal && needs.binding.clockId === c.clockId && needs.binding.clockProfileDigest === c.profileDigest
                && covered && needs.playerTimeRevision === time?.revision
                ? { hunger: needs.state.values.find(v => v.needId === 'hunger')!.value,
                    fatigue: needs.state.values.find(v => v.needId === 'fatigue')!.value, sleeping: needs.rest === 'sleeping' } : null };
        const food = b?.state?.inventory.find(i => i.id === 379 && i.count > 0);
        const consume = agents(s => s.listSkillKnowledge(agentId)).filter(k => k.skill.id === 'procedure.food.consume-lobster'
            && ['known', 'preferred'].includes(k.status)).sort((a, b) => Number(b.status === 'preferred') - Number(a.status === 'preferred')
                || b.skill.version.localeCompare(a.skill.version, undefined, { numeric: true }))[0];
        if (food && consume && fresh(m.playerUsername)) result.food = { kind: 'skill', skill: consume.skill,
            binding: { sourceKind: 'approved-policy', sourceId: `${LIVELIHOOD_BINDING_SOURCE}:needs:${needs?.revision ?? 0}`, parameters: { slot: food.slot } } };
        // Existing explicit commerce terms/grant are the only partner source. Chat and private peer inventory are ignored.
        const sale = commerceOrders().find(o => o.phase === 'prepared' && o.binding.intent.kind === 'sale'
            && o.binding.intent.counterparty.agentId === agentId && o.binding.intent.counterparty.lifecycleId === binding.lifecycleId
            && o.binding.intent.clockId === c.clockId && o.binding.intent.expiresAt > c.wallTime);
        if (!result.food && sale) result.food = { kind: 'commerce', operationId: sale.binding.intent.operationId };
        if (!result.food) {
            const quote = standingCommerce(m, 'sale', needs?.revision ?? 0, c);
            if (quote && 'action' in quote) result.food = quote.action;
            else if (quote) result.foodBlocked = quote.blocked;
        }
        const dueRequests = new Map<string, { end: string; due: boolean }>();
        if (existsSync(businessPath)) {
            const work = new BusinessWorkStore(businessPath);
            try { for (const binding of work.bindings()) {
                const order = work.get(binding.workOrderId)!;
                dueRequests.set(binding.request.requestId, { end: order.scheduledEnd, due: order.status === 'scheduled'
                    && order.scheduledStart <= new Date().toISOString() && order.scheduledEnd >= new Date().toISOString() });
            } } finally { work.close(); }
        }
        const requests = agents(s => s.listPlayerActionRequests(agentId, 'incoming'))
            .filter(r => ['pending', 'accepted', 'approved'].includes(r.status)
                && (dueRequests.has(r.requestId) ? dueRequests.get(r.requestId)!.due : r.status === 'approved'))
            .sort((a, b) => (dueRequests.get(a.requestId)?.end ?? a.requestedAt).localeCompare(dueRequests.get(b.requestId)?.end ?? b.requestedAt)
                || a.requestId.localeCompare(b.requestId));
        if (requests[0]) result.work = { kind: 'skill', skill: requests[0].skill,
            binding: { sourceKind: 'work-order', sourceId: requests[0].requestId, parameters: canonicalSkillParameters(requests[0].parameters) } };
        // Existing kitchen employment supplies a service location even before raw stock arrives.
        // This is a route, never a fabricated work order, input grant or wage receipt.
        if (!result.work && existsSync(businessPath)) {
            const manager = new BusinessManagerStore(businessPath);
            try {
                const policies = loadDefaultBusinessWorkPolicyCatalog().policies;
                for (const business of manager.list()) {
                    if (business.status !== 'active' || !business.activePolicy || !business.employments.some(e => e.workerAgentId === agentId
                        && e.status === 'active' && policies.some(p => p.businessId === business.businessId
                            && p.roleDefinitionId === e.roleDefinitionId && p.requiredSkill.id === 'procedure.food.cook-lobster'))) continue;
                    try { facilityGrant(business.businessId, m, 'storage.secure', c); } catch { continue; }
                    result.work = travel(m, 'kitchen', `service:${business.businessId}`); if (result.work) break;
                }
            } finally { manager.close(); }
        }
        // Additional supply uses an existing explicitly bound goal; there is no generated raw-material grant.
        const goals = agents(s => s.listGoals(agentId, 'active')).filter(g => g.horizon === 'immediate' && !!g.skill)
            .sort((a, b) => b.priority - a.priority || a.goalId.localeCompare(b.goalId));
        for (const goal of goals) {
            const execution = agents(s => s.getGoalExecution(goal.goalId));
            if (execution && execution.binding.sourceKind === 'approved-policy' && execution.binding.sourceId === LIVELIHOOD_BINDING_SOURCE
                && (!execution.nextEligibleAt || execution.nextEligibleAt <= new Date().toISOString())) {
                result.supply = { kind: 'skill', skill: goal.skill!, binding: execution.binding, goalId: goal.goalId }; break;
            }
        }
        if (result.supply?.kind === 'skill' && result.supply.skill.id === 'procedure.food.gather-lobster')
            result.supply = travel(m, 'pier', 'gather-source') ?? result.supply;
        const procurement = standingCommerce(m, 'procurement', needs?.revision ?? 0, c);
        if (procurement && 'action' in procurement) result.supply = procurement.action;
        else if (procurement) result.supplyBlocked = procurement.blocked;
        const rentals = rentalOrders(), own = rentals.find(o => ['active', 'reserved'].includes(o.phase)
            && o.binding.intent.tenant.agentId === agentId && o.binding.intent.tenant.lifecycleId === binding.lifecycleId
            && o.binding.intent.clockId === c.clockId && o.binding.intent.endsAt > c.simulationTime);
        if (own) {
            const i = own.binding.intent;
            if (own.phase === 'reserved') result.rent = { kind: 'housing', operation: 'pay', operationId: i.operationId };
            else {
                result.wake = { kind: 'housing', operation: 'wake', operationId: i.operationId, afterPlayerTimeRevision: time?.revision ?? 0 };
                const bed = i.catalogs.native.beds.find(bed => bed.bedSlotId === i.bedSlotId)!;
                const p = b?.state?.player;
                if (p && p.level === bed.level && Math.max(Math.abs(p.worldX - bed.x), Math.abs(p.worldZ - bed.z)) <= 1)
                    result.rest = { kind: 'housing', operation: 'sleep', operationId: i.operationId, afterPlayerTimeRevision: time?.revision ?? 0 };
                else result.rest = travel(m, 'housing', `rental:${i.operationId}`);
            }
        } else if (existsSync(housing.propertyPath)) {
            const catalogs = nativeHousingCatalogs(workspace), unit = catalogs.units.units.find(u => u.housingUnitId === catalogs.native.housingUnitId)!;
            const title = domainRows(housing.propertyPath, 'property_state', db => db.query('SELECT * FROM property_state WHERE property_id=?1').all(unit.propertyId) as { owner_kind: string; owner_id: string; status: string }[])[0];
            const landlord = title?.owner_kind === 'player' && title.status === 'owned'
                ? agents(s => s.listPopulationMembers('active')).find(m => m.playerUsername === title.owner_id && m.agentId !== agentId) : undefined;
            const bed = catalogs.native.beds.find(bed => !rentals.some(o => ['reserved', 'active'].includes(o.phase)
                && o.binding.intent.bedSlotId === bed.bedSlotId && o.binding.intent.endsAt > c.simulationTime));
            const gp = b?.state?.inventory.filter(i => i.id === 995).reduce((n, i) => n + i.count, 0) ?? 0;
            if (landlord && bed && gp >= unit.rentGpPerPeriod) result.rent = { kind: 'housing', operation: 'pay',
                operationId: `routine-rent.${workDigest([binding.lifecycleId, needs?.revision, bed.bedSlotId]).slice(0, 48)}`,
                bedSlotId: bed.bedSlotId, landlordAgentId: landlord.agentId };
        }
        return result;
    };

    const proof = async (entry: LivelihoodJournalEntry, cancelPending = false): Promise<LivelihoodReceipt> => {
        const a = entry.action;
        if (a?.kind === 'housing') {
            const bound = rentalOrders().find(o => o.binding.intent.operationId === a.operationId);
            if (!bound || bound.binding.intent.tenant.agentId !== entry.agentId || bound.binding.intent.tenant.lifecycleId !== entry.lifecycle)
                throw new Error('Housing receipt actor/lifecycle differs');
            if (a.operation === 'pay') {
                const order = finalizePopulationRental(housing, a.operationId);
                return { status: order.phase === 'active' ? 'completed' : 'failed', reason: `rent-${order.phase}`, source: order.nativeDigest };
            }
            const m = member(entry.agentId), t = options.simulationClock?.store.getPlayerTimeState(clock().clockId, m.playerUsername);
            const order = rentalOrders().find(o => o.binding.intent.operationId === a.operationId);
            if (!order || order.binding.intent.tenant.agentId !== entry.agentId || order.binding.intent.tenant.lifecycleId !== entry.lifecycle)
                throw new Error('Housing routine binding differs');
            if (t && typeof a.afterPlayerTimeRevision === 'number' && t.revision > a.afterPlayerTimeRevision
                && t.rest === (a.operation === 'sleep' ? 'sleeping' : 'awake')
                && (a.operation === 'wake' || (t.sleepContext?.sleepPlaceId === order.binding.intent.bedSlotId
                    && t.sleepContext.access.evidenceId.startsWith('housing:'))))
                return { status: 'completed', reason: `native-${a.operation}`, source: `player-time:${t.clockId}:${t.playerId}:${t.revision}` };
        } else if (a?.kind === 'commerce') {
            const orders = commerceOrders(), bound = orders.find(o => o.binding.intent.operationId === a.operationId);
            // The engine admits commands only by this durable binding. An atomic
            // reservation rejection leaves no binding, so there is no physical
            // command to replay or uncertain custody to discard.
            if (!bound && a.quote && domainRows(businessPath, 'business_food_commerce_schema',
                db => db.query('SELECT version FROM business_food_commerce_schema').all()).length === 1) {
                agents(s => s.releaseLivelihoodParticipants(entry.actionId));
                return { status: 'failed', reason: 'commerce-not-admitted',
                    source: `commerce-non-admission:${a.operationId}:${workDigest(orders)}` };
            }
            if (!bound || ![bound.binding.intent.worker, bound.binding.intent.counterparty].some(p => p.agentId === entry.agentId && p.lifecycleId === entry.lifecycle))
                throw new Error('Commerce receipt actor/lifecycle differs');
            const order = await reconcilePopulationFoodCommerce(commerce, a.operationId, cancelPending, sendCommerce);
            return { status: order.phase === 'completed' ? 'completed' : order.phase === 'cancelled' ? 'failed' : 'pending',
                reason: `commerce-${order.phase}`, source: order.nativeDigest };
        } else if (a?.kind === 'stock') {
            const work = new BusinessWorkStore(businessPath);
            try { const binding = work.binding(entry.actionId);
                if (binding && agents(s => s.getPlayerActionRequest(binding.request.requestId)))
                    return { status: 'completed', reason: 'finite-stock-order-created', source: `work-order:${binding.workOrderId}:${workDigest(binding)}` };
            } finally { work.close(); }
        }
        return { status: 'pending', reason: 'native-receipt-pending', source: null };
    };

    const executeStock = async (entry: LivelihoodJournalEntry, a: Extract<LivelihoodAction, { kind: 'stock' }>) => {
        const business = inspectBusinessForAgent(entry.agentId, options.agentPath), employment = business.employments.find(e => e.employmentId === a.employmentId);
        const policy = loadDefaultBusinessWorkPolicyCatalog().policies.find(p => p.policyId === a.policyId);
        if (business.businessId !== a.businessId || !employment || !policy || policy.businessId !== business.businessId) throw new Error('Stock order authority changed');
        validateBusinessPlayerActionForAgent(entry.agentId, { assigneeAgentId: employment.workerAgentId, skill: policy.requiredSkill, rewardGp: employment.wageGp }, options.agentPath);
        const profile = agents(s => s.getControlProfile(entry.agentId))!;
        agents(s => s.reserveDecisionOperationalBudget(entry.eventId, employment.wageGp, profile.dailyOperationalBudgetGp));
        // Publishing a draft is a separate approval path, never a side effect of enabling this routine.
        await resolveAdminSkillForAgent(`${policy.requiredSkill.id}@${policy.requiredSkill.version}`, employment.workerAgentId, options.skillCatalog);
        const worker = member(employment.workerAgentId), c = clock(), native = loadNativeKitchenPolicy(workspace);
        const enrollment = agents(s => s.getAutonomyEnrollment(worker.agentId));
        const knowledge = agents(s => s.getSkillKnowledge(worker.agentId, policy.requiredSkill));
        if (!isLivelihoodPolicy(enrollment) || !['desired', 'running'].includes(enrollment!.status)
            || !knowledge || !['known', 'preferred'].includes(knowledge.status)) throw new Error('Cook needs enrolled exact skill knowledge');
        const grant = facilityGrant(business.businessId, worker, native.capabilityId, c);
        const verify = (g: FacilityAccessGrantEvidence) => workDigest(g) === workDigest(grant)
            && workDigest(facilityGrant(business.businessId, worker, native.capabilityId, clock())) === workDigest(grant);
        const work = new BusinessWorkStore(businessPath);
        try {
            if (!work.get(entry.actionId)) work.createWorkOrder(entry.actionId, policy.policyId, employment.employmentId, entry.createdAt,
                new Date(Date.parse(entry.createdAt) + policy.maximumMinutes * 60000).toISOString(), entry.createdAt);
        } finally { work.close(); }
        const kitchen = reservePopulationKitchen({ ...housing, businessPath }, worker, c,
            { operationId: entry.actionId, runId: entry.actionId, businessId: business.businessId, sourceStorageId: null, targetStorageId: null }, grant, verify);
        createAdminBusinessWorkRequest(entry.actionId, entry.agentId, { 'kitchen-run': entry.actionId, 'batch-id': kitchen.intent.batchId },
            { kind: 'cook', kitchenRunId: entry.actionId, batchId: kitchen.intent.batchId }, options.agentPath, { workspace, worldId: needsOptions.worldId }, entry.createdAt);
    };

    const reconcile = async (entry: LivelihoodJournalEntry) => {
        let receipt = await proof(entry, entry.action?.kind === 'commerce' && Date.now() - Date.parse(entry.createdAt) >= 15000);
        if (entry.action?.kind === 'stock' && receipt.status === 'pending') {
            if (clock().status !== 'running') return { status: 'pending' as const, reason: 'clock-paused', source: null };
            // Exact domain IDs are an idempotent outbox; this never replays a physical command.
            await executeStock(entry, entry.action);
            receipt = await proof(entry);
        }
        if (receipt.status !== 'pending') agents(s => s.releaseLivelihoodParticipants(entry.actionId));
        return receipt;
    };
    return { snapshot, reconcile, reconcileFailedSkill: async (entry, runId) => {
        const a = entry.action;
        if (a?.kind !== 'skill' || !['procedure.food.gather-lobster', 'procedure.food.consume-lobster', 'procedure.travel.native-sites'].includes(a.skill.id)) return null;
        const m = member(entry.agentId), binding = populationNeedsBinding(needsOptions.worldId, m);
        const run = await readSkillRun(runId, join(workspace, '.local/agent-skills/runs'));
        if (!run || run.username !== m.playerUsername || run.skill.id !== a.skill.id || run.skill.version !== a.skill.version
            || workDigest(canonicalSkillParameters(run.parameters)) !== workDigest(canonicalSkillParameters(a.binding.parameters)))
            throw new Error('Native terminal run differs from its routine binding');
        if (a.skill.id === 'procedure.travel.native-sites')
            return { status: 'pending', reason: 'travel-source-reconciliation-required', source: null };
        const event = run.events.findLast(e => e.type === 'step.failed' && e.operation?.startsWith('food-'));
        const context = event?.data?.context as SocietyFoodRequest['context'] | undefined;
        if (!context || context.runId !== runId || workDigest(context.skill) !== workDigest(a.skill))
            return { status: 'pending', reason: 'food-source-reconciliation-required', source: null };
        const actionId = foodSkillActionId({ context } as SocietyFoodRequest);
        const path = join(workspace, '.local/agent-skills/food-operations', `${actionId}.json`);
        if (!existsSync(path)) throw new Error('Food intent source is missing');
        const intent = JSON.parse(readFileSync(path, 'utf8')) as { request: SocietyFoodRequest };
        if (workDigest(intent.request.context) !== workDigest(context) || foodSkillActionId(intent.request) !== actionId
            || intent.request.operation !== (a.skill.id === 'procedure.food.gather-lobster' ? 'food-gather' : 'food-consume'))
            throw new Error('Food intent source differs from the exact terminal context');
        // Same intent/source only. This adapter never starts a process or sends a
        // physical command, including when a preparation is still waiting.
        const proof = await executeFoodSkillRequest({ workspace, worldId: needsOptions.worldId, checkpointPath: housing.checkpointPath,
            businessPath, binding: () => binding, dispatch: async () => { throw new Error('Source-only routine reconciliation'); } }, m.playerUsername, intent.request);
        if (proof.data?.status !== 'terminal') return { status: 'pending', reason: 'food-source-reconciliation-required', source: null };
        return { status: proof.success ? 'completed' : proof.reason === 'food-no-output' ? 'expected-failure' : 'failed',
            reason: proof.reason!, source: `native-food:${actionId}:${proof.data.receiptDigest}` };
    }, execute: async entry => {
        const a = entry.action;
        if (a?.kind !== 'stock' && !(a?.kind === 'housing' && a.operation === 'wake') && !fresh(member(entry.agentId).playerUsername))
            throw new Error('Native routine actor is busy or stale');
        if (a?.kind === 'stock') await executeStock(entry, a);
        else if (a?.kind === 'housing') {
            if (a.operation === 'pay' && a.bedSlotId && a.landlordAgentId)
                reservePopulationRental(housing, member(entry.agentId), member(a.landlordAgentId), clock(),
                    { operationId: a.operationId, bedSlotId: a.bedSlotId });
            // Cross-actor payment/trade requires a separately idle, enrolled peer; no second controller is spawned.
            if (a.operation === 'pay') {
                const order = rentalOrders().find(o => o.binding.intent.operationId === a.operationId);
                if (!order || !fresh(order.binding.intent.landlord.username)) throw new Error('Rental landlord is busy or offline');
                agents(s => s.claimLivelihoodParticipant(entry.agentId, order.binding.intent.landlord.agentId, entry.actionId));
                const profile = agents(s => s.getControlProfile(entry.agentId))!;
                agents(s => s.reserveDecisionOperationalBudget(entry.eventId, order.binding.intent.amountGp, profile.dailyOperationalBudgetGp));
            }
            await requestNativeHousing(a);
        } else if (a?.kind === 'commerce') {
            if (a.quote) {
                const q = a.quote, worker = member(q.workerAgentId), c = clock();
                const grant = facilityGrant(q.businessId, worker, 'storage.secure', c);
                reservePopulationFoodCommerce(commerce, worker, member(entry.agentId), c,
                    { operationId: a.operationId, kind: q.kind, businessId: q.businessId, quantity: q.quantity,
                        unitPriceGp: q.unitPriceGp, expiresAt: new Date(Date.parse(entry.createdAt) + 300000).toISOString() }, grant,
                    g => workDigest(g) === workDigest(facilityGrant(q.businessId, worker, 'storage.secure', clock())));
            }
            const order = commerceOrders().find(o => o.binding.intent.operationId === a.operationId), i = order?.binding.intent;
            if (!i || ![i.worker, i.counterparty].some(p => p.agentId === entry.agentId && p.lifecycleId === entry.lifecycle)) throw new Error('Commerce routine actor binding differs');
            const peer = [i.worker, i.counterparty].find(p => p.agentId !== entry.agentId)!;
            if (!fresh(peer.username)) throw new Error('Commerce partner is busy or offline');
            agents(s => s.claimLivelihoodParticipant(entry.agentId, peer.agentId, entry.actionId));
            if (i.kind === 'sale' && i.counterparty.agentId === entry.agentId) {
                const profile = agents(s => s.getControlProfile(entry.agentId))!;
                agents(s => s.reserveDecisionOperationalBudget(entry.eventId, i.quantity * i.unitPriceGp, profile.dailyOperationalBudgetGp));
            }
            await sendCommerce({ operation: 'execute', operationId: a.operationId });
        } else throw new Error('Unsupported native routine action');
        return reconcile(entry);
    } };
}
