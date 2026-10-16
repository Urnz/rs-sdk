import { digest, integer, type ExternalTradePolicy } from './policy.js';
import type { NativeTrade } from './source.js';
export interface TradeRun {
    runId: string; resultDigest: string; profile: { profileId: string; version: string; digest: string };
    clockId: string; clockProfileDigest: string; startedAtSimulationTime: string; startedAtWallTime: string;
    sourceBindingDigest: string;
    participants: Array<{ agentId: string; username: string }>; policy: ExternalTradePolicy;
    sourceStart: { sequence: number; headHash: string };
}
export interface TradeMeasurement {
    eventId: string; actorAgentId: string | null; counterpartyId: string | null; counterpartyUsername: string | null;
    kind: 'internal' | 'outside' | 'external' | 'unregistered-counterparty'; simulationTime: string | null;
    importedGp: number; exportedGp: number; items: Array<{ itemId: number; importedUnits: number; exportedUnits: number }>; issues: string[];
}
export const add = (a: number, b: number) => integer(a + b);
export function measureTrades(run: TradeRun, trades: NativeTrade[]): TradeMeasurement[] {
    const limits = new Map<string, { trades: number; importedGp: number; exportedGp: number; items: Map<number, { imported: number; exported: number }> }>();
    return trades.map(({ event, stamp }) => {
        const from = run.participants.find(item => item.username === event.fromUsername), to = run.participants.find(item => item.username === event.toUsername);
        const base: TradeMeasurement = { eventId: event.eventId, actorAgentId: null, counterpartyId: null, counterpartyUsername: null,
            kind: from && to ? 'internal' : 'outside', simulationTime: stamp?.simulationTime ?? null,
            importedGp: 0, exportedGp: 0, items: [], issues: [] };
        if (!!from === !!to) return base;
        const actor = from ?? to!, other = from ? event.toUsername : event.fromUsername,
            partner = run.policy.counterparties.find(item => item.username === other);
        base.kind = partner ? 'external' : 'unregistered-counterparty'; base.actorAgentId = actor.agentId;
        base.counterpartyUsername = other; base.counterpartyId = partner?.counterpartyId ?? null;
        if (!partner) base.issues.push('unregistered-counterparty');
        if (!stamp) base.issues.push('unbound-simulation-time');
        else {
            if (stamp.clockId !== run.clockId || stamp.profileDigest !== run.clockProfileDigest) base.issues.push('clock-profile-changed');
            const elapsed = Date.parse(stamp.simulationTime) - Date.parse(run.startedAtSimulationTime);
            if (elapsed < 0 || elapsed > run.policy.maximumSimulationMilliseconds) base.issues.push('outside-policy-time-window');
        }
        const quantities = new Map<number, { itemId: number; importedUnits: number; exportedUnits: number }>();
        for (const [items, direction] of [[from ? event.toItems : event.fromItems, 'import'], [from ? event.fromItems : event.toItems, 'export']] as const) {
            for (const item of items) {
                if (item.id === undefined) { base.issues.push('unidentified-item'); continue; }
                if (item.id === 995) {
                    if (direction === 'import') base.importedGp = add(base.importedGp, item.count);
                    else base.exportedGp = add(base.exportedGp, item.count);
                } else {
                    const quantity = quantities.get(item.id) ?? { itemId: item.id, importedUnits: 0, exportedUnits: 0 };
                    if (direction === 'import') quantity.importedUnits = add(quantity.importedUnits, item.count);
                    else quantity.exportedUnits = add(quantity.exportedUnits, item.count);
                    quantities.set(item.id, quantity);
                }
            }
        }
        base.items = [...quantities.values()].sort((a, b) => a.itemId - b.itemId);
        if (partner) {
            const used = limits.get(partner.counterpartyId) ?? { trades: 0, importedGp: 0, exportedGp: 0, items: new Map() };
            used.trades++; used.importedGp = add(used.importedGp, base.importedGp); used.exportedGp = add(used.exportedGp, base.exportedGp);
            if (used.trades > partner.maximumTrades) base.issues.push('trade-count-limit');
            if (used.importedGp > partner.maximumImportedGp) base.issues.push('import-gp-limit');
            if (used.exportedGp > partner.maximumExportedGp) base.issues.push('export-gp-limit');
            for (const item of base.items) {
                const total = used.items.get(item.itemId) ?? { imported: 0, exported: 0 }, limit = partner.items.find(row => row.itemId === item.itemId);
                total.imported = add(total.imported, item.importedUnits); total.exported = add(total.exported, item.exportedUnits); used.items.set(item.itemId, total);
                if (!limit) base.issues.push(`unlisted-item:${item.itemId}`);
                else {
                    if (total.imported > limit.maximumImportedUnits) base.issues.push(`import-item-limit:${item.itemId}`);
                    if (total.exported > limit.maximumExportedUnits) base.issues.push(`export-item-limit:${item.itemId}`);
                }
            }
            limits.set(partner.counterpartyId, used);
        }
        base.issues = [...new Set(base.issues)].sort(); return base;
    });
}
export function summarizeTradeWindow(run: TradeRun, trades: NativeTrade[], from: string, to: string) {
    const all = measureTrades(run, trades), boundary = all.filter(item => ['external', 'unregistered-counterparty'].includes(item.kind)),
        window = boundary.filter(item => item.simulationTime !== null && Date.parse(item.simulationTime) > Date.parse(from) && Date.parse(item.simulationTime) <= Date.parse(to)),
        untimed = boundary.filter(item => item.kind === 'external' && item.simulationTime === null),
        registered = window.filter(item => item.kind === 'external'), unregistered = window.filter(item => item.kind === 'unregistered-counterparty');
    function totals(events: TradeMeasurement[]) {
        const items = new Map<number, { itemId: number; importedUnits: number; exportedUnits: number }>();
        let importedGp = 0, exportedGp = 0;
        for (const event of events) {
            importedGp = add(importedGp, event.importedGp); exportedGp = add(exportedGp, event.exportedGp);
            for (const item of event.items) { const total = items.get(item.itemId) ?? { itemId: item.itemId, importedUnits: 0, exportedUnits: 0 };
                total.importedUnits = add(total.importedUnits, item.importedUnits); total.exportedUnits = add(total.exportedUnits, item.exportedUnits); items.set(item.itemId, total); }
        }
        return { exchanges: events.length, importedGp, exportedGp, netImportedGp: importedGp - exportedGp,
            items: [...items.values()].sort((a, b) => a.itemId - b.itemId) };
    }
    const definition = { schemaVersion: 1, artifactKind: 'external-trade-measurement', runId: run.runId,
        resultDigest: run.resultDigest, policyDigest: run.policy.digest, scope: { fromSimulationTime: from, toSimulationTime: to, eventBounds: '(start,end]' },
        coverage: 'registered-engine-player-trade-channel-only', assessment: boundary.some(item => item.issues.some(issue => !['unbound-simulation-time', 'unidentified-item'].includes(issue)))
            ? 'violations-observed' : boundary.some(item => item.issues.length) ? 'inconclusive' : 'no-observed-policy-violation',
        provesSelfSufficiency: false, observed: totals(registered), untimed: { ...totals(untimed), eventIds: untimed.map(item => item.eventId) },
        recordedRunTotals: { registeredExternal: totals(boundary.filter(item => item.kind === 'external')),
            unregisteredBoundary: totals(boundary.filter(item => item.kind === 'unregistered-counterparty')) },
        unregisteredBoundary: { timed: totals(unregistered), untimed: totals(boundary.filter(item => item.kind === 'unregistered-counterparty' && item.simulationTime === null)) },
        byCounterparty: [...new Set(registered.map(item => item.counterpartyUsername!))].sort().map(counterpartyUsername => ({ counterpartyUsername,
            ...totals(registered.filter(item => item.counterpartyUsername === counterpartyUsername)) })),
        byActor: run.participants.map(actor => ({ actorAgentId: actor.agentId, ...totals(registered.filter(item => item.actorAgentId === actor.agentId)) })),
        events: window, allObservedIssues: boundary.filter(item => item.issues.length).map(item => ({ eventId: item.eventId, issues: item.issues })),
        limitations: ['Not a native inventory/treasury mutation or an external-stock replenishment mechanism.',
            'No all-channel coverage or internal origin is inferred. Untimed trades are not assigned to a simulation window.',
            'GP is actual coin flow, not item valuation; barter has no invented exchange price.'] };
    return { ...definition, digest: digest(definition) };
}
