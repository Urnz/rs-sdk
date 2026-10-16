import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { reportSocietyEvaluation, societyEvaluationContract } from '../society-metrics/index.js';
import { defaultDependencyOptions } from '../economic-dependency/index.js';

const { values } = parseArgs({ options: { contract: { type: 'boolean', default: false },
    from: { type: 'string' }, to: { type: 'string' }, actor: { type: 'string', multiple: true },
    'clock-id': { type: 'string' }, 'clock-profile-digest': { type: 'string' },
    food: { type: 'string' }, tools: { type: 'string' }, housing: { type: 'string' },
    'engine-trades': { type: 'string' }, production: { type: 'string' }, agents: { type: 'string' }, clock: { type: 'string' } } });
const defaults = defaultDependencyOptions();
console.log(JSON.stringify(values.contract ? societyEvaluationContract() : reportSocietyEvaluation({
    fromSimulationTime: values.from ?? '', toSimulationTime: values.to ?? '', actorAgentIds: values.actor ?? [],
    clockId: values['clock-id'] ?? '', clockProfileDigest: values['clock-profile-digest'] ?? '' }, {
    configDirectory: resolve(import.meta.dir, '../config'), sources: { food: values.food, tools: values.tools, housing: values.housing },
    dependencies: { enginePath: values['engine-trades'] ?? defaults.enginePath, productionPath: values.production ?? defaults.productionPath,
        agentPath: values.agents ?? defaults.agentPath, clockPath: values.clock ?? defaults.clockPath }
}), null, 2));
