#!/usr/bin/env bun

import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runScript } from '../sdk/runner.js';
import { SkillExecutor } from '../agent-skills/executor.js';
import { FileSkillRunJournal } from '../agent-skills/journal.js';
import { SkillLibrary } from '../agent-skills/library.js';
import { SkillRegistry } from '../agent-skills/registry.js';
import { RsSdkSkillRuntime } from '../agent-skills/rs-sdk-runtime.js';
import { FileSkillStore } from '../agent-skills/store.js';
import type { RegisteredSkill, SkillRunResult } from '../agent-skills/types.js';
import { observeLiveState, runLivePlannerCycle } from './live.js';
import { AgentStateStore } from './store.js';

const positional = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const botName = positional[0];
const agentId = positional[1] ?? botName?.toLowerCase();
const execute = process.argv.includes('--execute');
if (!botName || !agentId) {
    console.error('Usage: bun agent-state/run.ts <bot-name> [agent-id] [--execute]');
    process.exit(2);
}

const result = await runScript(async ({ bot, sdk }) => {
    const store = new AgentStateStore(join(process.cwd(), '.local', 'agent-state', 'agents.sqlite'));
    try {
        const state = sdk.getState();
        if (!state || sdk.getStateAge() > 5000) throw new Error('A fresh live bot state is required');
        const registry = new SkillRegistry();
        const library = new SkillLibrary(registry, new FileSkillStore(join(process.cwd(), '.local', 'agent-skills')));
        await library.loadReviewedCatalog(join(process.cwd(), 'agent-skills', 'catalog'));
        await library.loadAgentDrafts(agentId);
        const available = registry.list({ status: 'verified', visibleToAgentId: agentId });
        const cycle = await runLivePlannerCycle({
            store, agentId, state,
            availableSkills: available.map(skill => ({ id: skill.definition.id, version: skill.definition.version })),
            executeSkill: execute ? skill => executeRegisteredSkill(botName, skill, registry.get(skill, agentId)!, bot, sdk) : undefined
        });
        console.log(JSON.stringify(cycle, null, 2));
        if (cycle.execution) {
            const finalState = sdk.getState();
            if (finalState) {
                const current = store.getWorkingMemory(agentId);
                const observed = observeLiveState(finalState);
                observed.observations = [`Skill ${cycle.execution.status}: ${cycle.execution.reason}`, ...observed.observations].slice(0, 12);
                store.setWorkingMemory(agentId, current?.revision ?? null, observed);
            }
        }
        return cycle;
    } finally {
        store.close();
    }
}, { timeout: 930_000 });

if (!result.success) process.exitCode = 1;

async function executeRegisteredSkill(botName: string, reference: { id: string; version: string },
    registered: RegisteredSkill, bot: ConstructorParameters<typeof RsSdkSkillRuntime>[0],
    sdk: ConstructorParameters<typeof RsSdkSkillRuntime>[1]): Promise<SkillRunResult> {
    if (!registered || registered.definition.status !== 'verified') throw new Error(`Verified skill disappeared: ${reference.id}@${reference.version}`);
    const markerDirectory = join(process.cwd(), '.local', 'admin', 'active-skills');
    const markerPath = join(markerDirectory, `${botName.toLowerCase()}.json`);
    const marker = { username: botName, skillId: reference.id, version: reference.version,
        runId: `pending-${crypto.randomUUID()}`, startedAt: new Date().toISOString(), pid: process.pid };
    await mkdir(markerDirectory, { recursive: true });
    await writeFile(markerPath, JSON.stringify(marker, null, 2), 'utf8');
    let result: SkillRunResult;
    try {
        result = await new SkillExecutor(new RsSdkSkillRuntime(bot, sdk)).execute(registered.definition, {
            onEvent: event => {
                if (marker.runId !== event.runId) {
                    marker.runId = event.runId;
                    void writeFile(markerPath, JSON.stringify(marker, null, 2), 'utf8');
                }
                console.log(`[planner] ${event.type}${event.stepId ? ` ${event.stepId}` : ''}${event.message ? ` - ${event.message}` : ''}`);
            }
        });
        result.username = botName.toLowerCase();
    } finally {
        await unlink(markerPath).catch(() => undefined);
    }
    const journalPath = await new FileSkillRunJournal(join(process.cwd(), '.local', 'agent-skills', 'runs')).save(result);
    console.log(`[planner] audit saved: ${journalPath}`);
    if (result.status !== 'completed') throw new Error(`Skill ended with ${result.status}: ${result.reason}`);
    return result;
}
