import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditEntry } from './types';
import { auditLogPath } from './paths';

export async function appendAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry> {
    const complete: AuditEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...entry
    };
    await mkdir(dirname(auditLogPath), { recursive: true });
    await appendFile(auditLogPath, `${JSON.stringify(complete)}\n`, 'utf8');
    return complete;
}

export async function readAudit(limit = 100): Promise<AuditEntry[]> {
    try {
        const text = await readFile(auditLogPath, 'utf8');
        return text.trim().split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(limit, 1000)))
            .map(line => JSON.parse(line) as AuditEntry).reverse();
    } catch {
        return [];
    }
}
