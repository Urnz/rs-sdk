import { readFile } from 'node:fs/promises';
import { JsonlLlmAuditSink } from '../../../llm-runtime/audit.js';
import { validateLlmRuntimeConfig } from '../../../llm-runtime/config.js';
import { ScriptedMockProvider } from '../../../llm-runtime/mock-provider.js';
import { LlmOrchestrator } from '../../../llm-runtime/orchestrator.js';
import { buildLlmPlanningInput } from '../../../llm-runtime/planning.js';
import { InferenceQueue } from '../../../llm-runtime/queue.js';
import type { LlmAuditSink, LlmProviderRequest, LlmProviderResponse } from '../../../llm-runtime/types.js';
import type { listAdminAgents } from './agent-state.js';
import type { AdminSkillSummary } from './skill-catalog.js';
import { llmAuditLogPath, llmRuntimeConfigPath } from './paths.js';

type AdminAgentView = Awaited<ReturnType<typeof listAdminAgents>>['agents'][number];
const sharedAdminInferenceQueue = new InferenceQueue();

export interface AdminLlmDryRunOptions {
    now?: string;
    runId?: string;
    configPath?: string;
    audit?: LlmAuditSink;
    untrustedText?: readonly string[];
    queue?: InferenceQueue;
}

function words(value: string): Set<string> {
    return new Set(value.toLocaleLowerCase('en-US').split(/[^\p{L}\p{N}]+/u)
        .map(entry => entry.trim()).filter(entry => entry.length >= 3));
}

function mockResponse(agent: AdminAgentView, request: LlmProviderRequest): LlmProviderResponse {
    const anchor = agent.goals.find(goal => goal.goalId === request.goal.goalId)!;
    const assigned = anchor.skill && request.tools[0].allowedSkills.find(skill => skill.id === anchor.skill!.id
        && skill.version === anchor.skill!.version);
    const goalWords = words(`${request.goal.title} ${request.goal.description}`);
    const ranked = request.tools[0].allowedSkills.map(skill => ({ skill, score: [...goalWords]
        .filter(word => `${skill.id} ${skill.name} ${skill.description}`.toLocaleLowerCase('en-US').includes(word)).length }))
        .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id)
            || left.skill.version.localeCompare(right.skill.version));
    const preferred = agent.knownSkills.find(item => item.status === 'preferred' && request.tools[0].allowedSkills
        .some(skill => skill.id === item.skill.id && skill.version === item.skill.version));
    const matched = assigned ?? (ranked[0]?.score ? ranked[0].skill : null);
    const selected = request.mode === 'derive-immediate-goal'
        ? matched ?? (preferred ? request.tools[0].allowedSkills.find(skill => skill.id === preferred.skill.id
            && skill.version === preferred.skill.version) : null) ?? request.tools[0].allowedSkills[0] ?? null
        : matched;
    if (request.mode === 'derive-immediate-goal') {
        const remaining = anchor.horizon === 'life' ? ['long-term', 'current', 'immediate'] as const
            : anchor.horizon === 'long-term' ? ['current', 'immediate'] as const
                : ['immediate'] as const;
        let parentGoalId = anchor.goalId;
        const goals = remaining.map(horizon => {
            const suffix = horizon === 'long-term' ? 'strategy' : horizon === 'current' ? 'progress' : 'next-action';
            const goalId = `plan-${suffix}-${anchor.goalId}`.slice(0, 64).replace(/[.-]+$/, '');
            const title = (horizon === 'long-term' ? `Advance toward ${anchor.title}`
                : horizon === 'current' ? `Build measurable progress toward ${anchor.title}`
                    : selected ? `Use ${selected.name}` : `Find a practical next action for ${anchor.title}`).slice(0, 200);
            const goal = { goalId, parentGoalId, horizon, title,
                description: selected
                    ? `Make measurable progress toward "${anchor.title}" with the reviewed ${selected.name} skill.`.slice(0, 2000)
                    : `Identify a safe, measurable action that advances "${anchor.title}".`.slice(0, 2000),
                priority: anchor.priority };
            parentGoalId = goalId;
            return goal;
        });
        return { output: { decision: 'propose_goal_plan', goalId: request.goal.goalId, goals,
            tool: selected ? { name: 'execute_skill', arguments: { skillId: selected.id, version: selected.version } } : undefined,
            reason: selected ? 'The proposed goal chain turns the strategic objective into one reviewed executable skill.'
                : 'The proposed goal chain reaches an immediate objective, but no reviewed skill is currently available.' },
        usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 }, providerRequestId: `mock:${request.runId}` };
    }
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
        untrustedText: options.untrustedText,
        runId: options.runId
    });
    const provider = new ScriptedMockProvider([request => mockResponse(agent, request)]);
    const orchestrator = new LlmOrchestrator(config, provider,
        options.audit ?? new JsonlLlmAuditSink(llmAuditLogPath), options.queue ?? sharedAdminInferenceQueue);
    const plan = await orchestrator.plan(input);
    return {
        simulation: true,
        configuredEnabled: configured.enabled,
        plan,
        request: provider.requests[0] ?? null
    };
}
