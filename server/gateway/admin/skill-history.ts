import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillEvent, SkillRunStatus } from '../../../agent-skills/types';
import { skillRunsDir } from './paths';

export interface AdminSkillRun {
    runId: string;
    username: string | null;
    skill: { id: string; version: string };
    status: SkillRunStatus;
    reason: string;
    message: string;
    operations: number;
    durationMs: number;
    startedAt: string;
    finishedAt: string;
    events: SkillEvent[];
}

const statuses = new Set<SkillRunStatus>(['completed', 'failed', 'cancelled', 'limit-reached']);

function parseRun(value: unknown): AdminSkillRun | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const skill = raw.skill as Record<string, unknown> | undefined;
    const events = Array.isArray(raw.events) ? raw.events.filter(event => event && typeof event === 'object') as SkillEvent[] : [];
    const first = events[0]?.timestamp;
    const last = events.at(-1)?.timestamp;
    if (typeof raw.runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.runId)
        || !skill || typeof skill.id !== 'string' || typeof skill.version !== 'string'
        || typeof raw.status !== 'string' || !statuses.has(raw.status as SkillRunStatus)
        || typeof first !== 'string' || typeof last !== 'string') return null;
    const username = typeof raw.username === 'string' && /^[a-zA-Z0-9]{1,12}$/.test(raw.username) ? raw.username.toLowerCase() : null;
    return {
        runId: raw.runId,
        username,
        skill: { id: skill.id, version: skill.version },
        status: raw.status as SkillRunStatus,
        reason: typeof raw.reason === 'string' ? raw.reason : '',
        message: typeof raw.message === 'string' ? raw.message : '',
        operations: Number.isInteger(raw.operations) ? Number(raw.operations) : 0,
        durationMs: Number.isFinite(raw.durationMs) ? Math.max(0, Number(raw.durationMs)) : 0,
        startedAt: first,
        finishedAt: last,
        events: events.slice(-40)
    };
}

export async function readSkillRunHistory(limit = 30, root = skillRunsDir): Promise<AdminSkillRun[]> {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 30));
    const files = (await readdir(root).catch(() => []))
        .filter(file => /^[0-9a-f-]{36}\.json$/i.test(file))
        .slice(0, 500);
    const runs = await Promise.all(files.map(async file => {
        try {
            const contents = await readFile(join(root, file), 'utf8');
            if (contents.length > 1_000_000) return null;
            return parseRun(JSON.parse(contents));
        } catch {
            return null;
        }
    }));
    return runs.filter((run): run is AdminSkillRun => !!run)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .slice(0, boundedLimit);
}
