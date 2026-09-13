import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { DurableAgentReplanCoordinator } from './durable-replan-coordinator.js';
import { enqueueAutonomyReconnectWakeup } from './autonomy-reconnect.js';
import { ReplanInboxStore } from './replan-inbox.js';

const directories: string[] = [];

function setup(status: 'desired' | 'paused' = 'desired') {
    const root = mkdtempSync(join(tmpdir(), 'rs-autonomy-reconnect-'));
    directories.push(root);
    const agentPath = join(root, 'agents.sqlite');
    const inboxPath = join(root, 'inbox.sqlite');
    const store = new AgentStateStore(agentPath);
    store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
        background: 'Reconnect test agent.', personalityTraits: ['patient'] });
    store.createAutonomyEnrollment('ferrye14', { status, policyId: 'private-local-default',
        policyVersion: '1.0.0', nextWakeupAt: status === 'desired' ? '2026-09-08T12:00:00.000Z' : null });
    store.close();
    const coordinator = new DurableAgentReplanCoordinator({ resolveAgentId: async () => null,
        listAgentIds: async () => [], plan: async (_agentId, event) => ({ runId: event.eventId,
            status: 'skipped', reason: 'Planner must not run during reconnect enqueue.' }),
        append: () => undefined }, { path: inboxPath });
    return { agentPath, inboxPath, coordinator };
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('autonomy reconnect wakeup', () => {
    test('durably enqueues one inert event for an enrolled avatar without invoking the planner', () => {
        const paths = setup();
        const connectionId = '11111111-1111-4111-8111-111111111111';
        const options = { agentPath: paths.agentPath, now: '2026-09-08T10:00:00.000Z' };
        const created = enqueueAutonomyReconnectWakeup(paths.coordinator, 'FERRYE14', connectionId, options);
        expect(created).toMatchObject({ status: 'created', agentId: 'ferrye14' });
        expect(enqueueAutonomyReconnectWakeup(paths.coordinator, 'ferrye14', connectionId, options))
            .toEqual({ status: 'existing', agentId: 'ferrye14', eventId: created.eventId });
        const inbox = new ReplanInboxStore(paths.inboxPath);
        expect(inbox.nextClaimableForAgent('ferrye14', options.now)).toMatchObject({ status: 'pending',
            event: { type: 'autonomy-reconnect', sourceKey: `autonomy:reconnect:${connectionId}` } });
        inbox.close();
    });

    test('does not wake a paused enrollment or an unknown avatar', () => {
        const paths = setup('paused');
        const connectionId = '22222222-2222-4222-8222-222222222222';
        const options = { agentPath: paths.agentPath, now: '2026-09-08T10:00:00.000Z' };
        expect(enqueueAutonomyReconnectWakeup(paths.coordinator, 'ferrye14', connectionId, options))
            .toEqual({ status: 'ignored', agentId: 'ferrye14', eventId: null });
        expect(enqueueAutonomyReconnectWakeup(paths.coordinator, 'nobody', connectionId, options))
            .toEqual({ status: 'ignored', agentId: null, eventId: null });
    });
});
