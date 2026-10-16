import type { ThievingProcedureKind } from '../thieving-procedures/types.js';

export interface CrimeOutcomeCounts {
    attempts: number;
    succeeded: number;
    failed: number;
    blocked: number;
}

export interface CrimeOutcomeMetricProjection {
    /** Explicit receipt cohort, not a complete player history or a population sample. */
    scope: 'selected-thieving-receipts';
    actorAgentId: string;
    sourceReceiptIds: string[];
    outcomes: CrimeOutcomeCounts;
    byProcedure: Record<ThievingProcedureKind, CrimeOutcomeCounts>;
    /** Distinct outcomes with at least one persisted discovery. Neither count implies guilt. */
    outcomesWithDiscovery: number;
    outcomesWithDirectIdentification: number;
    outcomesWithInferredIdentification: number;
    /** Confirmed item movement, not sale proceeds, profit, or income. */
    transferredItems: Array<{ itemId: number; itemName: string; quantity: number }>;
    unavailable: {
        income: 'no-verified-sale-or-net-proceeds-source';
        harm: 'no-verified-victim-loss-or-valuation-source';
        recidivism: 'no-complete-adjudicated-history-or-follow-up-window';
        prospectiveRisk: 'observed-discoveries-are-not-a-risk-probability';
    };
}
