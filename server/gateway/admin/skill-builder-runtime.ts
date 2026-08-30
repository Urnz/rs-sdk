import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SkillBuilderService, type SkillBuilderProvider, type SkillBuilderRunResult } from '../../../agent-skills/builder.js';
import { CapabilityGapStore } from '../../../agent-skills/capability-gaps.js';
import { OpenAISkillBuilderProvider } from '../../../agent-skills/openai-builder-provider.js';
import { FileSkillStore } from '../../../agent-skills/store.js';
import type { LlmRuntimeConfig } from '../../../llm-runtime/types.js';
import { listAdminSkills, type AdminSkillSummary } from './skill-catalog.js';
import { loadLlmRuntimeConfig, resolveOpenAIApiKey } from './llm-settings.js';
import { capabilityGapsPath, repoRoot, skillBuilderLedgerPath } from './paths.js';

export interface SkillBuilderLedgerEntry {
    timestamp: string;
    status: Exclude<SkillBuilderRunResult['status'], 'idle'>;
    gapId: string;
    costMicros: number;
    providerRequestId: string | null;
    reason: string | null;
}

export type GatewaySkillBuilderStatus = 'disabled' | 'waiting' | 'busy' | 'unavailable'
    | 'daily-limit' | SkillBuilderRunResult['status'];

export interface GatewaySkillBuilderResult {
    status: GatewaySkillBuilderStatus;
    reason: string;
    run: SkillBuilderRunResult | null;
    dailyCostMicros: number;
    nextAllowedAt: string | null;
}

export interface GatewaySkillBuilderDependencies {
    loadConfig(): Promise<LlmRuntimeConfig>;
    resolveApiKey(): Promise<string>;
    listSkills(): Promise<AdminSkillSummary[]>;
    createProvider(config: LlmRuntimeConfig, apiKey: string): SkillBuilderProvider;
    gaps: CapabilityGapStore;
    skills: FileSkillStore;
    ledgerPath: string;
}

let appendTail: Promise<void> = Promise.resolve();

export function appendSkillBuilderLedger(entry: SkillBuilderLedgerEntry,
    path = skillBuilderLedgerPath): Promise<void> {
    appendTail = appendTail.catch(() => undefined).then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
    });
    return appendTail;
}

export async function readSkillBuilderDailyCost(day: string, path = skillBuilderLedgerPath): Promise<number> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Skill Builder ledger day is invalid');
    try {
        const contents = await readFile(path, 'utf8');
        return contents.trim().split(/\r?\n/).filter(Boolean).reduce((sum, line) => {
            try {
                const entry = JSON.parse(line) as Partial<SkillBuilderLedgerEntry>;
                return typeof entry.timestamp === 'string' && entry.timestamp.startsWith(day)
                    && Number.isInteger(entry.costMicros) && entry.costMicros! >= 0 ? sum + entry.costMicros! : sum;
            } catch { return sum; }
        }, 0);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw error;
    }
}

function defaultDependencies(): GatewaySkillBuilderDependencies {
    return {
        loadConfig: async () => (await loadLlmRuntimeConfig()).config,
        resolveApiKey: async () => (await resolveOpenAIApiKey()).value,
        listSkills: listAdminSkills,
        createProvider: (config, apiKey) => new OpenAISkillBuilderProvider({ apiKey, model: config.model,
            prompt: config.skillBuilder.prompt, pricing: config.pricing!,
            maxOutputTokens: config.skillBuilder.maxOutputTokens, reasoningEffort: config.reasoningEffort }),
        gaps: new CapabilityGapStore(capabilityGapsPath),
        skills: new FileSkillStore(join(repoRoot, '.local', 'agent-skills')),
        ledgerPath: skillBuilderLedgerPath
    };
}

export class GatewaySkillBuilderScheduler {
    private running = false;
    private nextRunAt = 0;

    constructor(private readonly dependencies: GatewaySkillBuilderDependencies = defaultDependencies()) {}

    async tick(now = new Date().toISOString()): Promise<GatewaySkillBuilderResult> {
        const current = Date.parse(now);
        if (Number.isNaN(current)) throw new Error('Skill Builder scheduler time is invalid');
        if (this.running) return { status: 'busy', reason: 'A Skill Builder run is already active.', run: null,
            dailyCostMicros: 0, nextAllowedAt: null };
        const config = await this.dependencies.loadConfig();
        if (!config.skillBuilder.enabled) return { status: 'disabled', reason: 'Skill Builder is disabled.', run: null,
            dailyCostMicros: 0, nextAllowedAt: null };
        if (current < this.nextRunAt) return { status: 'waiting', reason: 'Skill Builder interval has not elapsed.', run: null,
            dailyCostMicros: 0, nextAllowedAt: new Date(this.nextRunAt).toISOString() };
        this.nextRunAt = current + config.skillBuilder.intervalMs;
        const dailyCostMicros = await readSkillBuilderDailyCost(now.slice(0, 10), this.dependencies.ledgerPath);
        if (dailyCostMicros >= config.skillBuilder.maxDailyCostMicros) {
            return { status: 'daily-limit', reason: 'Skill Builder daily cost limit reached.', run: null,
                dailyCostMicros, nextAllowedAt: new Date(this.nextRunAt).toISOString() };
        }
        const apiKey = await this.dependencies.resolveApiKey();
        if (!apiKey) return { status: 'unavailable', reason: 'OpenAI API key is not configured.', run: null,
            dailyCostMicros, nextAllowedAt: new Date(this.nextRunAt).toISOString() };
        this.running = true;
        try {
            const provider = this.dependencies.createProvider(config, apiKey);
            const service = new SkillBuilderService('skill-builder', this.dependencies.gaps, this.dependencies.skills,
                provider, { maxAttemptsPerGap: config.skillBuilder.maxAttemptsPerGap,
                    maxCostMicrosPerGap: Math.min(config.skillBuilder.maxCostMicrosPerGap,
                        config.skillBuilder.maxDailyCostMicros - dailyCostMicros),
                    cooldownMs: config.skillBuilder.cooldownMs, maxDurationMs: config.skillBuilder.maxDurationMs });
            const skills = await this.dependencies.listSkills();
            const run = await service.runNext(skills, now);
            if (run.status === 'idle') return { status: 'idle', reason: 'No eligible capability gap.', run,
                dailyCostMicros, nextAllowedAt: new Date(this.nextRunAt).toISOString() };
            await appendSkillBuilderLedger({ timestamp: now, status: run.status, gapId: run.gap.gapId,
                costMicros: run.costMicros, providerRequestId: run.status === 'draft-created' ? run.providerRequestId : null,
                reason: run.status === 'failed' ? run.reason : null }, this.dependencies.ledgerPath);
            return { status: run.status, reason: run.status === 'draft-created'
                ? `Draft ${run.draft.id}@${run.draft.version} created.` : run.reason,
            run, dailyCostMicros: dailyCostMicros + run.costMicros,
            nextAllowedAt: new Date(this.nextRunAt).toISOString() };
        } finally {
            this.running = false;
        }
    }
}
