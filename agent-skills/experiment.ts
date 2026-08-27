#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { runSkillDiscoveryExperiment } from './discovery-experiment';
import { SkillLibrary } from './library';
import { SkillRegistry } from './registry';
import { FileSkillStore } from './store';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const integerOption = (name: string): number | undefined => {
    const value = option(name);
    return value === undefined ? undefined : Number(value);
};

const registry = new SkillRegistry();
const library = new SkillLibrary(registry, new FileSkillStore(join(process.cwd(), '.local', 'agent-skills')));
await library.loadReviewedCatalog(join(process.cwd(), 'agent-skills', 'catalog'));
const report = runSkillDiscoveryExperiment(registry, {
    seed: option('seed'),
    agentCount: integerOption('agents'),
    tasksPerAgent: integerOption('tasks'),
    trials: integerOption('trials'),
    discoveryCostMultiplier: integerOption('discovery-multiplier'),
    skillIds: option('skills')?.split(',').map(value => value.trim()).filter(Boolean)
});
const requestedOutput = option('output');
const output = resolve(requestedOutput ?? join(
    process.cwd(), '.local', 'admin', 'experiments',
    `skill-discovery-${new Date().toISOString().replace(/[:.]/g, '-')}-${report.workloadFingerprint.slice(0, 10)}.json`
));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: requestedOutput ? 'wx' : 'w' });
console.log(JSON.stringify({ output, workloadFingerprint: report.workloadFingerprint, summary: report.summary }, null, 2));
