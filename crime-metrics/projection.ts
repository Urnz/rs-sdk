import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import type { ThievingProcedureKind, ThievingProcedureResult } from '../thieving-procedures/types.js';
import type { CrimeOutcomeCounts, CrimeOutcomeMetricProjection } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
const KINDS: ThievingProcedureKind[] = ['pickpocket', 'lockpick-door', 'container-theft', 'property-burglary'];

function counts(): CrimeOutcomeCounts { return { attempts: 0, succeeded: 0, failed: 0, blocked: 0 }; }
function add(count: CrimeOutcomeCounts, result: ThievingProcedureResult): void {
    count.attempts++;
    count[result]++;
}

/** Read-only projection over a caller-selected cohort. Authorization to view hidden outcomes is external. */
export function projectCrimeOutcomes(source: Pick<ThievingProcedureStore,
    'verifyAuditChain' | 'getOutcome' | 'listDiscoveries'>,
actorAgentIdInput: string, receiptIdsInput: readonly string[]): CrimeOutcomeMetricProjection {
    if (typeof actorAgentIdInput !== 'string' || !ID.test(actorAgentIdInput))
        throw new Error('actorAgentId is invalid');
    if (!Array.isArray(receiptIdsInput) || receiptIdsInput.length < 1 || receiptIdsInput.length > 1_000
        || receiptIdsInput.some(value => typeof value !== 'string' || !ID.test(value)))
        throw new Error('Receipt cohort is invalid');
    const receiptIds = [...receiptIdsInput];
    if (new Set(receiptIds).size !== receiptIds.length) throw new Error('Receipt cohort contains duplicates');
    if (!source.verifyAuditChain()) throw new Error('Thieving source audit chain is invalid');

    const byProcedure = Object.fromEntries(KINDS.map(kind => [kind, counts()])) as
        Record<ThievingProcedureKind, CrimeOutcomeCounts>;
    const outcomes = counts();
    const items = new Map<number, { itemId: number; itemName: string; quantity: number }>();
    let outcomesWithDiscovery = 0, outcomesWithDirectIdentification = 0,
        outcomesWithInferredIdentification = 0;
    for (const receiptId of receiptIds) {
        const receipt = source.getOutcome(receiptId);
        if (!receipt) throw new Error(`Thieving receipt ${receiptId} does not exist`);
        if (receipt.actorAgentId !== actorAgentIdInput)
            throw new Error('Receipt cohort contains another actor');
        add(outcomes, receipt.result);
        add(byProcedure[receipt.procedureKind], receipt.result);
        for (const item of receipt.transferredItems) {
            const previous = items.get(item.itemId);
            if (previous && previous.itemName !== item.itemName)
                throw new Error('Transferred item identity is inconsistent');
            const quantity = (previous?.quantity ?? 0) + item.quantity;
            if (!Number.isSafeInteger(quantity)) throw new Error('Transferred quantity exceeds safe range');
            items.set(item.itemId, { itemId: item.itemId, itemName: item.itemName, quantity });
        }
        const discoveries = source.listDiscoveries(receiptId);
        if (discoveries.length > 0) outcomesWithDiscovery++;
        if (discoveries.some(value => value.actorIdentification === 'direct'
            && value.suspectAgentId === actorAgentIdInput)) outcomesWithDirectIdentification++;
        if (discoveries.some(value => value.actorIdentification === 'inferred'
            && value.suspectAgentId === actorAgentIdInput))
            outcomesWithInferredIdentification++;
    }
    return { scope: 'selected-thieving-receipts', actorAgentId: actorAgentIdInput,
        sourceReceiptIds: receiptIds, outcomes, byProcedure, outcomesWithDiscovery,
        outcomesWithDirectIdentification, outcomesWithInferredIdentification,
        transferredItems: [...items.values()].sort((a, b) => a.itemId - b.itemId),
        unavailable: { income: 'no-verified-sale-or-net-proceeds-source',
            harm: 'no-verified-victim-loss-or-valuation-source',
            recidivism: 'no-complete-adjudicated-history-or-follow-up-window',
            prospectiveRisk: 'observed-discoveries-are-not-a-risk-probability' } };
}
