import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadSocietyMinimumContract } from '../society-minimum/contract.js';
import { societyMinimumDigest } from '../society-minimum/policy.js';
import { loadFoodLoopCatalog } from '../food-loop/catalog.js';
import { loadItemLifecycleCatalog } from '../item-lifecycle/catalog.js';
import { loadProductionToolCycleCatalog } from '../item-lifecycle/production-cycle.js';
import { loadItemRepairPolicyCatalog } from '../item-lifecycle/repair-policy.js';
import { validateHousingUnitCatalog } from '../housing/units.js';
import { foodObservations } from './food.js';
import { toolObservations } from './tools.js';
import { housingObservations, reservationCoverage } from './housing.js';
import { loadInputCategories, timestamp, integer, sum, ratio } from './policy.js';
import { readLedger, type LedgerSource, type MetricSourcePaths, type LedgerData } from './sources.js';

export interface SelfSufficiencyQuery { fromSimulationTime: string; toSimulationTime: string; actorAgentIds: string[]; clockId: string }
export interface SelfSufficiencyOptions { configDirectory: string; sources?: MetricSourcePaths }
function collect<T>(source: LedgerSource, read: (data: LedgerData) => T): { source: LedgerSource; observations: T | null } {
    if (source.status !== 'available') return { source, observations: null };
    try { return { source, observations: read(source.data) }; }
    catch (error) { return { source: { status: 'invalid', reason: error instanceof Error ? error.message : 'Invalid native evidence' }, observations: null }; }
}
function sourceView(source: LedgerSource) {
    if (source.status !== 'available') return source;
    return { status: source.status, headHash: source.data.headHash, entries: source.data.entries,
        snapshotDigest: source.data.snapshotDigest, temporalCoverage: 'partial' as const,
        limitations: ['No externally anchored tail watermark.', 'No complete run/clock-profile coverage certificate.'] };
}
const unknownShare = (reason: string) => ({ status: 'inconclusive' as const, numerator: null, denominator: null, basisPoints: null, reason });

/** Diagnostic observation over explicitly selected actors. It never certifies the Phase 24.1 society minimum. */
export function reportSelfSufficiency(query: SelfSufficiencyQuery, options: SelfSufficiencyOptions) {
    const from = timestamp(query.fromSimulationTime), to = timestamp(query.toSimulationTime);
    integer(to - from);
    if (from >= to || !Array.isArray(query.actorAgentIds) || query.actorAgentIds.length < 1 || query.actorAgentIds.length > 1000
        || query.actorAgentIds.some(actor => typeof actor !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(actor))
        || new Set(query.actorAgentIds).size !== query.actorAgentIds.length || typeof query.clockId !== 'string'
        || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(query.clockId))
        throw new Error('Invalid self-sufficiency scope/window');
    const actors = [...query.actorAgentIds].sort(), config = (name: string) => join(options.configDirectory, name),
        contract = loadSocietyMinimumContract(options.configDirectory), categories = loadInputCategories(config('self-sufficiency-inputs.json')),
        foodCatalog = loadFoodLoopCatalog(config('food-loops.json')), lifecycle = loadItemLifecycleCatalog(config('item-lifecycle.json')),
        cycles = loadProductionToolCycleCatalog(config('production-tool-cycles.json'), lifecycle), repairs = loadItemRepairPolicyCatalog(config('item-repair-policies.json'), lifecycle),
        housingCatalog = validateHousingUnitCatalog(JSON.parse(readFileSync(config('housing-units.json'), 'utf8')), contract.dependencies.housingHierarchy);
    const food = collect(readLedger('food', options.sources?.food), data => foodObservations(data, foodCatalog, query.clockId, contract.dependencies.needs)),
        tools = collect(readLedger('tools', options.sources?.tools), data => toolObservations(data, lifecycle, repairs)),
        housing = collect(readLedger('housing', options.sources?.housing), data => housingObservations(data, housingCatalog));
    const inWindow = (item: { at: number }) => item.at > from && item.at <= to;
    const foodMetrics = contract.dependencies.food.chains.flatMap(chain => actors.map(actor => {
        const events = food.observations?.filter(item => item.actor === actor && item.chainId === chain.foodChainId && inWindow(item));
        return { foodChainId: chain.foodChainId, actorAgentId: actor, recordedUnitsConsumed: events?.length ?? null,
            recordedEffectiveHungerRelief: events ? sum(events.map(item => item.effectiveRelief)) : null,
            evidence: events?.map(item => ({ closureId: item.closureId, closureDigest: item.closureDigest })) ?? [],
            internalFinalUseShare: unknownShare('Receipt hashes do not establish native final-use lineage or all hunger demand.'),
            usableReserveHours: null, reserveReason: 'No native boundary inventory/demand history.' };
    }));
    const toolMetrics = contract.dependencies.tools.cycles.flatMap(({ cycle, item }) => actors.map(actor => {
        const history = tools.observations?.filter(event => event.actor === actor && event.typeId === item.lifecycleTypeId);
        const events = history?.filter(inWindow);
        function capacity(at: number) {
            if (!history) return null;
            const latest = new Map<string, NonNullable<typeof history>[number]>();
            for (const event of history) if (event.at <= at) latest.set(event.instanceId, event);
            return sum([...latest.values()].map(event => event.retired ? 0 : Math.floor(event.after / item.wearPerUse) * cycle.outputQuantityPerAction));
        }
        const worn = events ? sum(events.filter(event => event.kind === 'used').map(event => event.before - event.after)) : null,
            restored = events ? sum(events.filter(event => event.kind === 'repaired').map(event => event.after - event.before)
                .concat(events.filter(event => event.kind === 'replaced').map(() => item.maxDurability))) : null;
        let cyclesWithResumedUse: number | null = history ? 0 : null;
        if (history && events) {
            const wornInstances = new Set<string>(), maintained = new Set<string>();
            for (const event of history) {
                if (event.at > to) continue;
                if (event.kind === 'used' && event.before > event.after) {
                    if (maintained.delete(event.instanceId) && inWindow(event)) cyclesWithResumedUse!++;
                    if (inWindow(event)) wornInstances.add(event.instanceId);
                }
                if (inWindow(event) && (event.kind === 'repaired' || event.kind === 'replaced') && wornInstances.delete(event.instanceId)) {
                    if (event.kind === 'repaired') maintained.add(event.instanceId);
                    else {
                        const replacement = tools.source.status === 'available'
                            ? tools.source.data.tables.item_replacement!.find(row => row.operation_id === event.operationId) : undefined;
                        if (replacement) maintained.add(replacement.replacement_item_instance_id);
                    }
                }
            }
        }
        const opening = capacity(from), closing = capacity(to);
        return { cycleId: cycle.cycleId, lifecycleTypeId: item.lifecycleTypeId, actorAgentId: actor,
            openingOutputCapacity: opening, closingOutputCapacity: closing,
            observedCapacityRetained: opening === null || closing === null ? null : closing >= opening,
            recordedWearDurability: worn, recordedRestoredDurability: restored,
            observedMaintenanceToWear: worn === null || restored === null ? null : ratio(restored, worn),
            cyclesWithResumedUse, repairs: events?.filter(event => event.kind === 'repaired').length ?? null,
            replacements: events?.filter(event => event.kind === 'replaced').length ?? null,
            evidenceOperationIds: events?.map(event => event.operationId) ?? [],
            internalMaintenanceShare: unknownShare('Input lots/successor production, requested service and source coverage are not established.') };
    }));
    const minimumRank = contract.dependencies.housingHierarchy.tiers.find(tier => tier.tierId === contract.policy.housing.minimumTierId)!.rank;
    const eligibleTiers = new Set(contract.dependencies.housingHierarchy.tiers.filter(tier => tier.rank >= minimumRank).map(tier => tier.tierId));
    // Include all reservations when checking conflicts, even if their tier is too low or actor is outside the queried cohort.
    const housingMetrics = housing.observations ? reservationCoverage(housing.observations, actors, from, to, eligibleTiers).map(row => {
        return { ...row,
            declaredInitialReservationCoverage: ratio(row.reservedMilliseconds, to - from),
            legalAccessShare: unknownShare('Reservation labels do not prove legal access, historical capacity or verified rest/recovery.') };
    }) : actors.map(actor => ({ actorAgentId: actor, reservedMilliseconds: null, reservationConflictObserved: null,
        declaredInitialReservationCoverage: null, legalAccessShare: unknownShare('Native housing history unavailable or invalid.') }));
    const inputAssociations = [
        ...(food.observations ?? []).filter(event => actors.includes(event.actor) && inWindow(event))
            .map(event => ({ itemId: event.rawItemId, quantity: 1, evidenceId: event.closureId, basis: 'food-final-use-closure' })),
        ...(tools.observations ?? []).filter(event => actors.includes(event.actor) && inWindow(event))
            .flatMap(event => event.materials.map(material => ({ ...material, evidenceId: event.operationId, basis: 'maintenance-policy-or-successor' })))
    ];
    const classified = new Set(categories.categories.flatMap(category => category.itemIds));
    const required = [...foodCatalog.chains.map(chain => chain.rawItem.itemId), ...repairs.policies.flatMap(policy => policy.materials.map(item => item.itemId)),
        ...contract.dependencies.tools.cycles.map(({ item }) => item.itemId)];
    if (required.some(item => !classified.has(item)) || inputAssociations.some(item => !classified.has(item.itemId)))
        throw new Error('Input taxonomy omits a configured food/maintenance input');
    const inputs = categories.categories.map(category => ({ categoryId: category.categoryId, items: category.itemIds.map(itemId => {
        const associations = inputAssociations.filter(item => item.itemId === itemId);
        return { itemId, associatedRequirementUnits: associations.length ? sum(associations.map(item => item.quantity)) : null,
            associations, internalSupplyShare: unknownShare('Association is not timed native input consumption or verified internal origin; no complete input coverage.') };
    }) }));
    const definition = { schemaVersion: 1 as const, artifactKind: 'society-self-sufficiency-metrics' as const,
        assessment: 'inconclusive' as const, claim: 'partial-native-ledger-observations' as const,
        scope: { ...query, actorAgentIds: actors, cohortAuthority: 'explicit-observation-selection', eventBounds: '(start,end]', intervalBounds: '[start,end)' },
        bindings: { contractDigest: contract.digest, inputCategoriesDigest: categories.digest, foodCatalogDigest: foodCatalog.digest,
            lifecycleCatalogDigest: lifecycle.digest, cycleCatalogDigest: cycles.digest, repairCatalogDigest: repairs.digest, housingCatalogDigest: housingCatalog.digest },
        sources: { food: sourceView(food.source), tools: sourceView(tools.source), housing: sourceView(housing.source) },
        food: foodMetrics, tools: toolMetrics, housing: housingMetrics, inputs,
        limitations: ['No complete coverage or immutable run/founder/clock-profile binding; this is not a society-minimum verdict.',
            'No internal/seed/import origin is inferred from matching item ids, a receipt hash, a transfer or a lease.',
            'DB snapshots are individually consistent, not a shared cross-database transaction.',
            'No stock reserve, lifetime need exposure, external-trade or dependency-graph claim.'] };
    return { ...definition, digest: societyMinimumDigest(definition) };
}
