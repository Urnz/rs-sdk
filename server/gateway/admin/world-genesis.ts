import { validateWorldGenesisJsonValue, validateWorldGenesisResult, WorldGenesisProvenanceStore, WorldGenesisRunStore,
    type WorldGenesisApplication, type WorldGenesisJsonValue, type WorldGenesisResult }
    from '../../../world-genesis/index.js';
import { worldGenesisProvenanceDbPath, worldGenesisRunDbPath } from './paths.js';

export interface WorldGenesisAdminPreview {
    ok: boolean;
    warnings: string[];
    checks: Array<{ key: string; ok: boolean; message: string }>;
}

export interface WorldGenesisAdminAdapter {
    /** Read-only verification. It must not create backups or mutate domain state. */
    preview(result: WorldGenesisResult): Promise<WorldGenesisAdminPreview>;
    /** Capture every rollback token before the first authoritative mutation. */
    prepare(result: WorldGenesisResult): Promise<{
        createdAtSimulationTime: string;
        rollbackToken: WorldGenesisJsonValue;
    }>;
    /** Apply the complete result idempotently and return a verified receipt. */
    apply(result: WorldGenesisResult, rollbackToken: WorldGenesisJsonValue): Promise<WorldGenesisJsonValue>;
    /** Restore authoritative state using only the persisted rollback material. */
    reset(result: WorldGenesisResult, rollbackToken: WorldGenesisJsonValue,
        applyReceipt: WorldGenesisJsonValue | null): Promise<WorldGenesisJsonValue>;
}

export interface WorldGenesisAdminPaths {
    runDbPath?: string;
    provenanceDbPath?: string;
}

function paths(input: WorldGenesisAdminPaths): Required<WorldGenesisAdminPaths> {
    return { runDbPath: input.runDbPath ?? worldGenesisRunDbPath,
        provenanceDbPath: input.provenanceDbPath ?? worldGenesisProvenanceDbPath };
}

function confirmation(result: WorldGenesisResult, confirmationDigest: string): void {
    if (confirmationDigest !== result.resultDigest) {
        throw new Error('Genesis start/reset requires the exact preview result digest');
    }
}

function simulationTimestamp(value: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
        throw new Error('Genesis adapter returned an invalid simulation timestamp');
    }
    return value;
}

export async function previewAdminWorldGenesis(resultInput: WorldGenesisResult,
    adapter: WorldGenesisAdminAdapter): Promise<{ simulation: true; confirmationDigest: string;
        result: WorldGenesisResult; preview: WorldGenesisAdminPreview }> {
    const result = validateWorldGenesisResult(resultInput);
    const preview = await adapter.preview(result);
    if (!preview || typeof preview.ok !== 'boolean' || !Array.isArray(preview.warnings)
        || preview.warnings.some(item => typeof item !== 'string') || !Array.isArray(preview.checks)
        || preview.checks.some(item => !item || typeof item.key !== 'string' || typeof item.ok !== 'boolean'
            || typeof item.message !== 'string')) throw new Error('Genesis adapter returned an invalid preview');
    return { simulation: true, confirmationDigest: result.resultDigest, result, preview };
}

export async function startAdminWorldGenesis(resultInput: WorldGenesisResult, confirmationDigest: string,
    adapter: WorldGenesisAdminAdapter, inputPaths: WorldGenesisAdminPaths = {},
    now = new Date().toISOString()): Promise<WorldGenesisApplication> {
    const result = validateWorldGenesisResult(resultInput);
    confirmation(result, confirmationDigest);
    const resolved = paths(inputPaths), runs = new WorldGenesisRunStore(resolved.runDbPath);
    try {
        const existing = runs.get(result.resultId);
        if (existing?.status === 'applied') return existing;
        if (existing) throw new Error(`Genesis result requires recovery from ${existing.status}`);
        const prepared = await adapter.prepare(result);
        const rollbackToken = validateWorldGenesisJsonValue(prepared.rollbackToken, 'Genesis rollback token');
        const createdAtSimulationTime = simulationTimestamp(prepared.createdAtSimulationTime);
        let application = runs.begin(result, rollbackToken, now);
        try {
            const receipt = validateWorldGenesisJsonValue(await adapter.apply(result, rollbackToken),
                'Genesis apply receipt');
            const provenance = new WorldGenesisProvenanceStore(resolved.provenanceDbPath);
            try { provenance.recordResult(result, createdAtSimulationTime, now); }
            finally { provenance.close(); }
            application = runs.finishApply(result.resultId, application.revision, receipt, now);
            return application;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            runs.requireRollback(result.resultId, application.revision, message, now);
            throw new Error(`Genesis apply is incomplete and requires reset: ${message}`);
        }
    } finally { runs.close(); }
}

export async function resetAdminWorldGenesis(resultId: string, expectedRevision: number,
    confirmationDigest: string, adapter: WorldGenesisAdminAdapter, inputPaths: WorldGenesisAdminPaths = {},
    now = new Date().toISOString()): Promise<{ application: WorldGenesisApplication;
        resetReceipt: WorldGenesisJsonValue }> {
    const resolved = paths(inputPaths), runs = new WorldGenesisRunStore(resolved.runDbPath);
    try {
        const current = runs.get(resultId);
        if (!current) throw new Error('Genesis application does not exist');
        confirmation(current.result, confirmationDigest);
        let application = runs.beginReset(resultId, expectedRevision, now);
        try {
            const resetReceipt = validateWorldGenesisJsonValue(await adapter.reset(application.result,
                application.rollbackToken, application.applyReceipt), 'Genesis reset receipt');
            application = runs.finishReset(resultId, application.revision, now);
            return { application, resetReceipt };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            runs.requireRollback(resultId, application.revision, message, now);
            throw new Error(`Genesis reset is incomplete and requires recovery: ${message}`);
        }
    } finally { runs.close(); }
}

export function listAdminWorldGenesis(inputPaths: WorldGenesisAdminPaths = {}, limit = 50) {
    const runs = new WorldGenesisRunStore(paths(inputPaths).runDbPath);
    try { return runs.list(limit); } finally { runs.close(); }
}
