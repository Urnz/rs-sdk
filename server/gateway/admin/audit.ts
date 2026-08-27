import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditEntry } from './types';
import { auditLogPath } from './paths';

export async function appendAudit(
    entry: Omit<AuditEntry, 'id' | 'timestamp'>,
    path = auditLogPath
): Promise<AuditEntry> {
    const complete: AuditEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...entry
    };
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(complete)}\n`, 'utf8');
    return complete;
}

export async function readAudit(limit = 100, path = auditLogPath): Promise<AuditEntry[]> {
    try {
        const text = await readFile(path, 'utf8');
        return text.trim().split(/\r?\n/).filter(Boolean)
            .flatMap(line => {
                try {
                    const entry = JSON.parse(line) as AuditEntry;
                    return typeof entry.id === 'string' && typeof entry.timestamp === 'string' ? [entry] : [];
                } catch {
                    return [];
                }
            }).slice(-Math.max(1, Math.min(limit, 1000))).reverse();
    } catch {
        return [];
    }
}
