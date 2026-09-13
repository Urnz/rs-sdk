import { createHash } from 'node:crypto';
import type { SkillTrial } from '../../../agent-skills/trials.js';
import type { SkillVerificationReport } from '../../../agent-skills/verifier.js';

export interface SkillPublicationApproval {
    digest: string;
    trialId: string;
    draft: SkillTrial['draft'];
    targetVersion: string;
    testBotUsername: string;
    parameters: SkillTrial['parameters'];
    evidenceRunIds: string[];
    evidenceUsernames: string[];
    verificationReportId: string;
    verificationChecks: SkillVerificationReport['checks'];
    promoted: { id: string; version: string; status: 'verified' };
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
}

/** Binds the human decision to the exact verifier output displayed by the UI. */
export function buildSkillPublicationApproval(trial: SkillTrial,
    report: SkillVerificationReport): SkillPublicationApproval {
    if (trial.status !== 'verification-passed' || !trial.verificationReportId
        || report.id !== trial.verificationReportId || !report.passed || !report.promoted
        || report.checks.some(check => !check.passed)
        || report.draft.id !== trial.draft.id || report.draft.version !== trial.draft.version
        || report.targetVersion !== trial.targetVersion
        || report.promoted.id !== trial.draft.id || report.promoted.version !== trial.targetVersion
        || report.promoted.status !== 'verified'
        || JSON.stringify([...report.evidenceRunIds].sort()) !== JSON.stringify([...trial.runIds].sort())) {
        throw new Error('A verifier-jelentés nem használható emberi publikálási jóváhagyásra.');
    }
    const payload = {
        trialId: trial.trialId, draft: structuredClone(trial.draft), targetVersion: trial.targetVersion,
        testBotUsername: trial.testBotUsername, parameters: structuredClone(trial.parameters),
        evidenceRunIds: [...report.evidenceRunIds], evidenceUsernames: [...report.evidenceUsernames],
        verificationReportId: report.id, verificationChecks: structuredClone(report.checks),
        promoted: { id: report.promoted.id, version: report.promoted.version,
            status: 'verified' as const }
    };
    return { digest: createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex'), ...payload };
}
