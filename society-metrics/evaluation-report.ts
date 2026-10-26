import type { DependencyOptions } from '../economic-dependency/index.js';
import { collectEconomicRiskEvidence } from '../economic-dependency/runtime.js';
import { societyMinimumDigest } from '../society-minimum/policy.js';
import { evaluateSocietyObservations, validateEvaluationScope, societyEvaluationContract,
    type EvaluationScope, type SocietyObservations } from './evaluation.js';
import { reportSelfSufficiency, type SelfSufficiencyOptions } from './report.js';
import { reportNativeIntegration } from './integration-report.js';
import type { NativeIntegrationOptions } from './integration-sources.js';
import { reportNativeFinance } from './native-finance.js';
import type { NativeFinanceOptions } from './finance-sources.js';
import { reportNativeOutcomes,type NativeOutcomeOptions } from './native-outcomes.js';
import { projectNativeMinimumAssessment } from './minimum-assessment.js';
import { loadSocietyMinimumContract } from '../society-minimum/contract.js';
import type { MinimumFrame } from '../society-minimum/assessment.js';

export interface SocietyEvaluationOptions extends SelfSufficiencyOptions { dependencies?: DependencyOptions; nativeIntegration?: NativeIntegrationOptions; nativeFinance?: NativeFinanceOptions; nativeOutcomes?: NativeOutcomeOptions;
    /** Backend-selected original run frame; never accepted from HTTP query/body. */
    minimumFrame?:MinimumFrame }

/** Read-only native facade. No uploaded observations, migration, clock advance or experiment dispatch. */
export function reportSocietyEvaluation(query: EvaluationScope, options: SocietyEvaluationOptions) {
    return collectSocietyEvaluation(query, options).evaluation;
}

/** Internal native collection, also used for exact receipt drill-down. No supplied report JSON. */
export function collectSocietyEvaluation(query: EvaluationScope, options: SocietyEvaluationOptions) {
    const scope = validateEvaluationScope(query);
    // Enforce export scope before the other native readers are opened.
    const outcomes = options.nativeOutcomes ? reportNativeOutcomes(scope,options.nativeOutcomes) : null;
    const integration = options.nativeIntegration && scope.actorAgentIds.length === 4 ? reportNativeIntegration(scope, options.nativeIntegration) : null;
    const selfSufficiency = reportSelfSufficiency(scope, options);
    const minimumContract=loadSocietyMinimumContract(options.configDirectory);
    if(minimumContract.digest!==selfSufficiency.bindings.contractDigest)throw Error('Minimum definition changed during native collection');
    const minimumAssessment=projectNativeMinimumAssessment(minimumContract,scope,outcomes,options.minimumFrame);
    const economic = collectEconomicRiskEvidence({ from: scope.fromSimulationTime, to: scope.toSimulationTime, basis: 'simulation',
        clockId: scope.clockId, clockProfileDigest: scope.clockProfileDigest }, options.dependencies);
    const economicRisk = economic.risk;
    const graph = economicRisk.dependencyGraph, nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const selected = new Set(scope.actorAgentIds), observations: SocietyObservations = {};
    const productionAvailable = graph.sources.production.status === 'available';
    const production = graph.nodes.filter(node => node.kind === 'event' && node.metadata.eventKind === 'committed-business-wip-step');
    const recipeReferences = new Map<string, unknown>();
    if (productionAvailable) {
        const byActor = new Map<string, Map<string, number>>();
        for (const edge of graph.edges.filter(edge => edge.relation === 'production-run-actor')) {
            const actor = nodes.get(edge.from)!, event = nodes.get(edge.to)!;
            // Only historically registered responsible agents are associated with the explicit actor selection.
            if (actor.kind !== 'agent' || !selected.has(actor.label)) continue;
            const stageId = `recipe-${societyMinimumDigest(event.metadata.recipe)}`;
            recipeReferences.set(stageId, event.metadata.recipe);
            const stages = byActor.get(actor.label) ?? new Map<string, number>();
            stages.set(stageId, (stages.get(stageId) ?? 0) + 1); byActor.set(actor.label, stages);
        }
        observations.specialization = [...byActor].map(([actorAgentId, stages]) => ({ actorAgentId,
            stages: [...stages].map(([stageId, count]) => ({ stageId, count })) }));
        observations.systemicRisk = { recordedProductionEvents: production.length,
            withdrawals: economicRisk.scenarios.filter(row => row.targetKind === 'agent' || row.targetKind === 'business')
                .map(row => ({ targetId: row.targetNodeId, lostProductionEvents: row.affectedProductionEventCount })) };
    }
    const finance = options.nativeFinance ? reportNativeFinance(scope, options.nativeFinance) : null;
    if (finance) Object.assign(observations, finance.observations);
    const calculation = evaluateSocietyObservations(scope, observations);
    const observedObjectives = calculation.objectives.filter(row => row.status === 'observed').length;
    const sources = { selfSufficiency: { digest: selfSufficiency.digest, sources: selfSufficiency.sources, bindings: selfSufficiency.bindings },
        economicRisk: { digest: economicRisk.digest, graphDigest: graph.digest, sources: graph.sources, eventCoverage: graph.eventCoverage } };
    const definition = { schemaVersion: 1, artifactKind: 'native-society-multi-objective-report',
        measurementStatus: observedObjectives ? 'partial-observed-channels' : 'inconclusive', scope,
        evidenceAuthority: 'native-readers-with-partial-coverage', contract: societyEvaluationContract(), calculation, sources,
        nativeIntegration: integration, nativeFinance: finance, nativeOutcomes: outcomes,minimumAssessment,
        metricScopes: { specialization: 'selected-registered-responsible-agents-in-observed-production',
            mobility: 'matched-opening-closing-native-cohort; GP-only-personal-cash',
            wealth: 'GP-only-personal-physical-and-custodial-cash; company-equity/claims/debt/noncash-separate',
            prices: 'fixed-world-basket; exact-rational-unit-prices-from-verified-cash-for-one-item-trades',
            systemicRisk: 'all-observed-agent-and-business-withdrawals-against-observed-world-production',
            selfSufficiency: 'explicit-selected-actors; partial-observations-without-complete-demand-or-origin-history' },
        evidence: { recipeReferences: [...recipeReferences].sort(([a], [b]) => a.localeCompare(b)).map(([stageId, recipe]) => ({ stageId, recipe })),
            productionEvents: production.map(node => ({ nodeId: node.id, evidenceId: node.metadata.evidenceId })),
            withdrawals: productionAvailable ? economicRisk.scenarios.filter(row => row.targetKind === 'agent' || row.targetKind === 'business').map(row => ({
                targetNodeId: row.targetNodeId, affectedProductionEventCount: row.affectedProductionEventCount, affectedEvidenceIds: row.affectedEvidenceIds })) : [] },
        selfSufficiencyObservations: { food: selfSufficiency.food, tools: selfSufficiency.tools, housing: selfSufficiency.housing, inputs: selfSufficiency.inputs },
        unavailableReasons: {
            survival: 'No exact opening-cohort/end-survival reader in this facade; admissions and current headcounts are not founder survival.',
            'self-sufficiency': 'Existing readers expose diagnostic observations, not complete internal final-use/demand denominators.',
            mobility: observations.mobility ? undefined : 'No matched opening/closing native wealth history for the selected cohort.',
            'wealth-distribution': observations.wealth ? undefined : 'No matched GP-only native wealth boundaries; debt and noncash valuation remain separate.',
            'price-stability': observations.prices ? undefined : 'No complete fixed-basket opening/closing verified unit-price series; quantities and transfers are not prices.',
            unemployment: 'No available-and-willing person-time history; offline or skill-idle does not prove unemployment.',
            'innovation-investment': 'No native commissioning/capital-expense history; production, XP and recipe availability do not prove innovation.',
            crime: 'No complete window/cohort victimization and at-risk exposure source; discoveries do not prove true incidence.' },
        totalScore: null, societyMinimumVerdict: minimumAssessment.verdict, completePopulationCoverage: false,
        limitations: [...selfSufficiency.limitations, ...economicRisk.limitations,
            'Specialization counts recorded recipe-stage responsibilities, not physical worker execution, productive efficiency or opportunity.',
            'Systemic risk describes the observed economic window, not only the selected cohort and not future adaptive behavior.',
            'Missing/unplaced/legacy events remain missing; an empty native source does not prove absence of activity.',
            'No shared cross-database snapshot, complete founder history, empirical treatment comparison or functioning-society claim.'] };
    return { evaluation: { ...definition, digest: societyMinimumDigest(definition) }, economic };
}
