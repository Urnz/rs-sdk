import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldDirectorEventStore, type EngineWorldDirectorEvent } from './WorldDirectorEventStore.js';

const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function setup(): WorldDirectorEventStore {
    const directory = mkdtempSync(join(tmpdir(), 'rs-engine-world-event-'));
    directories.push(directory);
    return new WorldDirectorEventStore(join(directory, 'events.sqlite'));
}

const event: EngineWorldDirectorEvent = { eventId: 'world-event-0123456789abcdef01234567',
    cycleKey: 'cycle-42', selectionDigest: 'a'.repeat(64), kind: 'world-flavor', templateId: 'quiet-world-beat',
    templateVersion: '1.0.0', title: 'A quiet day passes', summary: 'Nothing material changes.',
    regions: ['global'], tags: ['no-op'] };

describe('engine World Director event idempotency', () => {
    test('accepts an exact event once and returns the original record on retry', () => {
        const store = setup();
        const first = store.accept(event, '2026-08-31T10:00:00.000Z');
        const retry = store.accept(event, '2026-08-31T11:00:00.000Z');
        expect(first.created).toBeTrue();
        expect(retry.created).toBeFalse();
        expect(retry.event).toEqual(first.event);
        store.close();
    });

    test('rejects reusing an event id with different trusted content', () => {
        const store = setup();
        store.accept(event);
        expect(() => store.accept({ ...event, summary: 'Changed.' })).toThrow('reused');
        store.close();
    });
});
