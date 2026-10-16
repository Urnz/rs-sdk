import { parseArgs } from 'node:util';
import { reportEconomicDependencies, reportEconomicRisk, defaultDependencyOptions } from '../economic-dependency/index.js';
const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' }, basis: { type: 'string', default: 'simulation' },
    'clock-id': { type: 'string' }, 'clock-profile-digest': { type: 'string' }, 'engine-trades': { type: 'string' },
    production: { type: 'string' }, agents: { type: 'string' }, clock: { type: 'string' }, risk: { type: 'boolean', default: false } } });
const defaults = defaultDependencyOptions();
const report = values.risk ? reportEconomicRisk : reportEconomicDependencies;
console.log(JSON.stringify(report({ from: values.from ?? '', to: values.to ?? '', basis: values.basis as 'wall' | 'simulation',
    clockId: values['clock-id'], clockProfileDigest: values['clock-profile-digest'] }, { enginePath: values['engine-trades'] ?? defaults.enginePath,
    productionPath: values.production ?? defaults.productionPath, agentPath: values.agents ?? defaults.agentPath, clockPath: values.clock ?? defaults.clockPath }), null, 2));
