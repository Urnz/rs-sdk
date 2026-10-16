import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ThievingEvidenceStore, type EngineThievingEvidence } from './ThievingEvidenceStore.js';

const paths: string[] = [];

function databasePath(): string {
    const path = join(tmpdir(), `thieving-engine-evidence-${crypto.randomUUID()}.sqlite`);
    paths.push(path);
    return path;
}

function evidence(eventId = crypto.randomUUID()): EngineThievingEvidence {
    return { eventId, playerUsername: 'thief1', procedureKind: 'pickpocket',
        target: { kind: 'npc', typeId: 1, instanceIndex: 12, name: 'Man', x: 3200, z: 3201, level: 0 },
        effect: 'item-transfer', transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }],
        thievingXpDelta: 80, startedAtEngineTick: 100, endedAtEngineTick: 101,
        occurredAt: '2026-09-21T18:00:00.000Z' };
}

afterEach(() => {
    for (const path of paths.splice(0)) {
        for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) rmSync(path + suffix);
    }
});

describe('ThievingEvidenceStore', () => {
    test('persists idempotent engine evidence and survives restart', () => {
        const path = databasePath(), input = evidence();
        const store = new ThievingEvidenceStore(path);
        const first = store.append(input), replay = store.append(input);
        expect(replay).toEqual(first);
        expect(store.verifyChain()).toBeTrue();
        store.close();
        const restarted = new ThievingEvidenceStore(path);
        expect(restarted.get(input.eventId)).toEqual(first);
        expect(restarted.listAfter(0)).toEqual([{ sequence: 1, ...first }]);
        restarted.close();
    });

    test('rejects event id reuse and detects persisted mutation', () => {
        const path = databasePath(), input = evidence('00000000-0000-4000-8000-000000000001');
        const store = new ThievingEvidenceStore(path);
        store.append(input);
        expect(() => store.append({ ...input, thievingXpDelta: 90 })).toThrow('event id was reused');
        store.close();
        const database = new Database(path);
        database.run('UPDATE thieving_engine_evidence SET thieving_xp_delta = 90 WHERE event_id = ?1',
            [input.eventId]);
        database.close(true);
        const reopened = new ThievingEvidenceStore(path);
        expect(reopened.verifyChain()).toBeFalse();
        reopened.close();
    });

    test('chains multiple events in sequence order', () => {
        const store = new ThievingEvidenceStore(databasePath());
        store.append(evidence('00000000-0000-4000-8000-000000000002'));
        store.append({ ...evidence('00000000-0000-4000-8000-000000000003'), procedureKind: 'lockpick-door', effect: 'lock-opened',
            transferredItems: [], startedAtEngineTick: 102, endedAtEngineTick: 104 });
        const rows = store.listAfter(1, 10);
        expect(rows).toHaveLength(1);
        expect(rows[0].eventId).toBe('00000000-0000-4000-8000-000000000003');
        expect(store.verifyChain()).toBeTrue();
        store.close();
    });

    test('persists the event-time Property access decision inside the event digest', () => {
        const store = new ThievingEvidenceStore(databasePath());
        const record = store.append({ ...evidence('00000000-0000-4000-8000-000000000004'), procedureKind: 'property-burglary',
            target: { kind: 'loc', typeId: 4673, instanceIndex: null, name: 'Property door',
                x: 3248, z: 3411, level: 0 }, effect: 'entry-completed', transferredItems: [],
            propertyAccess: { propertyId: 'varrock.east-workshop', entryPointId: 'front-door',
                owner: { kind: 'business', id: 'varrock-smiths' }, propertyStateVersion: 7,
                actorAuthorized: false, lockLevel: 20 } });
        expect(record.propertyAccess).toMatchObject({ propertyStateVersion: 7,
            actorAuthorized: false, lockLevel: 20 });
        expect(store.verifyChain()).toBeTrue();
        store.close();
    });
    test('persists sight opportunities without promoting them into witness knowledge', () => {
        const path = databasePath(), store = new ThievingEvidenceStore(path);
        const sightSnapshot = { actor: { x: 2969, z: 3328, level: 0 }, radius: 15,
            candidates: [{ username: 'nearby', x: 2970, z: 3328, level: 0 }] };
        const input = { ...evidence('00000000-0000-4000-8000-000000000005'), procedureKind: 'property-burglary' as const,
            effect: 'entry-completed' as const, transferredItems: [], sightSnapshot };
        const record = store.append(input);
        expect(record.sightSnapshot).toEqual(sightSnapshot);
        expect(store.verifyChain()).toBeTrue();
        store.close();
        const reopened = new ThievingEvidenceStore(path);
        expect(reopened.get(input.eventId)).toEqual(record);
        expect(reopened.get(input.eventId)?.sightSnapshot?.candidates).toHaveLength(1);
        expect(reopened.verifyChain()).toBeTrue();
        reopened.close();
        const tamper = new Database(path);
        tamper.run("UPDATE thieving_engine_evidence SET sight_snapshot_json='{}' WHERE event_id=?1", [input.eventId]);
        tamper.close();
        const corrupted = new ThievingEvidenceStore(path);
        expect(corrupted.verifyChain()).toBeFalse();
        corrupted.close();
    });
    test('adds the sight column to an existing engine evidence database', () => {
        const path = databasePath(), old = new Database(path);
        old.run(`CREATE TABLE thieving_engine_evidence (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,
            player_username TEXT NOT NULL,procedure_kind TEXT NOT NULL,target_json TEXT NOT NULL,
            effect TEXT NOT NULL,transferred_items_json TEXT NOT NULL,thieving_xp_delta INTEGER NOT NULL,
            started_at_engine_tick INTEGER NOT NULL,ended_at_engine_tick INTEGER NOT NULL,
            occurred_at TEXT NOT NULL,property_access_json TEXT,event_digest TEXT NOT NULL,
            previous_hash TEXT NOT NULL,record_hash TEXT NOT NULL UNIQUE)`);
        old.close();
        const migrated = new ThievingEvidenceStore(path);
        try { expect(migrated.append(evidence('00000000-0000-4000-8000-000000000006')).sightSnapshot).toBeUndefined();
            expect(migrated.verifyChain()).toBeTrue();
        } finally { migrated.close(); }
    });
});
