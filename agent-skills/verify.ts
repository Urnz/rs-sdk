#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SkillLibrary } from './library';
import { SkillRegistry } from './registry';
import { FileSkillStore } from './store';
import { FileSkillVerificationJournal } from './verifier';
import type { SkillRunResult } from './types';

const args = process.argv.slice(2);
const positional = args.filter(arg => !arg.startsWith('--'));
const [agentId, requested, ...runIds] = positional;
const targetVersion = args.find(arg => arg.startsWith('--version='))?.slice('--version='.length);

if (!agentId || !requested || !targetVersion || runIds.length < 2) {
    console.error('Usage: bun agent-skills/verify.ts <agent-id> <draft-id@version> <run-id> <run-id> [...] --version=X.Y.Z [--param=name=value]');
    process.exit(2);
}

function parseValue(value: string): string | number | boolean {
    if (value === 'true') return true;
    if (value === 'false') return false;
    const number = Number(value);
    return value.trim() !== '' && Number.isFinite(number) ? number : value;
}

const parameters = Object.fromEntries(args.filter(arg => arg.startsWith('--param='))
    .map(arg => {
        const pair = arg.slice('--param='.length);
        const separator = pair.indexOf('=');
        if (separator <= 0) throw new Error(`Invalid parameter: ${arg}`);
        return [pair.slice(0, separator), parseValue(pair.slice(separator + 1))];
    }));

const root = join(process.cwd(), '.local', 'agent-skills');
const library = new SkillLibrary(new SkillRegistry(), new FileSkillStore(root));
await library.loadReviewedCatalog(join(process.cwd(), 'agent-skills', 'catalog'));
await library.loadAgentDrafts(agentId);
const separator = requested.lastIndexOf('@');
if (separator <= 0) throw new Error('Draft reference must use id@version');
const registered = library.registry.get({ id: requested.slice(0, separator), version: requested.slice(separator + 1) }, agentId);
if (!registered) throw new Error(`Draft not found or not visible to ${agentId}: ${requested}`);

const evidence: SkillRunResult[] = [];
for (const runId of runIds) {
    if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error(`Invalid run ID: ${runId}`);
    const run = JSON.parse(await readFile(join(root, 'runs', `${runId}.json`), 'utf8')) as SkillRunResult;
    if (run.runId !== runId) throw new Error(`Run journal identity mismatch: ${runId}`);
    evidence.push(run);
}
const outcome = await library.promoteAgentDraft(registered.definition, evidence, {
    targetVersion, parameters
});
const reportPath = await new FileSkillVerificationJournal(join(root, 'verifications')).save(outcome.report);
console.log(JSON.stringify({ ...outcome, reportPath }, null, 2));
if (!outcome.report.passed) process.exitCode = 1;
