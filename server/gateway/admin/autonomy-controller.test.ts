import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { avatarHasLiveAutonomyLease, decideControllerAdmission } from './autonomy-controller.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('autonomy controller ownership', () => {
    test('preserves manual last-controller-wins behavior outside an autonomy lease', () => {
        expect(decideControllerAdmission(false, 0)).toMatchObject({ allowed: true, preemptExisting: false });
        expect(decideControllerAdmission(false, 1)).toMatchObject({ allowed: true, preemptExisting: true });
    });

    test('rejects pre-emption while a live autonomy lease owns the avatar', () => {
        expect(decideControllerAdmission(true, 0)).toMatchObject({ allowed: true, preemptExisting: false });
        expect(decideControllerAdmission(true, 1)).toEqual({ allowed: false, preemptExisting: false,
            reason: 'An autonomy lease already owns the avatar controller.' });
    });

    test('resolves ownership only from the exact persistent avatar and unexpired lease', () => {
        const directory = mkdtempSync(join(tmpdir(), 'rs-autonomy-controller-'));
        directories.push(directory);
        const path = join(directory, 'agents.sqlite');
        const store = new AgentStateStore(path);
        store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
            background: 'Controller ownership test.', personalityTraits: ['careful'] });
        const desired = store.createAutonomyEnrollment('ferrye14', { status: 'desired',
            policyId: 'private-local-default', policyVersion: '1.0.0' }, '2026-09-08T08:00:00.000Z');
        expect(avatarHasLiveAutonomyLease('Ferrye14', '2026-09-08T08:00:00.000Z', path)).toBe(false);
        store.claimAutonomyEnrollment('ferrye14', desired.revision, 'gateway:test',
            '2026-09-08T08:05:00.000Z', '2026-09-08T08:01:00.000Z');
        store.close();
        expect(avatarHasLiveAutonomyLease('FERRYe14', '2026-09-08T08:04:59.999Z', path)).toBe(true);
        expect(avatarHasLiveAutonomyLease('ferrye14', '2026-09-08T08:05:00.000Z', path)).toBe(false);
        expect(avatarHasLiveAutonomyLease('another', '2026-09-08T08:04:00.000Z', path)).toBe(false);
    });
});
