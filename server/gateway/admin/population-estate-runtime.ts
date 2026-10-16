import { join } from 'node:path';
import { loadEstatePolicy, type EstateRuntimeOptions } from '../../../population-estate/index.js';
import { repoRoot, agentStateDbPath, economicContractsDbPath, businessManagerDbPath, institutionTreasuryDbPath,
    governanceDbPath, populationHealthEngineEvidencePath, populationEstateDbPath, populationEstatePolicyPath } from './paths.js';
export function defaultEstateRuntimeOptions(): EstateRuntimeOptions {
    return { statePath: populationEstateDbPath, engineDeathPath: populationHealthEngineEvidencePath,
        policy: loadEstatePolicy(populationEstatePolicyPath), sources: {
            agents: agentStateDbPath, business: businessManagerDbPath, contracts: economicContractsDbPath,
            treasury: institutionTreasuryDbPath, banking: join(repoRoot,'.local','economy','banking.sqlite'),
            property: process.env.PROPERTY_STATE_DB ?? join(repoRoot,'.local','admin','properties.sqlite'),
            governance: governanceDbPath, escrow: process.env.PLAYER_CHECKPOINT_DATABASE ?? process.env.GE_DATABASE
                ?? join(repoRoot,'server','engine','data','player-checkpoints.sqlite') } };
}
