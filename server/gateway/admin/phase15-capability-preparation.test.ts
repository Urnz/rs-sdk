import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityGapStore } from '../../../agent-skills/capability-gaps.js';
import { PHASE15_CAPABILITY_CANDIDATES, preparePhase15CapabilityTrials }
    from './phase15-capability-preparation.js';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe('phase 15 capability trial preparation', () => {
    test('idempotently attaches six reviewed shared drafts without starting or publishing them', async () => {
        const root = mkdtempSync(join(tmpdir(), 'phase15-capabilities-')); roots.push(root);
        const store = new CapabilityGapStore(join(root, 'gaps.json'));
        const first = await preparePhase15CapabilityTrials(store, '2026-09-10T10:00:00.000Z');
        const second = await preparePhase15CapabilityTrials(store, '2026-09-10T10:01:00.000Z');
        expect(first).toHaveLength(6);
        expect(second).toHaveLength(6);
        expect((await store.list()).map(gap => gap.status)).toEqual([
            'draft', 'draft', 'draft', 'draft', 'draft', 'draft'
        ]);
        expect(new Set((await store.list()).map(gap => `${gap.draftSkill!.id}@${gap.draftSkill!.version}`)))
            .toEqual(new Set(PHASE15_CAPABILITY_CANDIDATES.map(item => `${item.draft.id}@${item.draft.version}`)));
        expect((await store.list()).every(gap => gap.resolvedSkill === null)).toBeTrue();
    });
});
