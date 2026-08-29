import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LlmAuditEvent, LlmAuditSink } from './types.js';

export class MemoryLlmAuditSink implements LlmAuditSink {
    readonly events: LlmAuditEvent[] = [];

    append(event: LlmAuditEvent): void {
        this.events.push(structuredClone(event));
    }
}

export class JsonlLlmAuditSink implements LlmAuditSink {
    constructor(private readonly path: string) {}

    async append(event: LlmAuditEvent): Promise<void> {
        await mkdir(dirname(this.path), { recursive: true });
        await appendFile(this.path, `${JSON.stringify(event)}\n`, 'utf8');
    }
}
