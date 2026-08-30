import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillTrialStore } from '../trials.js';

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function store(): Promise<SkillTrialStore> {
    const root = await mkdtemp(join(tmpdir(), 'rs-skill-trials-'));
    roots.push(root);
    return new SkillTrialStore(join(root, 'trials.json'));
}

describe('isolated draft skill trial store', () => {
    test('persists a single active trial and requires optimistic lifecycle transitions', async () => {
        const trials = await store();
        const trial = await trials.create({
            gapId: 'gap-0123456789abcdef0123', draft: { id: 'mine.copper', version: '0.1.0' },
            targetVersion: '1.0.0', testBotUsername: 'Testbot1', parameters: { amount: 14 }
        }, '2026-08-30T10:00:00.000Z');
        expect(trial).toMatchObject({ status: 'ready', testBotUsername: 'testbot1', revision: 1 });
        await expect(trials.create({
            gapId: trial.gapId, draft: trial.draft, targetVersion: '1.0.0',
            testBotUsername: 'Otherbot', parameters: {}
        })).rejects.toThrow('already has an active');

        const running = await trials.transition(trial.trialId, trial.revision, 'running');
        await expect(trials.transition(trial.trialId, trial.revision, 'cancelled')).rejects.toThrow('changed');
        const passed = await trials.transition(running.trialId, running.revision, 'verification-passed', {
            runIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
            verificationReportId: '33333333-3333-4333-8333-333333333333',
            verificationChecks: [{ id: 'live', passed: true, message: 'Two live runs.' }]
        });
        const published = await trials.transition(passed.trialId, passed.revision, 'published');
        expect((await trials.get(published.trialId))?.runIds).toHaveLength(2);
        await expect(trials.transition(published.trialId, published.revision, 'running')).rejects.toThrow('Invalid');
    });

    test('allows a failed verifier result to return to another bounded run', async () => {
        const trials = await store();
        const trial = await trials.create({ gapId: 'gap-aaaaaaaaaaaaaaaaaaaa',
            draft: { id: 'fish.lobster', version: '0.2.0' }, targetVersion: '1.0.0',
            testBotUsername: 'Trialbot', parameters: {} });
        const running = await trials.transition(trial.trialId, trial.revision, 'running');
        const failed = await trials.transition(running.trialId, running.revision, 'verification-failed', {
            verificationChecks: [{ id: 'independent-runs', passed: false, message: 'Only one run.' }]
        });
        const retried = await trials.transition(failed.trialId, failed.revision, 'running', {
            verificationReportId: null, verificationChecks: []
        });
        expect(retried).toMatchObject({ status: 'running', verificationReportId: null, verificationChecks: [] });
    });
});
