import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { reportSelfSufficiency } from '../society-metrics/index.js';

const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' }, actor: { type: 'string', multiple: true },
    'clock-id': { type: 'string' }, food: { type: 'string' }, tools: { type: 'string' }, housing: { type: 'string' } } });
console.log(JSON.stringify(reportSelfSufficiency({ fromSimulationTime: values.from ?? '', toSimulationTime: values.to ?? '',
    actorAgentIds: values.actor ?? [], clockId: values['clock-id'] ?? '' }, { configDirectory: resolve(import.meta.dir, '../config'),
    sources: { food: values.food, tools: values.tools, housing: values.housing } }), null, 2));
