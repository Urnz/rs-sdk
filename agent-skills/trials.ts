import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { SkillReference } from './types.js';
import type { SkillVerificationCheck } from './verifier.js';

export const SKILL_TRIAL_SCHEMA_VERSION = 1 as const;
export type SkillTrialStatus = 'ready' | 'running' | 'verification-passed' | 'verification-failed' | 'published' | 'cancelled';

export interface SkillTrial {
    schemaVersion: typeof SKILL_TRIAL_SCHEMA_VERSION;
    trialId: string;
    gapId: string;
    draft: SkillReference;
    targetVersion: string;
    testBotUsername: string;
    parameters: Record<string, string | number | boolean>;
    status: SkillTrialStatus;
    runIds: string[];
    verificationReportId: string | null;
    verificationChecks: SkillVerificationCheck[];
    createdAt: string;
    updatedAt: string;
    revision: number;
}

interface SkillTrialDocument {
    schemaVersion: typeof SKILL_TRIAL_SCHEMA_VERSION;
    revision: number;
    trials: SkillTrial[];
}

const writeTails = new Map<string, Promise<unknown>>();
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const STATUS_TRANSITIONS: Record<SkillTrialStatus, readonly SkillTrialStatus[]> = {
    ready: ['running', 'cancelled'],
    running: ['running', 'verification-passed', 'verification-failed', 'cancelled'],
    'verification-failed': ['running', 'verification-passed', 'verification-failed', 'cancelled'],
    'verification-passed': ['published', 'cancelled'],
    published: [], cancelled: []
};

function validateDocument(input: unknown): SkillTrialDocument {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Skill trial document must be an object');
    const value = input as SkillTrialDocument;
    if (value.schemaVersion !== SKILL_TRIAL_SCHEMA_VERSION || !Number.isInteger(value.revision) || !Array.isArray(value.trials)) {
        throw new Error('Skill trial document has an unsupported schema');
    }
    for (const trial of value.trials) {
        if (trial.schemaVersion !== SKILL_TRIAL_SCHEMA_VERSION || !/^[0-9a-f-]{36}$/i.test(trial.trialId)
            || !/^gap-[a-f0-9]{20}$/.test(trial.gapId) || !VERSION_PATTERN.test(trial.draft.version)
            || !VERSION_PATTERN.test(trial.targetVersion) || !/^[a-zA-Z0-9]{1,12}$/.test(trial.testBotUsername)
            || !STATUS_TRANSITIONS[trial.status] || !Array.isArray(trial.runIds)
            || !Array.isArray(trial.verificationChecks) || !Number.isInteger(trial.revision)) {
            throw new Error('Skill trial document contains an invalid trial');
        }
    }
    return value;
}

export class SkillTrialStore {
    private readonly path: string;

    constructor(path: string) { this.path = resolve(path); }

    async list(): Promise<SkillTrial[]> {
        return structuredClone((await this.read()).trials.sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || left.trialId.localeCompare(right.trialId)));
    }

    async get(trialId: string): Promise<SkillTrial | null> {
        const trial = (await this.read()).trials.find(entry => entry.trialId === trialId);
        return trial ? structuredClone(trial) : null;
    }

    async create(input: {
        gapId: string;
        draft: SkillReference;
        targetVersion: string;
        testBotUsername: string;
        parameters: Record<string, string | number | boolean>;
    }, now = new Date().toISOString()): Promise<SkillTrial> {
        if (!/^gap-[a-f0-9]{20}$/.test(input.gapId)) throw new Error('Invalid capability gap ID');
        if (!VERSION_PATTERN.test(input.draft.version) || !VERSION_PATTERN.test(input.targetVersion)) throw new Error('Invalid skill version');
        if (!/^[a-zA-Z0-9]{1,12}$/.test(input.testBotUsername)) throw new Error('Invalid test bot username');
        return this.serialize(async () => {
            const document = await this.read();
            if (document.trials.some(trial => trial.gapId === input.gapId && !['published', 'cancelled'].includes(trial.status))) {
                throw new Error('This capability gap already has an active test trial');
            }
            const trial: SkillTrial = {
                schemaVersion: SKILL_TRIAL_SCHEMA_VERSION, trialId: crypto.randomUUID(), gapId: input.gapId,
                draft: structuredClone(input.draft), targetVersion: input.targetVersion,
                testBotUsername: input.testBotUsername.toLowerCase(), parameters: structuredClone(input.parameters),
                status: 'ready', runIds: [], verificationReportId: null, verificationChecks: [],
                createdAt: now, updatedAt: now, revision: 1
            };
            document.trials.push(trial);
            document.revision++;
            await this.write(document);
            return structuredClone(trial);
        });
    }

    async transition(trialId: string, expectedRevision: number, status: SkillTrialStatus, patch: {
        runIds?: string[];
        verificationReportId?: string | null;
        verificationChecks?: SkillVerificationCheck[];
    } = {}, now = new Date().toISOString()): Promise<SkillTrial> {
        return this.serialize(async () => {
            const document = await this.read();
            const trial = document.trials.find(entry => entry.trialId === trialId);
            if (!trial) throw new Error('Skill trial not found');
            if (trial.revision !== expectedRevision) throw new Error('Skill trial changed; refresh and retry');
            if (!STATUS_TRANSITIONS[trial.status].includes(status)) throw new Error(`Invalid skill trial transition: ${trial.status} -> ${status}`);
            const runIds = patch.runIds ?? trial.runIds;
            if (runIds.some(id => !/^[0-9a-f-]{36}$/i.test(id)) || new Set(runIds).size !== runIds.length || runIds.length > 20) {
                throw new Error('Skill trial evidence run IDs are invalid');
            }
            if (patch.verificationReportId && !/^[0-9a-f-]{36}$/i.test(patch.verificationReportId)) {
                throw new Error('Skill trial verification report ID is invalid');
            }
            trial.status = status;
            trial.runIds = [...runIds];
            trial.verificationReportId = patch.verificationReportId === undefined
                ? trial.verificationReportId : patch.verificationReportId;
            trial.verificationChecks = structuredClone(patch.verificationChecks ?? trial.verificationChecks);
            trial.updatedAt = now;
            trial.revision++;
            document.revision++;
            await this.write(document);
            return structuredClone(trial);
        });
    }

    private async read(): Promise<SkillTrialDocument> {
        try { return validateDocument(JSON.parse(await readFile(this.path, 'utf8'))); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return { schemaVersion: SKILL_TRIAL_SCHEMA_VERSION, revision: 0, trials: [] };
            }
            throw error;
        }
    }

    private async write(document: SkillTrialDocument): Promise<void> {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        await rename(temporary, this.path);
    }

    private async serialize<T>(operation: () => Promise<T>): Promise<T> {
        const previous = writeTails.get(this.path) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(operation);
        writeTails.set(this.path, next);
        try { return await next; }
        finally { if (writeTails.get(this.path) === next) writeTails.delete(this.path); }
    }
}
