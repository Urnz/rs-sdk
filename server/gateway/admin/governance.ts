import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

export type FactionKind = 'kingdom' | 'city' | 'manor' | 'guild' | 'other';
export type JurisdictionKind = 'realm' | 'city' | 'manor' | 'guild' | 'district' | 'other';
export type GovernanceBudgetStatus = 'draft' | 'active' | 'superseded' | 'closed';
export type GovernanceBudgetAuditAction = 'created' | 'activated' | 'superseded' | 'closed';

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

export interface GovernanceBudget {
    budgetId: string;
    factionId: string;
    version: number;
    name: string;
    validFrom: string;
    validUntil: string;
    revenueTargetGp: number;
    spendingLimitGp: number;
    status: GovernanceBudgetStatus;
    revision: number;
    createdAt: string;
    activatedAt: string | null;
    closedAt: string | null;
    updatedAt: string;
}

export interface GovernanceBudgetAuditEntry {
    sequence: number;
    budgetId: string;
    factionId: string;
    action: GovernanceBudgetAuditAction;
    actorAgentId: string;
    fromStatus: GovernanceBudgetStatus | null;
    toStatus: GovernanceBudgetStatus;
    createdAt: string;
}

export interface CreateGovernanceBudget {
    budgetId: string;
    factionId: string;
    version: number;
    name: string;
    validFrom: string;
    validUntil: string;
    revenueTargetGp: number;
    spendingLimitGp: number;
    createdByAgentId: string;
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

interface BudgetRow {
    budget_id: string; faction_id: string; version: number; name: string;
    valid_from: string; valid_until: string; revenue_target_gp: number; spending_limit_gp: number;
    status: GovernanceBudgetStatus; revision: number; created_at: string;
    activated_at: string | null; closed_at: string | null; updated_at: string;
}

interface BudgetAuditRow {
    sequence: number; budget_id: string; faction_id: string; action: GovernanceBudgetAuditAction;
    actor_agent_id: string; from_status: GovernanceBudgetStatus | null;
    to_status: GovernanceBudgetStatus; created_at: string;
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

function gpAmount(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
        throw new Error(`${field} is invalid`);
    }
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

function budget(row: BudgetRow): GovernanceBudget {
    return { budgetId: row.budget_id, factionId: row.faction_id, version: row.version,
        name: row.name, validFrom: row.valid_from, validUntil: row.valid_until,
        revenueTargetGp: row.revenue_target_gp, spendingLimitGp: row.spending_limit_gp,
        status: row.status, revision: row.revision, createdAt: row.created_at,
        activatedAt: row.activated_at, closedAt: row.closed_at, updatedAt: row.updated_at };
}

function budgetAudit(row: BudgetAuditRow): GovernanceBudgetAuditEntry {
    return { sequence: row.sequence, budgetId: row.budget_id, factionId: row.faction_id,
        action: row.action, actorAgentId: row.actor_agent_id, fromStatus: row.from_status,
        toStatus: row.to_status, createdAt: row.created_at };
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
        if (!schema || schema.version < 1 || schema.version > 4) {
            throw new Error(`Unsupported governance schema version: ${schema?.version ?? 'missing'}`);
        }
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
        if (schema.version === 1) this.migrateVersionOneToTwo();
        const currentSchema = this.database.query('SELECT version FROM governance_schema WHERE singleton = 1')
            .get() as { version: number };
        if (currentSchema.version === 2) this.migrateVersionTwoToThree();
        const policySchema = this.database.query('SELECT version FROM governance_schema WHERE singleton = 1')
            .get() as { version: number };
        if (policySchema.version === 3) this.migrateVersionThreeToFour();
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

    listJurisdictions(factionIdInput: string, limit = 100): Jurisdiction[] {
        const factionId = stableId(factionIdInput, 'factionId');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('limit is invalid');
        return (this.database.query(`SELECT * FROM governance_jurisdiction
            WHERE faction_id = ?1 ORDER BY depth, jurisdiction_id LIMIT ?2`)
            .all(factionId, limit) as JurisdictionRow[]).map(jurisdiction);
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

    createBudget(input: CreateGovernanceBudget, now = new Date().toISOString()): GovernanceBudget {
        const budgetId = stableId(input.budgetId, 'budgetId');
        const factionId = stableId(input.factionId, 'factionId');
        if (!this.getFaction(factionId)) throw new Error('Faction does not exist');
        if (!Number.isSafeInteger(input.version) || input.version < 1 || input.version > 1_000_000) {
            throw new Error('Budget version is invalid');
        }
        const name = boundedText(input.name, 'name', 120);
        const validFrom = timestamp(input.validFrom);
        const validUntil = timestamp(input.validUntil);
        if (Date.parse(validUntil) <= Date.parse(validFrom)) throw new Error('Budget validity window is invalid');
        const revenueTargetGp = gpAmount(input.revenueTargetGp, 'revenueTargetGp');
        const spendingLimitGp = gpAmount(input.spendingLimitGp, 'spendingLimitGp');
        const createdByAgentId = stableId(input.createdByAgentId, 'createdByAgentId');
        const createdAt = timestamp(now);
        const existing = this.getBudget(budgetId);
        if (existing) {
            const exact = existing.factionId === factionId && existing.version === input.version
                && existing.name === name && existing.validFrom === validFrom && existing.validUntil === validUntil
                && existing.revenueTargetGp === revenueTargetGp && existing.spendingLimitGp === spendingLimitGp
                && this.getBudgetAuditActor(budgetId, 'created') === createdByAgentId;
            if (!exact) throw new Error('Budget id was reused with different content');
            return existing;
        }
        const latest = this.database.query(`SELECT COALESCE(MAX(version), 0) AS version
            FROM governance_budget WHERE faction_id = ?1`).get(factionId) as { version: number };
        if (input.version !== latest.version + 1) throw new Error('Budget version must follow the latest faction budget');
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO governance_budget
                (budget_id, faction_id, version, name, valid_from, valid_until, revenue_target_gp,
                    spending_limit_gp, status, revision, created_at, activated_at, closed_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'draft', 1, ?9, NULL, NULL, ?9)`,
            [budgetId, factionId, input.version, name, validFrom, validUntil,
                revenueTargetGp, spendingLimitGp, createdAt]);
            this.insertBudgetAudit(budgetId, factionId, 'created', createdByAgentId, null, 'draft', createdAt);
        });
        try { transaction.immediate(); } catch (error) {
            if (String(error).includes('UNIQUE constraint failed')) {
                throw new Error('Budget id or faction version already exists');
            }
            throw error;
        }
        return this.getBudget(budgetId)!;
    }

    getBudget(budgetIdInput: string): GovernanceBudget | null {
        const budgetId = stableId(budgetIdInput, 'budgetId');
        const row = this.database.query('SELECT * FROM governance_budget WHERE budget_id = ?1')
            .get(budgetId) as BudgetRow | null;
        return row ? budget(row) : null;
    }

    getActiveBudget(factionIdInput: string): GovernanceBudget | null {
        const factionId = stableId(factionIdInput, 'factionId');
        const row = this.database.query(`SELECT * FROM governance_budget
            WHERE faction_id = ?1 AND status = 'active'`).get(factionId) as BudgetRow | null;
        return row ? budget(row) : null;
    }

    listBudgets(factionIdInput: string): GovernanceBudget[] {
        const factionId = stableId(factionIdInput, 'factionId');
        return (this.database.query(`SELECT * FROM governance_budget
            WHERE faction_id = ?1 ORDER BY version DESC, budget_id`)
            .all(factionId) as BudgetRow[]).map(budget);
    }

    activateBudget(budgetIdInput: string, expectedRevision: number, approvedByAgentIdInput: string,
        now = new Date().toISOString()): GovernanceBudget {
        const budgetId = stableId(budgetIdInput, 'budgetId');
        const approvedByAgentId = stableId(approvedByAgentIdInput, 'approvedByAgentId');
        const current = this.getBudget(budgetId);
        if (!current) throw new Error('Budget does not exist');
        if (current.status === 'active') {
            if (this.getBudgetAuditActor(budgetId, 'activated') !== approvedByAgentId) {
                throw new Error('Budget activation replay has a different approver');
            }
            return current;
        }
        if (current.status !== 'draft') throw new Error('Only a draft budget may be activated');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
            throw new Error('Budget revision is invalid');
        }
        const activatedAt = timestamp(now);
        const transaction = this.database.transaction(() => {
            const previous = this.getActiveBudget(current.factionId);
            if (previous) {
                this.database.run(`UPDATE governance_budget SET status = 'superseded', revision = revision + 1,
                    closed_at = ?2, updated_at = ?2 WHERE budget_id = ?1 AND status = 'active'`,
                [previous.budgetId, activatedAt]);
                this.insertBudgetAudit(previous.budgetId, previous.factionId, 'superseded', approvedByAgentId,
                    'active', 'superseded', activatedAt);
            }
            const updated = this.database.run(`UPDATE governance_budget SET status = 'active',
                revision = revision + 1, activated_at = ?3, updated_at = ?3
                WHERE budget_id = ?1 AND revision = ?2 AND status = 'draft'`,
            [budgetId, expectedRevision, activatedAt]);
            if (updated.changes !== 1) throw new Error('Budget changed before activation; refresh and try again');
            this.insertBudgetAudit(budgetId, current.factionId, 'activated', approvedByAgentId,
                'draft', 'active', activatedAt);
        });
        transaction.immediate();
        return this.getBudget(budgetId)!;
    }

    closeBudget(budgetIdInput: string, expectedRevision: number, closedByAgentIdInput: string,
        now = new Date().toISOString()): GovernanceBudget {
        const budgetId = stableId(budgetIdInput, 'budgetId');
        const closedByAgentId = stableId(closedByAgentIdInput, 'closedByAgentId');
        const current = this.getBudget(budgetId);
        if (!current) throw new Error('Budget does not exist');
        if (current.status === 'closed') {
            if (this.getBudgetAuditActor(budgetId, 'closed') !== closedByAgentId) {
                throw new Error('Budget close replay has a different actor');
            }
            return current;
        }
        if (current.status === 'superseded') throw new Error('Superseded budget is immutable');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
            throw new Error('Budget revision is invalid');
        }
        const closedAt = timestamp(now);
        const transaction = this.database.transaction(() => {
            const updated = this.database.run(`UPDATE governance_budget SET status = 'closed',
                revision = revision + 1, closed_at = ?3, updated_at = ?3
                WHERE budget_id = ?1 AND revision = ?2 AND status IN ('draft', 'active')`,
            [budgetId, expectedRevision, closedAt]);
            if (updated.changes !== 1) throw new Error('Budget changed before close; refresh and try again');
            this.insertBudgetAudit(budgetId, current.factionId, 'closed', closedByAgentId,
                current.status, 'closed', closedAt);
        });
        transaction.immediate();
        return this.getBudget(budgetId)!;
    }

    listBudgetAudit(factionIdInput: string): GovernanceBudgetAuditEntry[] {
        const factionId = stableId(factionIdInput, 'factionId');
        return (this.database.query(`SELECT * FROM governance_budget_audit
            WHERE faction_id = ?1 ORDER BY sequence`).all(factionId) as BudgetAuditRow[]).map(budgetAudit);
    }

    private migrateVersionOneToTwo(): void {
        const transaction = this.database.transaction(() => {
            const current = this.database.query('SELECT version FROM governance_schema WHERE singleton = 1')
                .get() as { version: number } | null;
            if (current?.version === 2 || current?.version === 3 || current?.version === 4) return;
            if (current?.version !== 1) throw new Error('Governance schema changed during migration');
            this.database.run(`CREATE TABLE IF NOT EXISTS governance_budget (
                budget_id TEXT PRIMARY KEY, faction_id TEXT NOT NULL REFERENCES governance_faction(faction_id),
                version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 1000000), name TEXT NOT NULL,
                valid_from TEXT NOT NULL, valid_until TEXT NOT NULL,
                revenue_target_gp INTEGER NOT NULL CHECK (revenue_target_gp BETWEEN 0 AND 2147483647),
                spending_limit_gp INTEGER NOT NULL CHECK (spending_limit_gp BETWEEN 0 AND 2147483647),
                status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded', 'closed')),
                revision INTEGER NOT NULL CHECK (revision >= 1), created_at TEXT NOT NULL,
                activated_at TEXT, closed_at TEXT, updated_at TEXT NOT NULL,
                UNIQUE (faction_id, version))`);
            this.database.run(`CREATE UNIQUE INDEX IF NOT EXISTS governance_active_budget
                ON governance_budget(faction_id) WHERE status = 'active'`);
            this.database.run(`CREATE TABLE IF NOT EXISTS governance_budget_audit (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                budget_id TEXT NOT NULL REFERENCES governance_budget(budget_id),
                faction_id TEXT NOT NULL REFERENCES governance_faction(faction_id),
                action TEXT NOT NULL CHECK (action IN ('created', 'activated', 'superseded', 'closed')),
                actor_agent_id TEXT NOT NULL, from_status TEXT
                CHECK (from_status IS NULL OR from_status IN ('draft', 'active', 'superseded', 'closed')),
                to_status TEXT NOT NULL CHECK (to_status IN ('draft', 'active', 'superseded', 'closed')),
                created_at TEXT NOT NULL)`);
            this.database.run('UPDATE governance_schema SET version = 2 WHERE singleton = 1 AND version = 1');
        });
        transaction.immediate();
    }

    private migrateVersionTwoToThree(): void {
        const transaction = this.database.transaction(() => {
            const current = this.database.query('SELECT version FROM governance_schema WHERE singleton = 1')
                .get() as { version: number } | null;
            if (current?.version === 3 || current?.version === 4) return;
            if (current?.version !== 2) throw new Error('Governance schema changed during migration');
            this.database.run(`CREATE TABLE IF NOT EXISTS governance_policy (
                policy_id TEXT PRIMARY KEY,
                jurisdiction_id TEXT NOT NULL REFERENCES governance_jurisdiction(jurisdiction_id),
                policy_key TEXT NOT NULL, version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 1000000),
                kind TEXT NOT NULL CHECK (kind IN ('tax', 'tariff', 'fee', 'subsidy')),
                trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('property-transfer', 'property-ownership',
                    'business-revenue', 'business-registration', 'goods-import', 'property-development')),
                name TEXT NOT NULL, calculation_mode TEXT NOT NULL CHECK (calculation_mode IN ('flat', 'basis-points')),
                flat_amount_gp INTEGER, rate_bps INTEGER, minimum_gp INTEGER NOT NULL,
                maximum_gp INTEGER NOT NULL, status TEXT NOT NULL
                CHECK (status IN ('draft', 'active', 'superseded', 'revoked')),
                revision INTEGER NOT NULL CHECK (revision >= 1), created_at TEXT NOT NULL,
                activated_at TEXT, revoked_at TEXT, updated_at TEXT NOT NULL,
                CHECK ((calculation_mode = 'flat' AND flat_amount_gp BETWEEN 1 AND 2147483647
                    AND rate_bps IS NULL) OR (calculation_mode = 'basis-points' AND flat_amount_gp IS NULL
                    AND rate_bps BETWEEN 1 AND 10000)),
                CHECK (minimum_gp BETWEEN 0 AND 2147483647),
                CHECK (maximum_gp BETWEEN minimum_gp AND 2147483647),
                UNIQUE (jurisdiction_id, policy_key, version))`);
            this.database.run(`CREATE UNIQUE INDEX IF NOT EXISTS governance_active_policy
                ON governance_policy(jurisdiction_id, policy_key) WHERE status = 'active'`);
            this.database.run(`CREATE TABLE IF NOT EXISTS governance_policy_audit (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                policy_id TEXT NOT NULL REFERENCES governance_policy(policy_id),
                jurisdiction_id TEXT NOT NULL REFERENCES governance_jurisdiction(jurisdiction_id),
                action TEXT NOT NULL CHECK (action IN ('created', 'activated', 'superseded', 'revoked')),
                actor_agent_id TEXT NOT NULL, from_status TEXT
                CHECK (from_status IS NULL OR from_status IN ('draft', 'active', 'superseded', 'revoked')),
                to_status TEXT NOT NULL CHECK (to_status IN ('draft', 'active', 'superseded', 'revoked')),
                created_at TEXT NOT NULL)`);
            this.database.run('UPDATE governance_schema SET version = 3 WHERE singleton = 1 AND version = 2');
        });
        transaction.immediate();
    }

    private migrateVersionThreeToFour(): void {
        const transaction = this.database.transaction(() => {
            const current = this.database.query('SELECT version FROM governance_schema WHERE singleton = 1')
                .get() as { version: number } | null;
            if (current?.version === 4) return;
            if (current?.version !== 3) throw new Error('Governance schema changed during migration');
            this.database.run(`CREATE TABLE IF NOT EXISTS governance_source_event (
                event_id TEXT PRIMARY KEY, source_domain TEXT NOT NULL CHECK (source_domain IN ('property', 'business')),
                trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('property-transfer', 'property-ownership',
                    'business-revenue', 'business-registration', 'goods-import', 'property-development')),
                source_ref TEXT NOT NULL, event_digest TEXT NOT NULL
                CHECK (length(event_digest) = 64), subject_kind TEXT NOT NULL
                CHECK (subject_kind IN ('player', 'business', 'faction')), subject_id TEXT NOT NULL,
                level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 3), x INTEGER NOT NULL, z INTEGER NOT NULL,
                basis_gp INTEGER NOT NULL CHECK (basis_gp BETWEEN 0 AND 2147483647),
                occurred_at TEXT NOT NULL, verified_at TEXT NOT NULL, processed_at TEXT NOT NULL,
                CHECK (x BETWEEN 0 AND 65535), CHECK (z BETWEEN 0 AND 65535),
                UNIQUE (source_domain, source_ref))`);
            this.database.run(`CREATE TABLE IF NOT EXISTS governance_obligation (
                obligation_id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL REFERENCES governance_source_event(event_id),
                policy_id TEXT NOT NULL REFERENCES governance_policy(policy_id), policy_version INTEGER NOT NULL,
                jurisdiction_id TEXT NOT NULL REFERENCES governance_jurisdiction(jurisdiction_id),
                sequence INTEGER NOT NULL CHECK (sequence >= 0), kind TEXT NOT NULL
                CHECK (kind IN ('tax', 'tariff', 'fee', 'subsidy')),
                debtor_kind TEXT NOT NULL CHECK (debtor_kind IN ('player', 'business', 'faction')),
                debtor_id TEXT NOT NULL, creditor_kind TEXT NOT NULL
                CHECK (creditor_kind IN ('player', 'business', 'faction')), creditor_id TEXT NOT NULL,
                amount_gp INTEGER NOT NULL CHECK (amount_gp > 0), status TEXT NOT NULL CHECK (status = 'due'),
                created_at TEXT NOT NULL, UNIQUE (event_id, policy_id), UNIQUE (event_id, sequence),
                CHECK (debtor_kind <> creditor_kind OR debtor_id <> creditor_id))`);
            this.database.run(`CREATE INDEX IF NOT EXISTS governance_obligation_debtor
                ON governance_obligation(debtor_kind, debtor_id, status, created_at)`);
            this.database.run('UPDATE governance_schema SET version = 4 WHERE singleton = 1 AND version = 3');
        });
        transaction.immediate();
    }

    private insertBudgetAudit(budgetId: string, factionId: string, action: GovernanceBudgetAuditAction,
        actorAgentId: string, fromStatus: GovernanceBudgetStatus | null,
        toStatus: GovernanceBudgetStatus, createdAt: string): void {
        this.database.run(`INSERT INTO governance_budget_audit
            (budget_id, faction_id, action, actor_agent_id, from_status, to_status, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        [budgetId, factionId, action, actorAgentId, fromStatus, toStatus, createdAt]);
    }

    private getBudgetAuditActor(budgetId: string, action: GovernanceBudgetAuditAction): string | null {
        const row = this.database.query(`SELECT actor_agent_id FROM governance_budget_audit
            WHERE budget_id = ?1 AND action = ?2 ORDER BY sequence DESC LIMIT 1`)
            .get(budgetId, action) as { actor_agent_id: string } | null;
        return row?.actor_agent_id ?? null;
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
