import { readFile } from 'node:fs/promises';
import { JsonlLlmAuditSink } from '../../../llm-runtime/audit.js';
import { validateLlmRuntimeConfig } from '../../../llm-runtime/config.js';
import { ScriptedMockProvider } from '../../../llm-runtime/mock-provider.js';
import { LlmOrchestrator } from '../../../llm-runtime/orchestrator.js';
import { buildLlmPlanningInput } from '../../../llm-runtime/planning.js';
import type { LlmAuditSink, LlmProviderRequest, LlmProviderResponse } from '../../../llm-runtime/types.js';
import type { listAdminAgents } from './agent-state.js';
import type { AdminSkillSummary } from './skill-catalog.js';
import { llmAuditLogPath, llmRuntimeConfigPath } from './paths.js';

type AdminAgentView = Awaited<ReturnType<typeof listAdminAgents>>['agents'][number];

export interface AdminLlmDryRunOptions {
    now?: string;
    runId?: string;
    configPath?: string;
    audit?: LlmAuditSink;
}

function words(value: string): Set<string> {
    return new Set(value.toLocaleLowerCase('en-US').split(/[^\p{L}\p{N}]+/u)
        .map(entry => entry.trim()).filter(entry => entry.length >= 3));
}

function mockResponse(agent: AdminAgentView, request: LlmProviderRequest): LlmProviderResponse {
    const immediate = agent.goals.filter(goal => goal.status === 'active' && goal.horizon === 'immediate')
        .sort((left, right) => right.priority - left.priority || left.goalId.localeCompare(right.goalId))[0]!;
    const assigned = immediate.skill && request.tools[0].allowedSkills.find(skill => skill.id === immediate.skill!.id
        && skill.version === immediate.skill!.version);
    const goalWords = words(`${request.goal.title} ${request.goal.description}`);
    const ranked = request.tools[0].allowedSkills.map(skill => ({ skill, score: [...goalWords]
        .filter(word => `${skill.id} ${skill.name} ${skill.description}`.toLocaleLowerCase('en-US').includes(word)).length }))
        .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id)
            || left.skill.version.localeCompare(right.skill.version));
    const selected = assigned ?? (ranked[0]?.score ? ranked[0].skill : null);
    const output = selected ? {
        decision: 'select_skill', goalId: request.goal.goalId,
        tool: { name: 'execute_skill', arguments: { skillId: selected.id, version: selected.version } },
        reason: assigned ? 'The reviewed skill assigned to the immediate goal is available.'
            : 'This reviewed known skill has the strongest deterministic text match for the immediate goal.'
    } : { decision: 'abstain', goalId: request.goal.goalId,
        reason: 'No reviewed known skill has a sufficient deterministic match for this goal.' };
    return { output, usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
        providerRequestId: `mock:${request.runId}` };
}

export async function runAdminLlmDryRun(agent: AdminAgentView, skills: readonly AdminSkillSummary[],
    options: AdminLlmDryRunOptions = {}) {
    const rawConfig = JSON.parse(await readFile(options.configPath ?? llmRuntimeConfigPath, 'utf8')) as unknown;
    const configured = validateLlmRuntimeConfig(rawConfig);
    if (configured.provider !== 'mock') throw new Error('Az admin dry-run jelenleg kizárólag a mock providert támogatja.');
    const config = { ...configured, enabled: true };
    const input = buildLlmPlanningInput(agent, {
        availableSkills: skills.map(skill => ({ id: skill.id, version: skill.version,
            name: skill.name, description: skill.description })),
        context: {
            now: options.now,
            maxCharacters: 4000,
            episodicMemories: agent.relevantEpisodes.map(result => result.episode),
            semanticMemories: agent.relevantKnowledge.map(result => result.knowledge),
            socialMemories: agent.relevantRelationships,
            assets: agent.assets
        },
        runId: options.runId
    });
    const provider = new ScriptedMockProvider([request => mockResponse(agent, request)]);
    const orchestrator = new LlmOrchestrator(config, provider,
        options.audit ?? new JsonlLlmAuditSink(llmAuditLogPath));
    const plan = await orchestrator.plan(input);
    return {
        simulation: true,
        configuredEnabled: configured.enabled,
        plan,
        request: provider.requests[0] ?? null
    };
}
