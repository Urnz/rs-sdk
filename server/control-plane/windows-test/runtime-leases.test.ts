import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { controlPlaneLease } from '../runtime-leases.js';

test('Windows permits only one control-plane writer for a canonical registry path and releases on close', async () => {
    const path = join(tmpdir(), `lease-${randomUUID()}.sqlite`), owner = await controlPlaneLease(path);
    try { await expect(controlPlaneLease(path)).rejects.toThrow(); await expect(controlPlaneLease(path.toUpperCase())).rejects.toThrow(); }
    finally { await new Promise<void>(resolve => owner.close(() => resolve())); }
    const next = await controlPlaneLease(path); await new Promise<void>(resolve => next.close(() => resolve()));
});
