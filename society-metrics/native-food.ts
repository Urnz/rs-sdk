import { readPopulationFoodApplications, type PopulationNeedsOptions } from '../server/gateway/admin/needs-runtime.js';

/** Native quantity/relief only. An internally supplied food origin still requires SI-A05/SI-A12 lineage. */
export function readNativeNutritionMetrics(options: PopulationNeedsOptions, query: {
    clockId: string; clockProfileDigest: string; fromSimulationTime: string; toSimulationTime: string;
}) {
    const from = Date.parse(query.fromSimulationTime), to = Date.parse(query.toSimulationTime);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to
        || new Date(from).toISOString() !== query.fromSimulationTime || new Date(to).toISOString() !== query.toSimulationTime)
        throw new Error('Native nutrition metric window is invalid');
    const view = readPopulationFoodApplications(options);
    if (view.status === 'unavailable') return { status: 'unavailable' as const, units: null, hungerRelief: null,
        internalOrigin: 'unknown' as const, actionIds: [] as string[] };
    if (!view.through || view.through.clockId !== query.clockId || view.through.profileDigest !== query.clockProfileDigest)
        throw new Error('Native nutrition metric clock/profile mismatch');
    const events = view.applications!.filter(event => event.outcome === 'consumed' && event.clock.simulationTime >= query.fromSimulationTime
        && event.clock.simulationTime <= query.toSimulationTime);
    if (events.some(event => event.binding.worldId !== options.worldId || event.clock.clockId !== query.clockId
        || event.clock.profileDigest !== query.clockProfileDigest)) throw new Error('Native nutrition metric source mismatch');
    const hungerRelief = events.reduce((total, event) => total + event.hungerRelief, 0);
    if (!Number.isSafeInteger(hungerRelief)) throw new Error('Native nutrition metric overflow');
    // The journal proves observed events, not an invented zero history before its first observation.
    const observedFrom = view.applications!.at(0)?.clock.simulationTime ?? view.through.simulationTime;
    return { status: view.pending || view.through.simulationTime < query.toSimulationTime || query.fromSimulationTime < observedFrom
        ? 'inconclusive' as const : 'verified' as const,
        units: events.length, hungerRelief, internalOrigin: 'unknown' as const, actionIds: events.map(event => event.actionId) };
}
