#!/usr/bin/env bun

import { join } from 'node:path';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { runScript } from '../sdk/runner';
import { FileSkillStore } from './store';
import { SkillRegistry } from './registry';
import { SkillLibrary } from './library';
import { SkillExecutor } from './executor';
import { RsSdkSkillRuntime } from './rs-sdk-runtime';
import { FileSkillRunJournal } from './journal';
import type { SkillRunResult } from './types';

const args = process.argv.slice(2);
const positional = args.filter(arg => !arg.startsWith('--'));
const botName = positional[0];
const requested = positional[1];
const allowDraft = args.includes('--allow-draft');

if (!botName || !requested) {
    console.error('Usage: bun agent-skills/run.ts <bot-name> <skill-id[@version]> [--allow-draft] [--param=name=value]');
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

const run = await runScript(async ({ bot, sdk }) => {
    const registry = new SkillRegistry();
    const library = new SkillLibrary(
        registry,
        new FileSkillStore(join(process.cwd(), '.local', 'agent-skills'))
    );
    await library.loadReviewedCatalog(join(process.cwd(), 'agent-skills', 'catalog'));
    await library.loadAgentDrafts(botName);

    const separator = requested.lastIndexOf('@');
    const registered = separator > 0
        ? registry.get({ id: requested.slice(0, separator), version: requested.slice(separator + 1) }, botName)
        : registry.getLatest(requested, { visibleToAgentId: botName });
    if (!registered) throw new Error(`Skill not found: ${requested}`);

    const markerDirectory = join(process.cwd(), '.local', 'admin', 'active-skills');
    const markerPath = join(markerDirectory, `${botName.toLowerCase()}.json`);
    const marker = {
        username: botName,
        skillId: registered.definition.id,
        version: registered.definition.version,
        runId: `pending-${crypto.randomUUID()}`,
        startedAt: new Date().toISOString(),
        pid: process.pid
    };
    await mkdir(markerDirectory, { recursive: true });
    await writeFile(markerPath, JSON.stringify(marker, null, 2), 'utf8');

    let result: SkillRunResult;
    try {
        result = await new SkillExecutor(new RsSdkSkillRuntime(bot, sdk)).execute(registered.definition, {
            parameters,
            allowDraft,
            onEvent: event => {
                if (marker.runId !== event.runId) {
                    marker.runId = event.runId;
                    void writeFile(markerPath, JSON.stringify(marker, null, 2), 'utf8');
                }
                console.log(`[skill] ${event.type}${event.stepId ? ` ${event.stepId}` : ''}${event.message ? ` - ${event.message}` : ''}`);
            }
        });
    } finally {
        await unlink(markerPath).catch(() => undefined);
    }
    const journalPath = await new FileSkillRunJournal(join(process.cwd(), '.local', 'agent-skills', 'runs')).save(result);
    console.log(`[skill] audit saved: ${journalPath}`);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'completed') throw new Error(`Skill ended with ${result.status}: ${result.reason}`);
    return result;
}, { timeout: 930_000 });

if (!run.success) process.exitCode = 1;
