import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

export type EngineWorldEventKind = 'economic-signal' | 'resource-signal' | 'social-signal' | 'world-flavor';

export interface EngineWorldDirectorEvent {
    eventId: string;
    cycleKey: string;
    selectionDigest: string;
    kind: EngineWorldEventKind;
    templateId: string;
    templateVersion: string;
    title: string;
    summary: string;
    regions: readonly string[];
    tags: readonly string[];
}

export interface EngineWorldDirectorEventRecord extends EngineWorldDirectorEvent {
    acceptedAt: string;
}

interface EventRow {
    event_id: string; cycle_key: string; selection_digest: string; kind: EngineWorldEventKind; template_id: string;
    template_version: string; title: string; summary: string; regions: string; tags: string; accepted_at: string;
}

function record(row: EventRow): EngineWorldDirectorEventRecord {
    return { eventId: row.event_id, cycleKey: row.cycle_key, selectionDigest: row.selection_digest, kind: row.kind,
        templateId: row.template_id, templateVersion: row.template_version, title: row.title,
        summary: row.summary, regions: JSON.parse(row.regions) as string[], tags: JSON.parse(row.tags) as string[],
        acceptedAt: row.accepted_at };
}

export class WorldDirectorEventStore {
    private readonly database: Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run(`CREATE TABLE IF NOT EXISTS world_director_event (
            event_id TEXT PRIMARY KEY, cycle_key TEXT NOT NULL, selection_digest TEXT NOT NULL, kind TEXT NOT NULL,
            template_id TEXT NOT NULL, template_version TEXT NOT NULL, title TEXT NOT NULL,
            summary TEXT NOT NULL, regions TEXT NOT NULL, tags TEXT NOT NULL, accepted_at TEXT NOT NULL)`);
    }

    close(): void { this.database.close(true); }

    get(eventId: string): EngineWorldDirectorEventRecord | null {
        const row = this.database.query('SELECT * FROM world_director_event WHERE event_id = ?1')
            .get(eventId) as EventRow | null;
        return row ? record(row) : null;
    }

    accept(event: EngineWorldDirectorEvent, now = new Date().toISOString()):
        { event: EngineWorldDirectorEventRecord; created: boolean } {
        const existing = this.get(event.eventId);
        if (existing) {
            if (existing.cycleKey !== event.cycleKey || existing.selectionDigest !== event.selectionDigest
                || existing.kind !== event.kind || existing.templateId !== event.templateId
                || existing.templateVersion !== event.templateVersion || existing.title !== event.title
                || existing.summary !== event.summary || JSON.stringify(existing.regions) !== JSON.stringify(event.regions)
                || JSON.stringify(existing.tags) !== JSON.stringify(event.tags)) {
                throw new Error('World Director event id was reused with different content');
            }
            return { event: existing, created: false };
        }
        this.database.run(`INSERT INTO world_director_event
            (event_id, cycle_key, selection_digest, kind, template_id, template_version, title, summary, regions, tags, accepted_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        [event.eventId, event.cycleKey, event.selectionDigest, event.kind, event.templateId, event.templateVersion,
            event.title, event.summary, JSON.stringify(event.regions), JSON.stringify(event.tags), now]);
        return { event: this.get(event.eventId)!, created: true };
    }
}

let defaultStore: WorldDirectorEventStore | null = null;

export function getWorldDirectorEventStore(): WorldDirectorEventStore {
    if (!defaultStore) defaultStore = new WorldDirectorEventStore('data/mods/world-director-events.sqlite');
    return defaultStore;
}
