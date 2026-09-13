import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditEntry } from './types';
import { auditLogPath } from './paths';

const ZERO_HASH = '0'.repeat(64);
const appendQueues = new Map<string, Promise<unknown>>();

export interface AuditChainVerification {
    valid: boolean;
    totalEntries: number;
    legacyEntries: number;
    chainedEntries: number;
    headHash: string;
    error: string | null;
}

function auditPayload(entry: AuditEntry): Record<string, unknown> {
    const { previousHash: _previousHash, entryHash: _entryHash, ...payload } = entry;
    return payload;
}

function digest(previousHash: string, entry: AuditEntry): string {
    return createHash('sha256').update(JSON.stringify({ previousHash, entry: auditPayload(entry) })).digest('hex');
}

async function auditEntries(path: string): Promise<{ entries: AuditEntry[]; malformed: boolean }> {
    try {
        const text = await readFile(path, 'utf8');
        let malformed = false;
        const entries = text.trim().split(/\r?\n/).filter(Boolean).flatMap(line => {
            try {
                const entry = JSON.parse(line) as AuditEntry;
                if (typeof entry.id !== 'string' || typeof entry.timestamp !== 'string') throw new Error('invalid');
                return [entry];
            } catch { malformed = true; return []; }
        });
        return { entries, malformed };
    } catch { return { entries: [], malformed: false }; }
}

export function verifyAuditEntries(entries: readonly AuditEntry[], malformed = false): AuditChainVerification {
    let headHash = ZERO_HASH, legacyEntries = 0, chainedEntries = 0, chainStarted = false;
    if (malformed) return { valid: false, totalEntries: entries.length, legacyEntries,
        chainedEntries, headHash, error: 'Audit log contains a malformed record.' };
    for (const entry of entries) {
        const chained = typeof entry.previousHash === 'string' || typeof entry.entryHash === 'string';
        if (!chained) {
            if (chainStarted) return { valid: false, totalEntries: entries.length, legacyEntries,
                chainedEntries, headHash, error: 'Legacy audit record appears after the hash chain started.' };
            legacyEntries++;
            continue;
        }
        chainStarted = true;
        if (entry.previousHash !== headHash || entry.entryHash !== digest(headHash, entry)) {
            return { valid: false, totalEntries: entries.length, legacyEntries, chainedEntries,
                headHash, error: `Audit chain mismatch at entry ${entry.id}.` };
        }
        headHash = entry.entryHash;
        chainedEntries++;
    }
    return { valid: true, totalEntries: entries.length, legacyEntries, chainedEntries, headHash, error: null };
}

export async function verifyAuditChain(path = auditLogPath): Promise<AuditChainVerification> {
    const parsed = await auditEntries(path);
    return verifyAuditEntries(parsed.entries, parsed.malformed);
}

export async function appendAudit(
    entry: Omit<AuditEntry, 'id' | 'timestamp' | 'previousHash' | 'entryHash'>,
    path = auditLogPath
): Promise<AuditEntry> {
    const previous = appendQueues.get(path) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
        const parsed = await auditEntries(path);
        const verification = verifyAuditEntries(parsed.entries, parsed.malformed);
        if (!verification.valid) throw new Error(verification.error ?? 'Audit chain is invalid.');
        const complete: AuditEntry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...entry,
            previousHash: verification.headHash };
        complete.entryHash = digest(verification.headHash, complete);
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${JSON.stringify(complete)}\n`, 'utf8');
        return complete;
    });
    appendQueues.set(path, operation);
    try { return await operation; } finally { if (appendQueues.get(path) === operation) appendQueues.delete(path); }
}

export async function readAudit(limit = 100, path = auditLogPath): Promise<AuditEntry[]> {
    const parsed = await auditEntries(path);
    return parsed.entries.slice(-Math.max(1, Math.min(limit, 1000))).reverse();
}
