import { describe, expect, test } from 'bun:test';
import type { SkillTrial } from '../../../agent-skills/trials.js';
import type { SkillVerificationReport } from '../../../agent-skills/verifier.js';
import { buildSkillPublicationApproval } from './skill-publication-approval.js';

const trial = (): SkillTrial => ({ schemaVersion: 1, trialId: '11111111-1111-4111-8111-111111111111',
    gapId: 'gap-11111111111111111111', draft: { id: 'procedure.travel', version: '0.1.0' },
    targetVersion: '1.0.0', testBotUsername: 'trialbot1', parameters: { x: 3200 },
    status: 'verification-passed', runIds: ['22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333'],
    verificationReportId: '44444444-4444-4444-8444-444444444444',
    verificationChecks: [{ id: 'live', passed: true, message: 'Two live runs.' }],
    createdAt: '2026-09-10T10:00:00.000Z', updatedAt: '2026-09-10T11:00:00.000Z', revision: 4 });

const report = (): SkillVerificationReport => ({ id: '44444444-4444-4444-8444-444444444444',
    createdAt: '2026-09-10T11:00:00.000Z', verifierId: 'deterministic-skill-verifier',
    draft: { id: 'procedure.travel', version: '0.1.0' }, targetVersion: '1.0.0', passed: true,
    checks: [{ id: 'live', passed: true, message: 'Two live runs.' }],
    evidenceRunIds: ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'],
    evidenceUsernames: ['trialbot1'], promoted: { id: 'procedure.travel', version: '1.0.0',
        status: 'verified' } as any });

describe('human skill publication approval', () => {
    test('binds the exact parameters, evidence and promoted version to a stable digest', () => {
        const first = buildSkillPublicationApproval(trial(), report());
        const second = buildSkillPublicationApproval(trial(), report());
        const firstDigest = first.digest;
        expect(first).toMatchObject({ digest: expect.stringMatching(/^[a-f0-9]{64}$/),
            parameters: { x: 3200 }, evidenceRunIds: expect.any(Array),
            promoted: { id: 'procedure.travel', version: '1.0.0', status: 'verified' } });
        expect(second.digest).toBe(firstDigest);
        const changed = trial(); changed.parameters.x = 3201;
        expect(buildSkillPublicationApproval(changed, report()).digest).not.toBe(firstDigest);
    });

    test('rejects failed checks and evidence that differ from the reviewed trial', () => {
        const failed = report(); failed.checks[0]!.passed = false;
        expect(() => buildSkillPublicationApproval(trial(), failed)).toThrow('nem használható');
        const mismatched = report(); mismatched.evidenceRunIds.pop();
        expect(() => buildSkillPublicationApproval(trial(), mismatched)).toThrow('nem használható');
    });
});
