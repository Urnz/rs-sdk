import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { setAdminLlmEmergencyStop } from './llm-dry-run.js';
import { adminPublicDir } from './paths.js';
import { handleAdminRequest } from './routes.js';
import type { BotSupervisor } from './supervisor.js';

const directories: string[] = [];

function setup(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-autonomy-admin-'));
    directories.push(directory);
    const path = join(directory, 'agents.sqlite');
    const store = new AgentStateStore(path);
    store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
        background: 'Autonomy admin test agent.', personalityTraits: ['careful'] });
    store.createAutonomyEnrollment('ferrye14', { status: 'desired', policyId: 'private-local-default',
        policyVersion: '1.0.0' });
    store.close();
    return path;
}

async function post(path: string, body: Record<string, unknown>, agentStatePath: string,
    stopSkill: (username: string) => Promise<boolean>) {
    const request = new Request(`http://localhost:7780${path}`, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Admin-Request': 'rs-sdk-admin', Origin: 'http://localhost:7780'
    }, body: JSON.stringify(body) });
    return handleAdminRequest(request, new URL(request.url), {
        gatewayBots: () => new Map(), agentStatePath,
        supervisor: { stopSkill } as unknown as BotSupervisor
    });
}

afterEach(() => {
    setAdminLlmEmergencyStop(false);
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('admin autonomy controls', () => {
    test('exposes global and per-agent autonomy controls in the admin UI', () => {
        const html = readFileSync(join(adminPublicDir, 'index.html'), 'utf8');
        const script = readFileSync(join(adminPublicDir, 'admin.js'), 'utf8');
        expect(html).toContain('id="autonomy-control"');
        expect(script).toContain('agent-autonomy-release-quarantine');
        expect(script).toContain('data-action="autonomy-global-${');
        expect(script).toContain('/api/admin/autonomy/${action}');
    });

    test('audits and applies safe per-agent and global transitions through typed routes', async () => {
        const path = setup();
        const stopped: string[] = [];
        const stopSkill = async (username: string) => { stopped.push(username); return true; };

        let response = await post('/api/admin/agents/ferrye14/autonomy/pause', {
            expectedRevision: 1, reason: 'Operator pause.'
        }, path, stopSkill);
        expect(response?.status).toBe(200);
        expect(await response?.json()).toMatchObject({ enrollment: { status: 'paused', revision: 2 }, stopped: true });

        response = await post('/api/admin/agents/ferrye14/autonomy/pause', {
            expectedRevision: 1, reason: 'Idempotent retry.'
        }, path, stopSkill);
        expect(await response?.json()).toMatchObject({ enrollment: { status: 'paused', revision: 2 } });

        response = await post('/api/admin/agents/ferrye14/autonomy/resume', {
            expectedRevision: 2, reason: 'Reviewed resume.'
        }, path, stopSkill);
        expect(await response?.json()).toMatchObject({ enrollment: { status: 'desired', revision: 3 } });

        const store = new AgentStateStore(path);
        store.setAutonomyEnrollment('ferrye14', 3, { status: 'quarantined',
            policyId: 'private-local-default', policyVersion: '1.0.0', failureCount: 1,
            lastFailureFingerprint: 'c'.repeat(64), quarantineReason: 'Test quarantine.' });
        store.close();
        response = await post('/api/admin/agents/ferrye14/autonomy/release-quarantine', {
            expectedRevision: 4, reason: 'Reviewed quarantine evidence.'
        }, path, stopSkill);
        expect(await response?.json()).toMatchObject({ enrollment: { status: 'paused', revision: 5 } });

        response = await post('/api/admin/autonomy/emergency-stop', {
            expectedRevision: 1, reason: 'Global test stop.'
        }, path, stopSkill);
        expect(await response?.json()).toMatchObject({ control: { emergencyStop: true, revision: 2 } });
        response = await post('/api/admin/autonomy/resume', {
            expectedRevision: 2, reason: 'Global recovery reviewed.'
        }, path, stopSkill);
        expect(await response?.json()).toMatchObject({ control: { emergencyStop: false, revision: 3 } });
        expect(stopped).toEqual(['ferrye14', 'ferrye14', 'ferrye14']);
    });
});
