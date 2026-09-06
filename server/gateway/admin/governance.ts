import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

export type FactionKind = 'kingdom' | 'city' | 'manor' | 'guild' | 'other';
export type JurisdictionKind = 'realm' | 'city' | 'manor' | 'guild' | 'district' | 'other';

export interface Faction {
    factionId: string;
    kind: FactionKind;
    name: string;
    treasuryActorId: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
}

export interface Jurisdiction {
    jurisdictionId: string;
    factionId: string;
    parentJurisdictionId: string | null;
    kind: JurisdictionKind;
    name: string;
    seatPropertyId: string | null;
    depth: number;
    revision: number;
    createdAt: string;
    updatedAt: string;
}

export interface JurisdictionTerritory {
    territoryId: string;
    jurisdictionId: string;
    level: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    revision: number;
    createdAt: string;
    updatedAt: string;
}

export interface CreateFaction {
    factionId: string;
    kind: FactionKind;
    name: string;
    treasuryActorId?: string;
}

export interface CreateJurisdiction {
    jurisdictionId: string;
    factionId: string;
    parentJurisdictionId?: string;
    kind: JurisdictionKind;
    name: string;
    seatPropertyId?: string;
}

export interface AssignTerritory {
    territoryId: string;
    jurisdictionId: string;
    level: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export interface ResolvedJurisdiction extends Jurisdiction {
    faction: Faction;
    territory: JurisdictionTerritory;
}

interface FactionRow {
    faction_id: string; kind: FactionKind; name: string; treasury_actor_id: string;
    revision: number; created_at: string; updated_at: string;
}

interface JurisdictionRow {
    jurisdiction_id: string; faction_id: string; parent_jurisdiction_id: string | null;
    kind: JurisdictionKind; name: string; seat_property_id: string | null; depth: number;
    revision: number; created_at: string; updated_at: string;
}

interface TerritoryRow {
    territory_id: string; jurisdiction_id: string; level: number;
    min_x: number; max_x: number; min_z: number; max_z: number;
    revision: number; created_at: string; updated_at: string;
}

const FACTION_KINDS: FactionKind[] = ['kingdom', 'city', 'manor', 'guild', 'other'];
const JURISDICTION_KINDS: JurisdictionKind[] = ['realm', 'city', 'manor', 'guild', 'district', 'other'];

function stableId(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(normalized)) throw new Error(`${field} is invalid`);
    return normalized;
}

function boundedText(value: string, field: string, maximum: number): string {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > maximum) throw new Error(`${field} is invalid`);
    return normalized;
}

function timestamp(value: string): string {
    if (!Number.isFinite(Date.parse(value))) throw new Error('now is invalid');
    return value;
}

function coordinate(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) throw new Error(`${field} is invalid`);
    return value;
}

function faction(row: FactionRow): Faction {
    return { factionId: row.faction_id, kind: row.kind, name: row.name,
        treasuryActorId: row.treasury_actor_id, revision: row.revision,
        createdAt: row.created_at, updatedAt: row.updated_at };
}

function jurisdiction(row: JurisdictionRow): Jurisdiction {
    return { jurisdictionId: row.jurisdiction_id, factionId: row.faction_id,
        parentJurisdictionId: row.parent_jurisdiction_id, kind: row.kind, name: row.name,
        seatPropertyId: row.seat_property_id, depth: row.depth, revision: row.revision,
        createdAt: row.created_at, updatedAt: row.updated_at };
}

function territory(row: TerritoryRow): JurisdictionTerritory {
    return { territoryId: row.territory_id, jurisdictionId: row.jurisdiction_id,
        level: row.level, minX: row.min_x, maxX: row.max_x, minZ: row.min_z, maxZ: row.max_z,
        revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

function contains(outer: JurisdictionTerritory, inner: JurisdictionTerritory): boolean {
    return outer.level === inner.level && outer.minX <= inner.minX && outer.maxX >= inner.maxX
        && outer.minZ <= inner.minZ && outer.maxZ >= inner.maxZ;
}

export class GovernanceStore {
    private readonly database: Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        this.database.run(`CREATE TABLE IF NOT EXISTS governance_schema (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL CHECK (version >= 1))`);
        this.database.run('INSERT OR IGNORE INTO governance_schema (singleton, version) VALUES (1, 1)');
        const schema = this.database.query('SELECT version FROM governance_schema WHERE singleton = 1')
            .get() as { version: number } | null;
        if (schema?.version !== 1) throw new Error(`Unsupported governance schema version: ${schema?.version ?? 'missing'}`);
        this.database.run(`CREATE TABLE IF NOT EXISTS governance_faction (
            faction_id TEXT PRIMARY KEY, kind TEXT NOT NULL
            CHECK (kind IN ('kingdom', 'city', 'manor', 'guild', 'other')),
            name TEXT NOT NULL, treasury_actor_id TEXT NOT NULL UNIQUE,
            revision INTEGER NOT NULL CHECK (revision >= 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS governance_jurisdiction (
            jurisdiction_id TEXT PRIMARY KEY,
            faction_id TEXT NOT NULL REFERENCES governance_faction(faction_id),
            parent_jurisdiction_id TEXT REFERENCES governance_jurisdiction(jurisdiction_id),
            kind TEXT NOT NULL CHECK (kind IN ('realm', 'city', 'manor', 'guild', 'district', 'other')),
            name TEXT NOT NULL, seat_property_id TEXT, depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 16),
            revision INTEGER NOT NULL CHECK (revision >= 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            CHECK (parent_jurisdiction_id IS NULL OR parent_jurisdiction_id <> jurisdiction_id))`);
        this.database.run(`CREATE INDEX IF NOT EXISTS governance_jurisdiction_parent
            ON governance_jurisdiction(parent_jurisdiction_id, jurisdiction_id)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS governance_territory (
            territory_id TEXT PRIMARY KEY,
            jurisdiction_id TEXT NOT NULL REFERENCES governance_jurisdiction(jurisdiction_id),
            level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 3),
            min_x INTEGER NOT NULL, max_x INTEGER NOT NULL, min_z INTEGER NOT NULL, max_z INTEGER NOT NULL,
            revision INTEGER NOT NULL CHECK (revision >= 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            CHECK (min_x BETWEEN 0 AND 65535 AND max_x BETWEEN min_x AND 65535),
            CHECK (min_z BETWEEN 0 AND 65535 AND max_z BETWEEN min_z AND 65535))`);
        this.database.run(`CREATE INDEX IF NOT EXISTS governance_territory_bounds
            ON governance_territory(level, min_x, max_x, min_z, max_z)`);
    }

    close(): void { this.database.close(true); }

    createFaction(input: CreateFaction, now = new Date().toISOString()): Faction {
        const factionId = stableId(input.factionId, 'factionId');
        if (!FACTION_KINDS.includes(input.kind)) throw new Error('Faction kind is invalid');
        const name = boundedText(input.name, 'name', 120);
        const treasuryActorId = stableId(input.treasuryActorId ?? factionId, 'treasuryActorId');
        const createdAt = timestamp(now);
        try {
            this.database.run(`INSERT INTO governance_faction
                (faction_id, kind, name, treasury_actor_id, revision, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)`, [factionId, input.kind, name, treasuryActorId, createdAt]);
        } catch (error) {
            if (String(error).includes('UNIQUE constraint failed')) throw new Error('Faction id or treasury actor already exists');
            throw error;
        }
        return this.getFaction(factionId)!;
    }

    getFaction(factionIdInput: string): Faction | null {
        const factionId = stableId(factionIdInput, 'factionId');
        const row = this.database.query('SELECT * FROM governance_faction WHERE faction_id = ?1')
            .get(factionId) as FactionRow | null;
        return row ? faction(row) : null;
    }

    createJurisdiction(input: CreateJurisdiction, now = new Date().toISOString()): Jurisdiction {
        const jurisdictionId = stableId(input.jurisdictionId, 'jurisdictionId');
        const factionId = stableId(input.factionId, 'factionId');
        if (!this.getFaction(factionId)) throw new Error('Faction does not exist');
        if (!JURISDICTION_KINDS.includes(input.kind)) throw new Error('Jurisdiction kind is invalid');
        const name = boundedText(input.name, 'name', 120);
        const seatPropertyId = input.seatPropertyId ? stableId(input.seatPropertyId, 'seatPropertyId') : null;
        const parent = input.parentJurisdictionId
            ? this.getJurisdiction(stableId(input.parentJurisdictionId, 'parentJurisdictionId')) : null;
        if (input.parentJurisdictionId && !parent) throw new Error('Parent jurisdiction does not exist');
        const depth = parent ? parent.depth + 1 : 0;
        if (depth > 16) throw new Error('Jurisdiction hierarchy is too deep');
        const createdAt = timestamp(now);
        try {
            this.database.run(`INSERT INTO governance_jurisdiction
                (jurisdiction_id, faction_id, parent_jurisdiction_id, kind, name, seat_property_id,
                    depth, revision, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)`,
            [jurisdictionId, factionId, parent?.jurisdictionId ?? null, input.kind, name,
                seatPropertyId, depth, createdAt]);
        } catch (error) {
            if (String(error).includes('UNIQUE constraint failed')) throw new Error('Jurisdiction id already exists');
            throw error;
        }
        return this.getJurisdiction(jurisdictionId)!;
    }

    getJurisdiction(jurisdictionIdInput: string): Jurisdiction | null {
        const jurisdictionId = stableId(jurisdictionIdInput, 'jurisdictionId');
        const row = this.database.query('SELECT * FROM governance_jurisdiction WHERE jurisdiction_id = ?1')
            .get(jurisdictionId) as JurisdictionRow | null;
        return row ? jurisdiction(row) : null;
    }

    assignTerritory(input: AssignTerritory, now = new Date().toISOString()): JurisdictionTerritory {
        const territoryId = stableId(input.territoryId, 'territoryId');
        const jurisdictionId = stableId(input.jurisdictionId, 'jurisdictionId');
        const owner = this.getJurisdiction(jurisdictionId);
        if (!owner) throw new Error('Jurisdiction does not exist');
        if (!Number.isSafeInteger(input.level) || input.level < 0 || input.level > 3) {
            throw new Error('level is invalid');
        }
        const candidate: JurisdictionTerritory = {
            territoryId, jurisdictionId, level: input.level,
            minX: coordinate(input.minX, 'minX'), maxX: coordinate(input.maxX, 'maxX'),
            minZ: coordinate(input.minZ, 'minZ'), maxZ: coordinate(input.maxZ, 'maxZ'),
            revision: 1, createdAt: timestamp(now), updatedAt: now
        };
        if (candidate.minX > candidate.maxX || candidate.minZ > candidate.maxZ) {
            throw new Error('Territory bounds are invalid');
        }
        const existing = this.getTerritory(territoryId);
        if (existing) {
            const exact = existing.jurisdictionId === candidate.jurisdictionId && existing.level === candidate.level
                && existing.minX === candidate.minX && existing.maxX === candidate.maxX
                && existing.minZ === candidate.minZ && existing.maxZ === candidate.maxZ;
            if (!exact) throw new Error('Territory id was reused with different bounds');
            return existing;
        }
        if (owner.parentJurisdictionId) {
            const covered = this.listTerritories(owner.parentJurisdictionId).some(item => contains(item, candidate));
            if (!covered) throw new Error('Child territory must be contained by a direct parent territory');
        }
        const overlaps = (this.database.query(`SELECT * FROM governance_territory WHERE level = ?1
            AND NOT (max_x < ?2 OR min_x > ?3 OR max_z < ?4 OR min_z > ?5)`)
            .all(candidate.level, candidate.minX, candidate.maxX, candidate.minZ, candidate.maxZ) as TerritoryRow[])
            .map(territory);
        for (const other of overlaps) this.assertCompatibleOverlap(candidate, other);
        this.database.run(`INSERT INTO governance_territory
            (territory_id, jurisdiction_id, level, min_x, max_x, min_z, max_z,
                revision, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)`,
        [candidate.territoryId, candidate.jurisdictionId, candidate.level, candidate.minX,
            candidate.maxX, candidate.minZ, candidate.maxZ, candidate.createdAt]);
        return this.getTerritory(territoryId)!;
    }

    getTerritory(territoryIdInput: string): JurisdictionTerritory | null {
        const territoryId = stableId(territoryIdInput, 'territoryId');
        const row = this.database.query('SELECT * FROM governance_territory WHERE territory_id = ?1')
            .get(territoryId) as TerritoryRow | null;
        return row ? territory(row) : null;
    }

    listTerritories(jurisdictionIdInput: string): JurisdictionTerritory[] {
        const jurisdictionId = stableId(jurisdictionIdInput, 'jurisdictionId');
        return (this.database.query(`SELECT * FROM governance_territory
            WHERE jurisdiction_id = ?1 ORDER BY level, min_x, min_z, territory_id`)
            .all(jurisdictionId) as TerritoryRow[]).map(territory);
    }

    resolveAt(xInput: number, zInput: number, levelInput: number): ResolvedJurisdiction[] {
        const x = coordinate(xInput, 'x');
        const z = coordinate(zInput, 'z');
        if (!Number.isSafeInteger(levelInput) || levelInput < 0 || levelInput > 3) {
            throw new Error('level is invalid');
        }
        const matches = (this.database.query(`SELECT * FROM governance_territory
            WHERE level = ?1 AND min_x <= ?2 AND max_x >= ?2 AND min_z <= ?3 AND max_z >= ?3`)
            .all(levelInput, x, z) as TerritoryRow[]).map(territory);
        return matches.map(item => {
            const scope = this.getJurisdiction(item.jurisdictionId)!;
            return { ...scope, faction: this.getFaction(scope.factionId)!, territory: item };
        }).sort((left, right) => left.depth - right.depth
            || left.jurisdictionId.localeCompare(right.jurisdictionId)
            || left.territory.territoryId.localeCompare(right.territory.territoryId));
    }

    private isAncestor(ancestorId: string, descendantId: string): boolean {
        let current = this.getJurisdiction(descendantId);
        while (current?.parentJurisdictionId) {
            if (current.parentJurisdictionId === ancestorId) return true;
            current = this.getJurisdiction(current.parentJurisdictionId);
        }
        return false;
    }

    private assertCompatibleOverlap(candidate: JurisdictionTerritory, other: JurisdictionTerritory): void {
        if (candidate.jurisdictionId === other.jurisdictionId) {
            throw new Error('Territories of the same jurisdiction must not overlap');
        }
        if (this.isAncestor(other.jurisdictionId, candidate.jurisdictionId)) {
            if (!contains(other, candidate)) throw new Error('Nested territory overlap must be fully contained');
            return;
        }
        if (this.isAncestor(candidate.jurisdictionId, other.jurisdictionId)) {
            if (!contains(candidate, other)) throw new Error('Nested territory overlap must be fully contained');
            return;
        }
        throw new Error('Unrelated jurisdictions must not have overlapping territories');
    }
}
