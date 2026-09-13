import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LlmDailyBudgetStore } from '../budget.js';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function stores() {
    const root = mkdtempSync(join(tmpdir(), 'llm-budget-')); roots.push(root);
    const path = join(root, 'budget.sqlite');
    return { first: new LlmDailyBudgetStore(path), second: new LlmDailyBudgetStore(path) };
}

describe('global daily LLM budget', () => {
    test('atomically reserves estimates and reconciles actual usage idempotently', () => {
        const { first, second } = stores();
        const limits = { maxCostMicros: 100, maxDecisions: 2 };
        expect(first.reserve('run-1', 'fixture-a', 60, limits, '2026-09-10T10:00:00.000Z'))
            .toMatchObject({ admitted: true, reason: 'admitted', reservedCostMicros: 60, decisions: 1 });
        expect(second.reserve('run-2', 'fixture-a', 50, limits, '2026-09-10T10:00:01.000Z'))
            .toMatchObject({ admitted: false, reason: 'cost-limit', reservedCostMicros: 60, decisions: 1 });
        expect(second.reserve('run-1', 'fixture-a', 60, limits, '2026-09-10T10:00:02.000Z'))
            .toMatchObject({ admitted: true, reason: 'existing-reservation', decisions: 1 });
        expect(first.reconcile('run-1', 40, 'provider-1', '2026-09-10T10:00:03.000Z'))
            .toMatchObject({ status: 'reconciled', actualCostMicros: 40 });
        expect(second.reconcile('run-1', 40, 'provider-1', '2026-09-10T10:00:04.000Z'))
            .toMatchObject({ actualCostMicros: 40, providerRequestId: 'provider-1' });
        expect(() => second.reconcile('run-1', 41, 'provider-1')).toThrow('conflicts');
        expect(second.reserve('run-2', 'fixture-a', 50, limits, '2026-09-10T10:00:05.000Z'))
            .toMatchObject({ admitted: true, reservedCostMicros: 90, decisions: 2 });
        expect(second.reserve('zero-cost', 'fixture-a', 0, { maxCostMicros: 0, maxDecisions: 3 },
            '2026-09-10T10:00:06.000Z')).toMatchObject({ admitted: true, decisions: 3 });
        first.close(); second.close();
    });

    test('counts one logical decision across retries and enforces the decision bound', () => {
        const { first, second } = stores();
        const limits = { maxCostMicros: 1_000, maxDecisions: 1 };
        first.reserve('run-1', 'server', 10, limits, '2026-09-10T10:00:00.000Z');
        expect(second.reserve('run-1', 'server', 10, limits, '2026-09-10T10:00:01.000Z'))
            .toMatchObject({ admitted: true, reason: 'existing-reservation', decisions: 1 });
        expect(second.reserve('run-2', 'server', 10, limits, '2026-09-10T10:00:02.000Z'))
            .toMatchObject({ admitted: false, reason: 'decision-limit', decisions: 1 });
        first.close(); second.close();
    });
});
