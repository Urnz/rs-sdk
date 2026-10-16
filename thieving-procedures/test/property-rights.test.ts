import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RightsViolationStore } from '../../rights-violations/index.js';
import { ThievingEvidenceStore } from '../../server/engine/src/mods/ThievingEvidenceStore.js';
import { ingestEngineThievingOutcome, projectPropertyEntryViolation, ThievingProcedureStore } from '../index.js';

const paths: string[] = [];
function path(name: string): string {
    const value = join(tmpdir(), `${name}-${crypto.randomUUID()}.sqlite`);
    paths.push(value);
    return value;
}
afterEach(() => {
    for (const value of paths.splice(0)) {
        for (const suffix of ['', '-wal', '-shm']) if (existsSync(value + suffix)) rmSync(value + suffix);
    }
});

function stores() {
    return { source: new ThievingEvidenceStore(path('engine-source')),
        procedures: new ThievingProcedureStore(path('procedure-receipts')),
        rights: new RightsViolationStore(path('rights-events')) };
}

describe('Property entry rights projection', () => {
    test('projects one denied entry from the event-time Property snapshot', () => {
        const active = stores();
        const source = active.source.append({ eventId: 'property-event-1', playerUsername: 'intruder',
            procedureKind: 'property-burglary',
            target: { kind: 'loc', typeId: 4673, instanceIndex: null, name: 'Property door',
                x: 3248, z: 3411, level: 0 }, effect: 'entry-completed', transferredItems: [],
            thievingXpDelta: 150, startedAtEngineTick: 10, endedAtEngineTick: 12,
            occurredAt: '2026-09-21T19:00:00.000Z', propertyAccess: { propertyId: 'varrock.east-workshop',
                entryPointId: 'front-door', owner: { kind: 'business', id: 'varrock-smiths' },
                propertyStateVersion: 7, actorAuthorized: false } });
        const receipt = ingestEngineThievingOutcome(source.eventId, active.source, active.procedures,
            username => username === 'intruder' ? 'intruder-agent' : null, '2026-09-21T19:00:01.000Z');
        const violation = projectPropertyEntryViolation(receipt.receiptId, active.source, active.procedures,
            active.rights, () => null, '2026-09-21T19:00:02.000Z');
        expect(violation).toMatchObject({ resourceKind: 'entry-entitlement',
            resourceId: 'varrock.east-workshop.front-door', owner: { kind: 'business', id: 'varrock-smiths' },
            actorAgentId: 'intruder-agent', action: 'enter', sourceStateVersion: 7,
            sourceEvidenceDigest: source.eventDigest });
        expect(active.rights.verifyAuditChain()).toBeTrue();
        expect(projectPropertyEntryViolation(receipt.receiptId, active.source, active.procedures,
            active.rights, () => null)).toEqual(violation);
        active.source.close(); active.procedures.close(); active.rights.close();
    });

    test('rejects authorised, unowned and non-entry outcomes', () => {
        const active = stores();
        const source = active.source.append({ eventId: 'property-event-2', playerUsername: 'owner',
            procedureKind: 'property-burglary',
            target: { kind: 'loc', typeId: 4673, instanceIndex: null, name: 'Property door',
                x: 3248, z: 3411, level: 0 }, effect: 'entry-completed', transferredItems: [],
            thievingXpDelta: 150, startedAtEngineTick: 10, endedAtEngineTick: 12,
            occurredAt: '2026-09-21T19:00:00.000Z', propertyAccess: { propertyId: 'varrock.east-workshop',
                entryPointId: 'front-door', owner: { kind: 'player', id: 'owner' },
                propertyStateVersion: 7, actorAuthorized: true } });
        const receipt = ingestEngineThievingOutcome(source.eventId, active.source, active.procedures,
            () => 'owner-agent');
        expect(() => projectPropertyEntryViolation(receipt.receiptId, active.source, active.procedures,
            active.rights, () => 'owner-agent')).toThrow('not an owned, denied entitlement');
        expect(active.rights.list()).toEqual([]);
        active.source.close(); active.procedures.close(); active.rights.close();
    });
});
