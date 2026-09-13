import { describe, expect, test } from 'bun:test';
import { runAutonomyReconciliation } from './autonomy-reconciliation.js';

describe('unified autonomy reconciliation', () => {
    test('orders marker, journal, orphan, goal, domain and enrollment recovery before planning', async () => {
        const calls: string[] = [];
        const report = await runAutonomyReconciliation(true, {
            reconcileSkillMarkers: async () => { calls.push('markers'); return []; },
            recoverSkillTerminals: async () => { calls.push('terminals'); return {
                scannedRuns: 1, matchedEnrollments: 1, reconciledWorkOrderRunIds: [],
                createdEventIds: ['terminal'], existingEventIds: [] }; },
            recoverOrphanedSkills: async markers => { calls.push(`orphans:${markers.length}`); return {
                examinedMarkers: 0, createdEventIds: [], existingEventIds: [], journaledRunIds: [] }; },
            recoverPlayerActionSettlements: async () => { calls.push('work-order-settlements'); return {
                attemptedSettlementIds: ['payment'], completedSettlementIds: ['payment'], errors: [] }; },
            recoverContractSettlements: async () => { calls.push('settlements'); return {
                attemptedContractIds: ['contract'], completedContractIds: ['contract'], errors: [] }; },
            recoverGoalEvents: () => { calls.push('goals'); return {
                scannedEvents: 2, createdEventIds: ['goal'], existingEventIds: [] }; },
            recoverDomainEvents: () => { calls.push('domains'); return { scanned: 3, created: 1, existing: 2 }; },
            reconcileEnrollments: async startup => { calls.push(`enrollments:${startup}`); return []; }
        });
        expect(calls).toEqual(['markers', 'terminals', 'orphans:0', 'work-order-settlements',
            'settlements', 'goals', 'domains', 'enrollments:true']);
        expect(report).toMatchObject({ startup: true, skillTerminals: { matchedEnrollments: 1 },
            goalEvents: { scannedEvents: 2 }, domainEvents: { scanned: 3 } });
    });

    test('fails closed before enrollment claims when an authoritative recovery phase fails', async () => {
        let planned = false;
        await expect(runAutonomyReconciliation(true, {
            reconcileSkillMarkers: async () => [],
            recoverSkillTerminals: async () => { throw new Error('journal unavailable'); },
            recoverOrphanedSkills: async () => ({ examinedMarkers: 0, createdEventIds: [],
                existingEventIds: [], journaledRunIds: [] }),
            recoverPlayerActionSettlements: async () => ({ attemptedSettlementIds: [],
                completedSettlementIds: [], errors: [] }),
            recoverContractSettlements: async () => ({ attemptedContractIds: [], completedContractIds: [], errors: [] }),
            recoverGoalEvents: () => ({ scannedEvents: 0, createdEventIds: [], existingEventIds: [] }),
            recoverDomainEvents: () => ({ scanned: 0, created: 0, existing: 0 }),
            reconcileEnrollments: async () => { planned = true; return []; }
        })).rejects.toThrow('journal unavailable');
        expect(planned).toBe(false);
    });
});
