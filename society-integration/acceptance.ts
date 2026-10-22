import { acceptanceEvidenceDigest as digest } from '../server/gateway/admin/acceptance-bundle.js';

export const INTEGRATION_ACCEPTANCE_CASES = ['happy', 'empty-input', 'empty-gp', 'full-inventory', 'burnt-batch', 'too-high-price',
    'wrong-partner', 'wrong-tenant', 'receipt-replay-tamper', 'missing-source', 'death-during-work', 'engine-unavailable', 'gateway-unavailable',
    'uncertain-trade', 'wage-checkpoint-rollback', 'wage-projection-failure', 'wage-source-missing', 'wage-receipt-tamper', 'crash-reservation', 'crash-native-commit', 'crash-suspended-cook',
    'crash-domain-apply', 'crash-wage-commit', 'crash-rent-commit', 'crash-goal-update', 'crash-routine-update'] as const;
export interface IntegrationRegressionCase {
    caseId: string; fixtureDigest: string; worldId: string; nativeCheckpointDigest: string; evidenceFilesDigest: string;
    boundaries: readonly string[]; correlations: string[]; actors: { actorId: string; gp: number }[]; processKilled: boolean;
}
export function buildIntegrationRegressionBundle(input: { fixtureDigest: string; worldId: string; sourceDigest: string; baselineSeal: string;
    cases: IntegrationRegressionCase[] }) {
    for (const hash of [input.fixtureDigest, input.sourceDigest, input.baselineSeal]) if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid integration evidence digest');
    if (input.cases.length !== INTEGRATION_ACCEPTANCE_CASES.length || new Set(input.cases.map(c => c.caseId)).size !== input.cases.length)
        throw new Error('Integration regression requires every exact case once');
    for (const id of INTEGRATION_ACCEPTANCE_CASES) {
        const row = input.cases.find(c => c.caseId === id);
        if (!row || row.fixtureDigest !== input.fixtureDigest || row.worldId !== input.worldId || !/^[a-f0-9]{64}$/.test(row.nativeCheckpointDigest)
            || !/^[a-f0-9]{64}$/.test(row.evidenceFilesDigest) || row.processKilled !== id.startsWith('crash-') || row.actors.length !== 4 || new Set(row.actors.map(a => a.actorId)).size !== 4
            || row.actors.some(a => !Number.isSafeInteger(a.gp) || a.gp < 0) || row.boundaries.length < 4)
            throw new Error(`Integration regression case binding differs: ${id}`);
    }
    const body = { protocol: 'society-integration-regression-v1', scope: 'isolated-native-adapter-acceptance', eligibleForLiveAcceptance: false,
        fixtureDigest: input.fixtureDigest, worldId: input.worldId, sourceDigest: input.sourceDigest, baselineSeal: input.baselineSeal,
        cases: INTEGRATION_ACCEPTANCE_CASES.map(id => input.cases.find(c => c.caseId === id)!) };
    return { ...body, digest: digest(body) };
}
export function verifyIntegrationRegressionBundle(bundle: ReturnType<typeof buildIntegrationRegressionBundle>) {
    const { digest: hash, ...body } = bundle;
    if (digest(body) !== hash || body.protocol !== 'society-integration-regression-v1' || body.scope !== 'isolated-native-adapter-acceptance'
        || body.eligibleForLiveAcceptance !== false) throw new Error('Integration regression bundle differs');
    if (buildIntegrationRegressionBundle(body).digest !== hash) throw new Error('Integration regression case inventory differs');
    return true;
}
