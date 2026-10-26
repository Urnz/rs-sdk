import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { applyHousingFatigueRecoveryRate } from '../housing/effects.js';
import type { DurableNeedsState } from '../needs/store.js';
import type { PlayerTimeHistoryEntry } from '../simulation-clock/types.js';
import type { NeedRateRule } from '../needs/types.js';
import type { NeedsPolicy } from '../needs/types.js';
import { collectNativeIntegrationSources, type NativeIntegrationOptions, type NativeIntegrationSources } from './integration-sources.js';
import { validateEvaluationScope, type EvaluationScope } from './evaluation.js';
import { projectNativeNeedsExposure } from './needs-exposure.js';
import { projectNativeFoodMinimum } from './food-minimum.js';
import { projectHousingMinimum } from './housing-minimum.js';

export class NativeIntegrationError extends Error {
    constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}
export interface IntegrationEvidence {
    id: string; channel: string; recordId: string; sourceDigest: string; actorAgentIds: string[];
    simulationTime: string | null; selected: boolean; record: unknown;
}
type IntegrationSourceSummary = { [K in keyof NativeIntegrationSources]: { status: 'available'; digest: string }
    | { status: 'unavailable' | 'invalid'; reason: string } };
function check(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
const HOUR = 3_600_000n;
const unique = (values: string[]) => [...new Set(values)].sort();
const within = (scope: EvaluationScope, time: string) => time > scope.fromSimulationTime && time <= scope.toSimulationTime;

/** Exact rational exposure. Saturated state changes cannot erase physiological demand.
 * The unit is need-points * 3,600,000; division is deferred, never rounded per sample. */
export function integrateNeedsDemand(opening: DurableNeedsState, closing: DurableNeedsState,
    history: PlayerTimeHistoryEntry[], rules: NeedRateRule[],
    from: string, to: string, policy?: NeedsPolicy) {
    check(opening.state.observedAtSimulationTime === from && closing.state.observedAtSimulationTime === to,
        'Exact opening/closing needs boundaries required');
    check(digest(opening.binding) === digest(closing.binding) && !opening.terminal && (!closing.terminal || closing.terminal.at >= to),
        'Needs lifecycle does not cover the complete window');
    check(opening.playerTimeRevision === 0 ? opening.playerTimeDigest === null : history.some(entry =>
        entry.state.revision === opening.playerTimeRevision && entry.digest === opening.playerTimeDigest), 'Opening mode cursor missing');
    check(closing.playerTimeRevision === 0 ? closing.playerTimeDigest === null : history.some(entry =>
        entry.state.revision === closing.playerTimeRevision && entry.digest === closing.playerTimeDigest), 'Closing mode cursor missing');
    let presence = opening.presence, rest = opening.rest, until = opening.sleepUntil, recovery = opening.sleepRecoveryBasisPoints ?? 10000;
    let revision = opening.playerTimeRevision;
    let at = Date.parse(from);
    const totals = rules.map(rule => ({ needId: rule.needId, demand: 0n, recovery: 0n }));
    const fatigue = opening.state.values.find(row => row.needId === 'fatigue'), fatiguePolicy = policy?.needs.find(row => row.needId === 'fatigue');
    let fatigueValue = BigInt(fatigue?.value ?? 0), fatigueRemainder = BigInt(fatigue?.remainderNumerator ?? 0), fatigueDemand = 0n, fatigueRecovery = 0n;
    const advance = (target: string) => {
        const end = Date.parse(target);
        check(Number.isSafeInteger(end) && end >= at && Number.isSafeInteger(end - at), 'Invalid needs exposure boundary');
        while (at < end) {
            const sleeping = rest === 'sleeping' && (until === null || Date.parse(until) > at);
            const next = sleeping && until ? Math.min(end, Date.parse(until)) : end;
            for (const [index, rule] of rules.entries()) {
                let rate = presence === 'online' ? sleeping ? rule.onlineSleepingPerHour : rule.onlineAwakePerHour
                    : sleeping ? rule.offlineSleepingPerHour : rule.offlineAwakePerHour;
                if (rule.needId === 'fatigue' && sleeping && rate < 0) rate = applyHousingFatigueRecoveryRate(rate,
                    { tierId: 'sleep', fatigueRecoveryMultiplierBasisPoints: recovery, privateStorageSlots: 0, theftProtectionBasisPoints: 0 });
                check(Number.isSafeInteger(rate), 'Invalid needs rate');
                const amount = BigInt(next - at) * BigInt(rate);
                if (amount >= 0n) totals[index]!.demand += amount; else totals[index]!.recovery -= amount;
                if (rule.needId === 'fatigue' && fatiguePolicy) {
                    const numerator = fatigueRemainder + amount, delta = numerator / HOUR, raw = fatigueValue + delta;
                    const min = BigInt(fatiguePolicy.minimumValue), max = BigInt(fatiguePolicy.maximumValue);
                    const after = raw < min ? min : raw > max ? max : raw, applied = after - fatigueValue;
                    if (applied >= 0n) fatigueDemand += applied; else fatigueRecovery -= applied;
                    fatigueRemainder = after === raw && !(after === min && numerator < 0n || after === max && numerator > 0n) ? numerator - delta * HOUR : 0n;
                    fatigueValue = after;
                }
            }
            at = next;
        }
    };
    for (const entry of history.filter(entry => entry.state.revision > opening.playerTimeRevision && entry.state.updatedAt <= to)) {
        check(entry.profileDigest === opening.binding.clockProfileDigest && entry.state.updatedAt >= from,
            'Needs mode profile/boundary differs');
        advance(entry.state.updatedAt); presence = entry.state.presence; rest = entry.state.rest;
        until = entry.state.sleepContext?.access.validUntilSimulationTime ?? null;
        recovery = entry.state.sleepContext?.fatigueRecoveryMultiplierBasisPoints ?? 10000;
        revision = entry.state.revision;
    }
    advance(to);
    check(revision === closing.playerTimeRevision && presence === closing.presence && rest === closing.rest,
        'Closing needs mode cursor is stale');
    if (fatiguePolicy) { const end = closing.state.values.find(row => row.needId === 'fatigue');
        check(end && fatigueValue === BigInt(end.value) && fatigueRemainder === BigInt(end.remainderNumerator), 'Fatigue history does not replay to the closing state'); }
    return totals.map(row => {
        const initial = opening.state.values.find(value => value.needId === row.needId);
        check(initial, 'Opening need missing');
        return { needId: row.needId, opening: String(BigInt(initial.value) * HOUR + BigInt(Math.max(0, initial.remainderNumerator))),
            accrued: String(row.demand), potentialRecovery: String(row.recovery), unitDivisor: String(HOUR),
            appliedDemandPoints: row.needId === 'fatigue' && fatiguePolicy ? String(fatigueDemand) : null,
            appliedRecoveryPoints: row.needId === 'fatigue' && fatiguePolicy ? String(fatigueRecovery) : null };
    });
}

/** Internal projection only; HTTP accepts a scope, never these source values. */
export function projectNativeIntegration(scope: EvaluationScope, options: Pick<NativeIntegrationOptions, 'worldId'>, sources: NativeIntegrationSources) {
    const evidence: IntegrationEvidence[] = [], evidenceKeys = new Set<string>(), issues: string[] = [], selectedActors = new Set(scope.actorAgentIds);
    const add = (channel: string, recordId: string, record: unknown, actors: string[], time: string | null = null) => {
        const sourceDigest = digest(record), id = `native:${digest({ channel, recordId, sourceDigest })}`;
        check(!evidenceKeys.has(id), 'Duplicate native evidence'); evidenceKeys.add(id);
        evidence.push({ id, channel, recordId, sourceDigest, actorAgentIds: unique(actors), simulationTime: time,
            selected: actors.some(actor => selectedActors.has(actor)) && time !== null && within(scope, time), record }); return id;
    };
    const bound = (channel: string, id: string, worldId: string, clockId: string, profile: string) => {
        const valid = worldId === options.worldId && clockId === scope.clockId && profile === scope.clockProfileDigest;
        if (!valid) issues.push(`${channel}:${id}:world-or-clock-profile-mismatch`); return valid;
    };
    const applications = sources.nutrition.status === 'available' ? sources.nutrition.value.applications! : [];
    const lineage = sources.lineage.status === 'available' ? sources.lineage.value : null;
    const policyEvidence = sources.needs.status === 'available' ? add('needs-policy', 'pinned-rates',
        { policy: sources.needs.value.policy, dynamics: sources.needs.value.dynamics }, scope.actorAgentIds) : null;
    const watermarkEvidence = sources.nutrition.status === 'available' ? add('nutrition-watermark', 'closed-tick',
        { through: sources.nutrition.value.through, pending: sources.nutrition.value.pending }, scope.actorAgentIds, sources.nutrition.value.through?.simulationTime ?? null) : null;
    const food = applications.flatMap(app => {
        if (!bound('nutrition', app.actionId, app.binding.worldId, app.clock.clockId, app.clock.profileDigest)) return [];
        const id = add('nutrition', app.actionId, app, [app.binding.actorId], app.clock.simulationTime);
        const origin = lineage?.consumptions?.find(row => row.actionId === app.actionId);
        const originId = origin ? add('food-origin', app.actionId, origin, [app.binding.actorId], app.clock.simulationTime) : null;
        return [{ actionId: app.actionId, actorAgentId: app.binding.actorId, lifecycleId: app.binding.lifecycleId,
            units: app.quantity, hungerRelief: app.hungerRelief, origin: origin?.origin ?? 'unknown', internalSupply: origin?.internalSupply ?? 'unproven',
            selected: selectedActors.has(app.binding.actorId) && within(scope, app.clock.simulationTime), evidenceIds: [id, ...(originId ? [originId] : [])] }];
    });
    const actors = scope.actorAgentIds.map(actorAgentId => {
        const reasons: string[] = [], ids: string[] = [];
        if (policyEvidence) ids.push(policyEvidence); if (watermarkEvidence) ids.push(watermarkEvidence);
        const histories = sources.needs.status === 'available' ? sources.needs.value.histories.filter(row => row.binding.actorId === actorAgentId
            && row.binding.clockId === scope.clockId && row.binding.clockProfileDigest === scope.clockProfileDigest
            && row.history[0]!.state.observedAtSimulationTime <= scope.fromSimulationTime
            && (!row.current.terminal || row.current.terminal.at >= scope.toSimulationTime)) : [];
        if (histories.length !== 1) reasons.push('One exact lifecycle covering both boundaries is required');
        const lifecycle = histories.length === 1 ? histories[0]! : null;
        if (lifecycle && sources.needs.status === 'available' && sources.needs.value.histories.some(row => row.binding.actorId !== actorAgentId
            && selectedActors.has(row.binding.actorId) && row.binding.playerId === lifecycle.binding.playerId
            && row.history[0]!.state.observedAtSimulationTime <= scope.toSimulationTime
            && (!row.current.terminal || row.current.terminal.at >= scope.fromSimulationTime))) reasons.push('Selected actors alias the same native player');
        const opening = lifecycle?.history.filter(row => row.state.observedAtSimulationTime === scope.fromSimulationTime).at(-1);
        const closing = lifecycle?.history.filter(row => row.state.observedAtSimulationTime === scope.toSimulationTime).at(-1);
        if (!opening || !closing) reasons.push('Exact opening or closing needs snapshot missing');
        const modes = sources.modes.status === 'available' && lifecycle
            ? sources.modes.value.histories.find(row => row.playerId === lifecycle.binding.playerId)?.history ?? [] : undefined;
        if (!modes) reasons.push('Audited player-time history missing');
        let demand: ReturnType<typeof integrateNeedsDemand> | null = null;
        if (opening && closing && modes && sources.needs.status === 'available') {
            try { demand = integrateNeedsDemand(opening, closing, modes, sources.needs.value.dynamics.rules, scope.fromSimulationTime, scope.toSimulationTime, sources.needs.value.policy); }
            catch (error) { reasons.push(error instanceof Error ? error.message : 'Needs exposure invalid'); }
            for (const state of lifecycle!.history.filter(state => state.revision >= opening.revision && state.revision <= closing.revision))
                ids.push(add('needs', `${actorAgentId}:${state.binding.lifecycleId}:${state.revision}`, state, [actorAgentId], state.state.observedAtSimulationTime));
            for (const entry of modes.filter(entry => entry.state.revision >= opening.playerTimeRevision && entry.state.revision <= closing.playerTimeRevision))
                ids.push(add('player-time', `${entry.state.playerId}:${entry.state.revision}`, entry, [actorAgentId], entry.state.updatedAt));
        }
        const relief = food.filter(row => row.selected && row.actorAgentId === actorAgentId && row.lifecycleId === lifecycle?.binding.lifecycleId);
        if (food.some(row => row.selected && row.actorAgentId === actorAgentId && row.lifecycleId !== lifecycle?.binding.lifecycleId))
            reasons.push('Physiological application belongs to another lifecycle inside the selected window');
        const totalRelief = relief.reduce((sum, row) => sum + BigInt(row.hungerRelief), 0n);
        const internalRelief = relief.filter(row => row.internalSupply === 'verified').reduce((sum, row) => sum + BigInt(row.hungerRelief), 0n);
        ids.push(...relief.flatMap(row => row.evidenceIds));
        const hunger = demand?.find(row => row.needId === 'hunger');
        if (sources.nutrition.status !== 'available' || sources.nutrition.value.pending !== 0
            || !sources.nutrition.value.through || sources.nutrition.value.through.simulationTime < scope.toSimulationTime
            || sources.nutrition.value.through.clockId !== scope.clockId || sources.nutrition.value.through.profileDigest !== scope.clockProfileDigest)
            reasons.push('Native food delivery watermark/application coverage incomplete');
        if (!lineage || lineage.projection!.gaps.length || lineage.projection!.sourceGaps.length
            || relief.some(row => row.units > 0 && ['unknown', 'mixed'].includes(row.origin)))
            reasons.push('Food origin source missing or contains gaps');
        return { actorAgentId, lifecycleId: lifecycle?.binding.lifecycleId ?? null, status: reasons.length ? 'inconclusive' : 'verified', reasons,
            demand, hungerRelief: String(totalRelief), internalHungerRelief: String(internalRelief),
            denominator: hunger ? String(BigInt(hunger.opening) + BigInt(hunger.accrued)) : null,
            numerator: String(internalRelief * HOUR), unitDivisor: String(HOUR), evidenceIds: unique(ids) };
    });
    const completePopulationCoverage = actors.length === 4 && actors.every(row => row.status === 'verified') && !issues.length;
    const denominator = actors.every(row => row.denominator !== null) ? actors.reduce((sum, row) => sum + BigInt(row.denominator!), 0n) : null;
    const numerator = actors.reduce((sum, row) => sum + BigInt(row.numerator), 0n);
    const ratioStatus = completePopulationCoverage && denominator !== null && denominator > 0n && numerator <= denominator ? 'verified' : 'inconclusive';
    const production = sources.production.status === 'available' ? sources.production.value.flatMap(row => {
        const receipt = row.receipt; if (!receipt) return [];
        const a = receipt.action;
        if (!bound('production', a.actionId, a.worldId, receipt.clock.clockId, receipt.clock.profileDigest)) return [];
        const evidenceId = add('food-production', a.actionId, receipt, [a.actorId], receipt.clock.simulationTime);
        return [{ actionId: a.actionId, kind: a.kind, outcome: receipt.outcome, inputs: receipt.inputs, outputs: receipt.outputs,
            selected: selectedActors.has(a.actorId) && within(scope, receipt.clock.simulationTime), evidenceIds: [evidenceId] }];
    }) : [];
    const dependencies: { from: string; to: string; relation: string; evidenceIds: string[] }[] = [];
    for (const row of food.filter(row => row.selected)) {
        const origin = lineage?.consumptions?.find(app => app.actionId === row.actionId)?.lineage;
        for (const from of unique([...(origin?.gatherers ?? []), ...(origin?.cooks ?? [])])) if (from !== row.actorAgentId)
            dependencies.push({ from, to: row.actorAgentId, relation: 'food-final-use', evidenceIds: row.evidenceIds });
    }
    const reconciliation: { channel: string; operationId: string; intent: string; native: string; domain: string; status: string; evidenceIds: string[] }[] = [];
    if (sources.consumption.status === 'available') for (const row of sources.consumption.value) {
        const a = row.action;
        if (!bound('consumption', a.actionId, a.worldId, a.clockId, a.clockProfileDigest)) continue;
        const app = applications.find(app => app.actionId === a.actionId), receipt = row.result?.receipt;
        const id = add('consumption-intent-native', a.actionId, row, [a.actorId], receipt?.clock.simulationTime ?? null);
        reconciliation.push({ channel: 'consumption', operationId: a.actionId, intent: 'recorded', native: row.result?.outcome ?? 'pending',
            domain: app ? 'applied' : 'pending', status: app ? 'reconciled' : row.result ? 'native-committed/domain-pending' : 'intent-without-native', evidenceIds: [id] });
    }
    const equations: { operationId: string; asset: string; opening: string; inflow: string; outflow: string; closing: string; residual: string;
        status: string; evidenceIds: string[] }[] = [];
    const equation = (operationId: string, asset: string, opening: number, inflow: number, outflow: number, closing: number, ids: string[]) => {
        check([opening, inflow, outflow, closing].every(Number.isSafeInteger), 'Unsafe native balance equation');
        const residual = BigInt(opening) + BigInt(inflow) - BigInt(outflow) - BigInt(closing);
        equations.push({ operationId, asset, opening: String(opening), inflow: String(inflow), outflow: String(outflow), closing: String(closing),
            residual: String(residual), status: residual === 0n ? 'verified' : 'mismatch', evidenceIds: ids });
    };
    // Union keys preserves native effects whose domain projection did not commit (including a lost ACK).
    const rents = sources.rent.status === 'available' ? sources.rent.value : [], rentOrders = sources.rentalOrders.status === 'available' ? sources.rentalOrders.value : [];
    for (const id of unique([...rents, ...rentOrders].map(row => row.binding.intent.operationId))) {
        const native = rents.find(row => row.binding.intent.operationId === id), domain = rentOrders.find(row => row.binding.intent.operationId === id), i = (native ?? domain)!.binding.intent;
        if (!bound('rent', id, i.worldId, i.clockId, i.clockProfileDigest)) continue;
        const ids = [domain ? add('rent-intent', id, domain, [i.tenant.agentId, i.landlord.agentId]) : null,
            native ? add('rent-native', id, native, [i.tenant.agentId, i.landlord.agentId], native.clock.simulationTime) : null].filter((id): id is string => id !== null);
        const matches = native && domain && native.digest === domain.nativeDigest && foodDigest(native.binding) === foodDigest(domain.binding);
        const status = matches && (native.phase === 'paid' ? ['active', 'closed'].includes(domain.phase) : domain.phase === 'cancelled')
            ? 'reconciled' : native ? domain ? 'native-domain-mismatch' : 'native-without-domain' : 'intent-without-native';
        reconciliation.push({ channel: 'rent', operationId: id, intent: domain ? 'recorded' : 'missing', native: native?.phase ?? 'missing', domain: domain?.phase ?? 'missing', status, evidenceIds: ids });
        if (native?.phase === 'paid' && within(scope, native.clock.simulationTime) && [i.tenant.agentId, i.landlord.agentId].some(a => selectedActors.has(a))) {
            equation(id, `gp:player:${i.tenant.agentId}`, native.before.tenant, 0, i.amountGp, native.after.tenant, ids);
            equation(id, `gp:player:${i.landlord.agentId}`, native.before.landlord, i.amountGp, 0, native.after.landlord, ids);
            dependencies.push({ from: i.landlord.agentId, to: i.tenant.agentId, relation: 'paid-housing', evidenceIds: ids });
        }
    }
    const commerces = sources.commerce.status === 'available' ? sources.commerce.value : [], orders = sources.commerceOrders.status === 'available' ? sources.commerceOrders.value : [];
    for (const id of unique([...commerces, ...orders].map(row => row.binding.intent.operationId))) {
        const native = commerces.find(row => row.binding.intent.operationId === id), domain = orders.find(row => row.binding.intent.operationId === id), i = (native ?? domain)!.binding.intent;
        if (!bound('commerce', id, i.worldId, i.clockId, i.clockProfileDigest)) continue;
        const stamp = native?.trade ? sources.trades.status === 'available' ? sources.trades.value.find(t => t.event.eventId === native.trade!.eventId) : undefined : undefined;
        const nativeValid = native?.phase !== 'completed' || stamp?.stamp?.profileDigest === scope.clockProfileDigest && foodDigest(stamp.event) === foodDigest(native.trade);
        const time = stamp?.stamp?.simulationTime ?? null;
        const ids = [domain ? add('commerce-intent', id, domain, [i.worker.agentId, i.counterparty.agentId]) : null,
            native ? add('commerce-native', id, native, [i.worker.agentId, i.counterparty.agentId], time) : null,
            stamp ? add('native-trade', stamp.event.eventId, stamp, [i.worker.agentId, i.counterparty.agentId], time) : null].filter((id): id is string => id !== null);
        const matches = native && domain && native.digest === domain.nativeDigest && foodDigest(native.binding) === foodDigest(domain.binding);
        reconciliation.push({ channel: 'commerce', operationId: id, intent: domain ? 'recorded' : 'missing', native: native?.phase ?? 'missing', domain: domain?.phase ?? 'missing',
            status: !nativeValid ? 'native-trade-source-missing-or-mismatch' : matches && native.phase === domain.phase ? 'reconciled'
                : native ? 'native-domain-pending-or-mismatch' : 'intent-without-native', evidenceIds: ids });
        if (native?.phase === 'completed' && nativeValid && time && within(scope, time) && native.after
            && [i.worker.agentId, i.counterparty.agentId].some(actor => selectedActors.has(actor))) {
            const gp = i.quantity * i.unitPriceGp, sale = i.kind === 'sale';
            equation(id, `gp:player:${i.counterparty.agentId}`, native.before.counterparty.gp, sale ? 0 : gp, sale ? gp : 0, native.after.counterparty.gp, ids);
            equation(id, `item:${i.itemId}:player:${i.counterparty.agentId}`, native.before.counterparty.item, sale ? i.quantity : 0, sale ? 0 : i.quantity, native.after.counterparty.item, ids);
            dependencies.push({ from: sale ? `business:${i.businessId}` : i.counterparty.agentId,
                to: sale ? i.counterparty.agentId : `business:${i.businessId}`, relation: 'food-transfer', evidenceIds: ids });
        }
    }
    const kitchens = sources.kitchen.status === 'available' ? sources.kitchen.value : [], wips = sources.wip.status === 'available' ? sources.wip.value : [];
    for (const id of unique([...kitchens, ...wips].map(row => row.binding.intent.runId))) {
        const native = kitchens.find(row => row.binding.intent.runId === id), domain = wips.find(row => row.binding.intent.runId === id), i = (native ?? domain)!.binding.intent;
        if (!bound('kitchen', id, i.worldId, i.clockId, i.clockProfileDigest)) continue;
        const ids = [domain ? add('kitchen-intent', id, domain, [i.actorAgentId]) : null,
            native ? add('kitchen-native', id, native, [i.actorAgentId], native.clock.simulationTime) : null].filter((id): id is string => id !== null);
        const expected = native?.phase === 'returned-output' ? native.receipt?.outcome === 'cooked' ? 'completed' : 'burnt'
            : native?.phase === 'returned-input' ? 'cancelled' : 'prepared';
        reconciliation.push({ channel: 'kitchen', operationId: id, intent: domain ? 'recorded' : 'missing', native: native?.phase ?? 'missing', domain: domain?.phase ?? 'missing',
            status: domain && native && domain.phase === expected && foodDigest(domain.binding) === foodDigest(native.binding)
                && (expected === 'prepared' || domain.nativeDigest === native.digest) ? 'reconciled' : 'pending-or-mismatch', evidenceIds: ids });
    }
    const wages = sources.work.status === 'available' ? sources.work.value.filter(row => selectedActors.has(row.binding.request.assigneeAgentId)).map(({ binding, order }) => {
        const id = binding.workOrderId, reward = sources.rewards.status === 'available' ? sources.rewards.value.find(r => r.settlement_id === binding.settlementId) : undefined;
        const debit = sources.treasury.status === 'available' ? sources.treasury.value.reservations.find(r => r.settlement_id === binding.settlementId) : undefined;
        const ids = [add('work-intent', id, { binding, order }, [binding.request.assigneeAgentId]),
            reward ? add('native-wage', binding.settlementId, reward, [binding.request.assigneeAgentId]) : null,
            debit ? add('wage-debit', binding.settlementId, debit, [binding.request.assigneeAgentId]) : null].filter((id): id is string => id !== null);
        const nativePaid = reward?.status === 'committed' && reward.username === binding.username && reward.amount === binding.request.rewardGp
            && [reward.amount, reward.coins_before, reward.coins_after].every(value => Number.isSafeInteger(value) && value >= 0)
            && reward.amount > 0 && reward.coins_after - reward.coins_before === reward.amount;
        const paid = nativePaid && debit?.status === 'committed' && debit.amount_gp === reward.amount && debit.actor_kind === 'business'
            && debit.actor_id === order.business_id && order.wage_status === 'paid' && order.wage_settlement_id === binding.settlementId;
        const completionEvidence = binding.target.kind === 'cook'
            ? kitchens.find(row => binding.target.kind === 'cook' && row.binding.intent.runId === binding.target.kitchenRunId
                && row.binding.intent.batchId === binding.target.batchId && row.binding.intent.actorAgentId === binding.request.assigneeAgentId
                && row.binding.intent.username === binding.username && row.receipt?.action.actionId === order.evidence_id && row.phase === 'returned-output')
            : sources.trades.status === 'available' && binding.target.afterSequence <= sources.trades.value.length
                && (binding.target.afterSequence ? sources.trades.value[binding.target.afterSequence - 1]!.headHash : '0'.repeat(64)) === binding.target.afterHash
                ? sources.trades.value.find(row => binding.target.kind === 'delivery' && row.event.eventId === order.evidence_id
                && row.sequence > binding.target.afterSequence && ((row.event.fromUsername === binding.username && row.event.toUsername === binding.target.recipient
                    && row.event.toItems.length === 0 && row.event.fromItems.length === 1 && row.event.fromItems[0]!.id === 379 && row.event.fromItems[0]!.count === 1)
                    || (row.event.toUsername === binding.username && row.event.fromUsername === binding.target.recipient && row.event.fromItems.length === 0
                        && row.event.toItems.length === 1 && row.event.toItems[0]!.id === 379 && row.event.toItems[0]!.count === 1))) : undefined;
        if (completionEvidence) ids.push(add('work-native-completion', id, completionEvidence, [binding.request.assigneeAgentId]));
        return { workOrderId: id, settlementId: binding.settlementId, intent: String(order.status), native: reward?.status ?? 'missing',
            domain: String(order.wage_status), status: paid ? 'reconciled-payment' : nativePaid ? 'native-paid-domain-or-debit-pending' : 'unproved-payment',
            completionStatus: completionEvidence ? 'native-completion-bound' : 'unproved-native-completion',
            paidGp: paid ? String(reward.amount) : null, simulationTime: null, windowStatus: 'unplaced-no-native-simulation-stamp', evidenceIds: ids };
    }) : [];
    const custody = sources.custody.status === 'available' ? sources.custody.value.map(row => ({ escrowId: row.escrowId, username: row.username,
        location: ['held', 'settling', 'reconcile'].includes(row.status) ? 'protected-native-escrow' : row.status === 'committed' ? 'spent-or-transferred' : 'pending-or-released',
        status: row.status, assets: row.assets, countInCurrentEscrow: row.status === 'held',
        evidenceIds: [add('custody', row.escrowId, row, [])] })) : [];
    const sleep = sources.sleep.status === 'available' ? sources.sleep.value.flatMap(witness => {
        const native = rents.find(row => row.binding.intent.operationId === witness.operationId), i = native?.binding.intent;
        const modes = sources.modes.status === 'available' ? sources.modes.value.histories.find(row => row.playerId === witness.username)?.history : undefined;
        const time = modes?.find(entry => entry.state.sleepContext?.access.evidenceId === `housing:${witness.id}`
            && entry.state.sleepContext.access.sourceDigest === foodDigest(witness));
        const valid = native?.phase === 'paid' && witness.bindingDigest === native.binding.digest && witness.lifecycleId === i?.tenant.lifecycleId
            && witness.username === i.tenant.username && witness.clock.clockId === scope.clockId && witness.clock.profileDigest === scope.clockProfileDigest
            && witness.clock.simulationTime >= i.startsAt && witness.clock.simulationTime < i.endsAt
            && i.catalogs.native.beds.some(bed => bed.bedSlotId === i.bedSlotId && bed.x === witness.x && bed.z === witness.z && bed.level === witness.level)
            && time?.state.sleepContext?.access.validUntilSimulationTime === i.endsAt
            && time.state.sleepContext.startedAtSimulationTime === witness.clock.simulationTime;
        const id = add('housing-sleep', witness.id, witness, i ? [i.tenant.agentId] : [], witness.clock.simulationTime);
        return [{ witnessId: witness.id, operationId: witness.operationId, status: valid ? 'native-and-player-time-bound' : 'missing-or-mismatched-entitlement-or-mode', evidenceIds: [id] }];
    }) : [];
    const boundaryIds: string[] = [];
    const fares = sources.fares.status === 'available' ? sources.fares.value.flatMap(receipt => {
        if (!bound('native-fare', receipt.id, receipt.worldId, receipt.clock.clockId, receipt.clock.profileDigest)) return [];
        return [{ ...receipt, selected: within(scope, receipt.clock.simulationTime),
            evidenceIds: [add('native-fare', receipt.id, receipt, [receipt.actorId], receipt.clock.simulationTime)] }];
    }) : [];
    for (const name of ['openingAssets', 'closingAssets'] as const) {
        const source = sources[name];
        if (source.status === 'available') boundaryIds.push(add(name, source.value.simulationTime, source.value, scope.actorAgentIds, source.value.simulationTime));
    }
    const currentAssets = sources.currentAssets.status === 'available' ? sources.currentAssets.value.assets.map((row, index) => ({ ...row,
        evidenceIds: [add('current-asset', String(index), row, [])] })) : null;
    const boundaryEquations: { itemId: number; opening: string; inflow: string; outflow: string; closing: string; residual: string; status: string; evidenceIds: string[] }[] = [];
    if (sources.openingAssets.status === 'available' && sources.closingAssets.status === 'available') {
        const opening = sources.openingAssets.value, closing = sources.closingAssets.value;
        const itemIds = [...new Set([...opening.assets, ...closing.assets].map(row => row.itemId).concat([377, 379, 381, 995]))].sort((a, b) => a - b);
        for (const itemId of itemIds) {
            const total = (rows: typeof opening.assets) => rows.filter(row => row.itemId === itemId).reduce((sum, row) => sum + BigInt(row.count), 0n);
            let inflow = 0n, outflow = 0n;
            const ids = [...boundaryIds];
            if (sources.production.status === 'available') for (const { receipt } of sources.production.value) {
                if (!receipt || !within(scope, receipt.clock.simulationTime) || receipt.action.worldId !== options.worldId
                    || receipt.clock.clockId !== scope.clockId || receipt.clock.profileDigest !== scope.clockProfileDigest) continue;
                inflow += receipt.outputs.filter(row => row.itemId === itemId).reduce((n, row) => n + BigInt(row.quantity), 0n);
                outflow += receipt.inputs.filter(row => row.itemId === itemId).reduce((n, row) => n + BigInt(row.quantity), 0n);
                ids.push(...production.find(row => row.actionId === receipt.action.actionId)!.evidenceIds);
            }
            if (itemId === 379) for (const app of applications.filter(row => within(scope, row.clock.simulationTime)
                && row.binding.worldId === options.worldId && row.clock.clockId === scope.clockId && row.clock.profileDigest === scope.clockProfileDigest)) {
                outflow += BigInt(app.quantity); ids.push(...food.find(row => row.actionId === app.actionId)!.evidenceIds);
            }
            if (itemId === 995) for (const fare of fares.filter(row => row.selected)) {
                outflow += BigInt(fare.amountGp); ids.push(...fare.evidenceIds);
            }
            const start = total(opening.assets), end = total(closing.assets), residual = start + inflow - outflow - end;
            boundaryEquations.push({ itemId, opening: String(start), inflow: String(inflow), outflow: String(outflow), closing: String(end), residual: String(residual),
                status: itemId === 995 && sources.fares.status !== 'available' ? 'fare-source-unverified'
                    : residual === 0n ? 'closed-observed-equation' : 'mismatch', evidenceIds: unique(ids) });
        }
    }
    if (sources.journalHeads.status === 'available') add('native-source-heads', 'heads', sources.journalHeads.value, []);
    for (const row of production.filter(row => row.selected)) {
        const receipt = sources.production.status === 'available' ? sources.production.value.find(r => r.actionId === row.actionId)!.receipt! : null;
        if (!receipt) continue;
        for (const [asset, itemId] of [['raw', 377], ['cooked', 379], ['burnt', 381]] as const)
            equation(row.actionId, `item:${itemId}:native-operation`, receipt.before[asset], receipt.outputs.filter(o => o.itemId === itemId).reduce((n, o) => n + o.quantity, 0),
                receipt.inputs.filter(o => o.itemId === itemId).reduce((n, o) => n + o.quantity, 0), receipt.after[asset], row.evidenceIds);
    }
    for (const app of applications.filter(app => app.quantity === 1 && selectedActors.has(app.binding.actorId)
        && within(scope, app.clock.simulationTime) && app.receipt)) {
        const row = food.find(row => row.actionId === app.actionId);
        if (row) equation(app.actionId, `item:379:player:${app.binding.actorId}`, app.receipt!.before, 0, 1, app.receipt!.after, row.evidenceIds);
    }
    const definition = { schemaVersion: 1, artifactKind: 'native-society-integration-report', scope, worldId: options.worldId,
        needsExposure:projectNativeNeedsExposure(scope,options.worldId,sources),
        minimumFood:projectNativeFoodMinimum(scope,options.worldId,sources),
        minimumHousing:projectHousingMinimum(scope,options.worldId,sources.housingAccess),
        measurementStatus: 'partial-native-observations', completePopulationCoverage,
        bounds: { events: '(from,to]', exposure: '[from,to)', requiredActors: 4 },
        temporalScopes: { needsAndFood: 'selected four actor lifecycles in the requested simulation window',
            reconciliation: 'current source heads, including unplaced intents and pending projections',
            wages: 'selected actors; payment receipts without simulation stamps remain outside window totals',
            custody: 'current source locations; historical boundaries require frozen native database sets' },
        sources: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.status === 'available'
            ? { status: source.status, digest: source.digest } : source])) as IntegrationSourceSummary,
        sourceWatermarks: { nutrition: sources.nutrition.status === 'available' ? sources.nutrition.value.through : null,
            pendingApplications: sources.nutrition.status === 'available' ? sources.nutrition.value.pending : null,
            clock: sources.modes.status === 'available' ? sources.modes.value.clock : null,
            journalHeads: sources.journalHeads.status === 'available' ? sources.journalHeads.value : null },
        needs: { actors, internalHungerRelief: { status: ratioStatus, numerator: String(numerator), denominator: denominator === null ? null : String(denominator),
            basisPoints: ratioStatus === 'verified' ? String(numerator * 10000n / denominator!) : null,
            unit: 'hunger-points-rational', unitDivisor: String(HOUR), evidenceIds: unique(actors.flatMap(row => row.evidenceIds)) } },
        food: { applications: food.filter(row => row.selected), finalUses: food.filter(row => row.selected && row.units > 0), production: production.filter(row => row.selected),
            accounting: 'One physiological application per action; trade, kitchen issue/return and WIP mirrors are not production or final use' },
        wages, sleep, fares, reconciliation, dependencyGraph: { nodes: unique(dependencies.flatMap(row => [row.from, row.to])),
            edges: dependencies.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) },
        balances: { status: boundaryEquations.length ? boundaryEquations.some(row => row.status === 'mismatch') ? 'mismatch'
            : boundaryEquations.every(row => row.status === 'closed-observed-equation') ? 'observed-equations-close' : 'inconclusive' : 'inconclusive',
            opening: sources.openingAssets.status === 'available' ? sources.openingAssets.value : null,
            closing: sources.closingAssets.status === 'available' ? sources.closingAssets.value : null,
            currentAssets, boundaryEquations, operationEquations: equations, completeEconomicCoverage: false,
            reason: 'Only backend-selected frozen native databases with exact paused clock and all four needs bindings supply boundaries. Equation closure alone does not prove complete mutation coverage.' },
        custody: { current: custody, wipMirrorsCountedAsAdditionalAssets: false,
            inTransit: reconciliation.filter(row => ['kitchen', 'commerce'].includes(row.channel) && row.status !== 'reconciled')
                .map(row => ({ operationId: row.operationId, location: `${row.channel}:native-${row.native}:domain-${row.domain}`,
                    economicQuantity: 'requires-reconciliation; never add native custody and its domain mirror', evidenceIds: row.evidenceIds })),
            temporalScope: 'current independently consistent source; not historical opening/closing custody' },
        issues: unique(issues), evidence: evidence.sort((a, b) => a.id.localeCompare(b.id)), societyMinimumVerdict: 'inconclusive',
        limitations: ['Independent read transactions are not a cross-database atomic snapshot.',
            'All four selected actor lifecycles require exact needs boundaries and native delivery coverage; elapsed wall time never supplies a denominator.',
            'Wage receipts without a simulation stamp remain unplaced; paid GP is never counted inside the requested window.',
            'Native operation equations cannot certify missing economy-wide opening/closing balances.',
            'Food ancestry is fungible quantity lineage; mixed/unknown origins never become verified internal final use.'] };
    return { ...definition, digest: digest(definition) };
}
export function reportNativeIntegration(query: EvaluationScope, options: NativeIntegrationOptions) {
    const scope = validateEvaluationScope(query);
    if (scope.actorAgentIds.length !== 4) throw new NativeIntegrationError('Native integration requires exactly four explicit actors');
    const sources = collectNativeIntegrationSources(scope, options);
    // Publishers and their projections live in separate databases. Detect a moving source rather than mixing two heads.
    const after = collectNativeIntegrationSources(scope, options);
    if (digest(sources) !== digest(after)) throw new NativeIntegrationError('Native integration sources changed during collection; reload the report', 409);
    return projectNativeIntegration(scope, options, sources);
}
export function readNativeIntegrationEvidence(query: EvaluationScope, options: NativeIntegrationOptions, snapshot: string, evidenceId: string) {
    if (!/^[a-f0-9]{64}$/.test(snapshot) || !/^native:[a-f0-9]{64}$/.test(evidenceId)) throw new NativeIntegrationError('Invalid integration evidence reference');
    const report = reportNativeIntegration(query, options);
    if (report.digest !== snapshot) throw new NativeIntegrationError('Native integration source snapshot changed; reload the report', 409);
    const evidence = report.evidence.find(row => row.id === evidenceId);
    if (!evidence) throw new NativeIntegrationError('Native integration evidence not found', 404);
    return { snapshot, scope: report.scope, evidence };
}
