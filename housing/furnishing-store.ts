import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { furnishingCatalogDigest } from './furnishings.js';
import type { FurnishingCatalog, FurnishingPlacement, FurnishingPurchaseEvidence,
    PlacedHousingStorage, PropertyFurnishingCapabilities } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const ZERO = '0'.repeat(64);
type Row = { placement_id: string; property_id: string; placement_slot_id: string;
    furnishing_type_id: string; asset_id: string; owner_agent_id: string; purchase_evidence_digest: string;
    property_authority_digest: string;
    status: 'placed' | 'removed'; placed_at: string; removed_at: string | null; revision: number;
    sleep_places: number; private_storage_slots: number; work_surfaces: number };
type AuditRow = { sequence: number; action: string; placement_id: string; occurred_at: string;
    payload_json: string; previous_hash: string; entry_hash: string };
function id(value: string, field: string): string { const normalized = value.trim().toLowerCase();
    if (!ID.test(normalized)) throw new Error(`${field} is invalid`); return normalized; }
function timestamp(value: string, field: string): string { const parsed = Date.parse(value);
    if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString() !== value) {
        throw new Error(`${field} must be canonical UTC ISO`);
    } return value; }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function placement(row: Row): FurnishingPlacement { return { placementId: row.placement_id,
    propertyId: row.property_id, placementSlotId: row.placement_slot_id,
    furnishingTypeId: row.furnishing_type_id, assetId: row.asset_id, ownerAgentId: row.owner_agent_id,
    purchaseEvidenceDigest: row.purchase_evidence_digest, propertyAuthorityDigest: row.property_authority_digest,
    status: row.status,
    placedAtSimulationTime: row.placed_at, removedAtSimulationTime: row.removed_at, revision: row.revision }; }

export class FurnishingPlacementStore {
    private readonly database: Database;
    constructor(path: string, private readonly catalog: FurnishingCatalog) {
        const { digest, ...definition } = catalog;
        if (digest !== furnishingCatalogDigest(definition)) throw new Error('Furnishing catalog digest does not match');
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        this.migrate();
    }
    close(): void { this.database.close(true); }
    get(placementId: string): FurnishingPlacement | null {
        const row = this.database.query('SELECT * FROM furnishing_placement WHERE placement_id=?1')
            .get(id(placementId, 'Placement id')) as Row | null;
        return row ? placement(row) : null;
    }
    list(propertyIdInput?: string): FurnishingPlacement[] {
        const rows = propertyIdInput
            ? this.database.query('SELECT * FROM furnishing_placement WHERE property_id=?1 ORDER BY placement_id')
                .all(id(propertyIdInput, 'Property id'))
            : this.database.query('SELECT * FROM furnishing_placement ORDER BY placement_id').all();
        return (rows as Row[]).map(placement);
    }
    /** Exact active storage placement, verified against the placement audit before use. */
    getStoragePlacement(placementIdInput: string): PlacedHousingStorage | null {
        if (!this.verifyAuditChain()) throw new Error('Furnishing placement state or audit is invalid');
        const row = this.database.query('SELECT * FROM furnishing_placement WHERE placement_id=?1')
            .get(id(placementIdInput, 'Placement id')) as Row | null;
        return row?.status === 'placed' && row.private_storage_slots > 0
            ? { ...placement(row), storageSlots: row.private_storage_slots } : null;
    }
    place(input: { placementId: string; propertyId: string; placementSlotId: string;
        evidence: FurnishingPurchaseEvidence; propertyAuthorityDigest: string;
        atSimulationTime: string }): FurnishingPlacement {
        if (!this.verifyAuditChain()) throw new Error('Furnishing placement state or audit is invalid');
        const placementId = id(input.placementId, 'Placement id'), propertyId = id(input.propertyId, 'Property id');
        const slotId = id(input.placementSlotId, 'Placement slot id');
        const at = timestamp(input.atSimulationTime, 'Placement time');
        const evidence = this.evidence(input.evidence);
        if (!/^[0-9a-f]{64}$/.test(input.propertyAuthorityDigest)) {
            throw new Error('Property authority digest is invalid');
        }
        const slot = this.catalog.placementSlots.find(item => item.placementSlotId === slotId);
        const furnishing = this.catalog.furnishings.find(item => item.furnishingTypeId === evidence.furnishingTypeId);
        if (!slot || slot.propertyId !== propertyId) throw new Error('Placement slot does not belong to Property');
        if (!furnishing || !slot.allowedKinds.includes(furnishing.kind)) {
            throw new Error('Furnishing kind is not allowed in placement slot');
        }
        const existing = this.get(placementId);
        if (existing) {
            if (existing.propertyId !== propertyId || existing.placementSlotId !== slotId
                || existing.assetId !== evidence.assetId || existing.purchaseEvidenceDigest !== evidence.sourceDigest) {
                throw new Error('Placement id was reused with different evidence');
            }
            if (existing.propertyAuthorityDigest !== input.propertyAuthorityDigest) {
                throw new Error('Placement id was reused with different authority');
            }
            return existing;
        }
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO furnishing_placement
                (placement_id,property_id,placement_slot_id,furnishing_type_id,asset_id,owner_agent_id,
                purchase_evidence_digest,property_authority_digest,status,placed_at,removed_at,revision,sleep_places,
                private_storage_slots,work_surfaces) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'placed',?9,NULL,1,?10,?11,?12)`,
            [placementId, propertyId, slotId, furnishing.furnishingTypeId, evidence.assetId,
                evidence.ownerAgentId, evidence.sourceDigest, input.propertyAuthorityDigest, at,
                furnishing.capabilities.sleepPlaces,
                furnishing.capabilities.privateStorageSlots, furnishing.capabilities.workSurfaces]);
            this.audit('furnishing-placed', placementId, at, { propertyId, slotId,
                furnishingTypeId: furnishing.furnishingTypeId, assetId: evidence.assetId,
                ownerAgentId: evidence.ownerAgentId, evidenceDigest: evidence.sourceDigest,
                propertyAuthorityDigest: input.propertyAuthorityDigest,
                sleepPlaces: furnishing.capabilities.sleepPlaces,
                privateStorageSlots: furnishing.capabilities.privateStorageSlots,
                workSurfaces: furnishing.capabilities.workSurfaces });
        });
        transaction.immediate();
        return this.get(placementId)!;
    }
    remove(placementIdInput: string, expectedRevision: number,
        atSimulationTime: string): FurnishingPlacement {
        if (!this.verifyAuditChain()) throw new Error('Furnishing placement state or audit is invalid');
        const current = this.get(placementIdInput); if (!current) throw new Error('Unknown furnishing placement');
        if (current.status === 'removed') return current;
        const at = timestamp(atSimulationTime, 'Removal time');
        if (Date.parse(at) < Date.parse(current.placedAtSimulationTime))
            throw new Error('Removal cannot predate furnishing placement');
        const transaction = this.database.transaction(() => {
            const changed = this.database.run(`UPDATE furnishing_placement SET status='removed',removed_at=?3,
                revision=revision+1 WHERE placement_id=?1 AND revision=?2 AND status='placed'`,
            [current.placementId, expectedRevision, at]);
            if (changed.changes !== 1) throw new Error('Furnishing placement changed before removal');
            this.audit('furnishing-removed', current.placementId, at, {});
        });
        transaction.immediate();
        return this.get(current.placementId)!;
    }
    capabilities(propertyIdInput: string): PropertyFurnishingCapabilities {
        if (!this.verifyAuditChain()) throw new Error('Furnishing placement state or audit is invalid');
        const propertyId = id(propertyIdInput, 'Property id');
        const rows = this.database.query(`SELECT placement_id,sleep_places,private_storage_slots,work_surfaces
            FROM furnishing_placement WHERE property_id=?1 AND status='placed' ORDER BY placement_id`).all(propertyId) as
            Array<{ placement_id: string; sleep_places: number; private_storage_slots: number;
                work_surfaces: number }>;
        return { propertyId, placementIds: rows.map(row => row.placement_id),
            sleepPlaces: rows.reduce((sum, row) => sum + row.sleep_places, 0),
            privateStorageSlots: rows.reduce((sum, row) => sum + row.private_storage_slots, 0),
            workSurfaces: rows.reduce((sum, row) => sum + row.work_surfaces, 0) };
    }
    verifyAuditChain(): boolean {
        try {
            const audits = this.database.query('SELECT * FROM furnishing_audit ORDER BY sequence').all() as AuditRow[];
            const expected = new Map<string, Row>();
            let head = ZERO;
            for (let index = 0; index < audits.length; index++) {
                const audit = audits[index]!;
                const payload = JSON.parse(audit.payload_json) as Record<string, unknown>;
                if (!payload || typeof payload !== 'object' || Array.isArray(payload)
                    || Object.keys(payload).sort().join(',') !== 'action,at,detail,placementId'
                    || audit.sequence !== index + 1 || audit.previous_hash !== head
                    || hash({ previousHash: head, payload }) !== audit.entry_hash
                    || audit.action !== payload.action || audit.placement_id !== payload.placementId
                    || audit.occurred_at !== payload.at) return false;
                const detail = payload.detail;
                if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return false;
                const fields = detail as Record<string, unknown>;
                if (audit.action === 'furnishing-placed') {
                    const keys = Object.keys(fields).sort().join(',');
                    const legacy = keys ===
                        'assetId,evidenceDigest,furnishingTypeId,ownerAgentId,propertyAuthorityDigest,propertyId,slotId';
                    const snapshotted = keys ===
                        'assetId,evidenceDigest,furnishingTypeId,ownerAgentId,privateStorageSlots,propertyAuthorityDigest,propertyId,sleepPlaces,slotId,workSurfaces';
                    if ((!legacy && !snapshotted) || expected.has(audit.placement_id)) return false;
                    const slot = this.catalog.placementSlots.find(value => value.placementSlotId === fields.slotId);
                    const furnishing = this.catalog.furnishings.find(value => value.furnishingTypeId ===
                        fields.furnishingTypeId);
                    if (legacy && (!slot || !furnishing || slot.propertyId !== fields.propertyId
                        || !slot.allowedKinds.includes(furnishing.kind))) return false;
                    const capacity = snapshotted ? { sleepPlaces: fields.sleepPlaces,
                        privateStorageSlots: fields.privateStorageSlots, workSurfaces: fields.workSurfaces }
                        : furnishing!.capabilities;
                    if (Object.values(capacity).some(value => !Number.isSafeInteger(value)
                        || Number(value) < 0)) return false;
                    expected.set(audit.placement_id, { placement_id: audit.placement_id,
                        property_id: fields.propertyId as string, placement_slot_id: fields.slotId as string,
                        furnishing_type_id: fields.furnishingTypeId as string, asset_id: fields.assetId as string,
                        owner_agent_id: fields.ownerAgentId as string,
                        purchase_evidence_digest: fields.evidenceDigest as string,
                        property_authority_digest: fields.propertyAuthorityDigest as string,
                        status: 'placed', placed_at: audit.occurred_at, removed_at: null, revision: 1,
                        sleep_places: capacity.sleepPlaces as number,
                        private_storage_slots: capacity.privateStorageSlots as number,
                        work_surfaces: capacity.workSurfaces as number });
                } else if (audit.action === 'furnishing-removed') {
                    if (Object.keys(fields).length !== 0) return false;
                    const previous = expected.get(audit.placement_id);
                    if (!previous || previous.status !== 'placed'
                        || Date.parse(audit.occurred_at) < Date.parse(previous.placed_at)) return false;
                    expected.set(audit.placement_id, { ...previous, status: 'removed',
                        removed_at: audit.occurred_at, revision: previous.revision + 1 });
                } else return false;
                head = audit.entry_hash;
            }
            const rows = this.database.query('SELECT * FROM furnishing_placement').all() as Row[];
            if (rows.length !== expected.size) return false;
            return rows.every(row => { const value = expected.get(row.placement_id);
                return value !== undefined && (Object.keys(value) as Array<keyof Row>)
                    .every(key => row[key] === value[key]); });
        } catch { return false; }
    }
    private evidence(value: FurnishingPurchaseEvidence): FurnishingPurchaseEvidence {
        if (!value || Object.keys(value).sort().join(',') !== 'assetId,furnishingTypeId,ownerAgentId,sourceDigest') {
            throw new Error('Furnishing purchase evidence fields are invalid');
        }
        if (!/^[0-9a-f]{64}$/.test(value.sourceDigest)) throw new Error('Purchase evidence digest is invalid');
        return { assetId: id(value.assetId, 'Asset id'), ownerAgentId: id(value.ownerAgentId, 'Owner agent id'),
            furnishingTypeId: id(value.furnishingTypeId, 'Furnishing type id'), sourceDigest: value.sourceDigest };
    }
    private audit(action: string, placementId: string, at: string, detail: unknown): void {
        const last = this.database.query('SELECT entry_hash FROM furnishing_audit ORDER BY sequence DESC LIMIT 1')
            .get() as { entry_hash: string } | null;
        const previousHash = last?.entry_hash ?? ZERO, payload = { action, placementId, at, detail };
        this.database.run(`INSERT INTO furnishing_audit(action,placement_id,occurred_at,payload_json,previous_hash,entry_hash)
            VALUES(?1,?2,?3,?4,?5,?6)`, [action, placementId, at, JSON.stringify(payload), previousHash,
            hash({ previousHash, payload })]);
    }
    private migrate(): void {
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > 1) throw new Error(`Furnishing schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        const transaction = this.database.transaction(() => {
            this.database.run(`CREATE TABLE furnishing_placement (placement_id TEXT PRIMARY KEY,
                property_id TEXT NOT NULL,placement_slot_id TEXT NOT NULL,furnishing_type_id TEXT NOT NULL,
                asset_id TEXT NOT NULL,owner_agent_id TEXT NOT NULL,purchase_evidence_digest TEXT NOT NULL,
                property_authority_digest TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('placed','removed')),placed_at TEXT NOT NULL,
                removed_at TEXT,revision INTEGER NOT NULL,sleep_places INTEGER NOT NULL,
                private_storage_slots INTEGER NOT NULL,work_surfaces INTEGER NOT NULL)`);
            this.database.run(`CREATE UNIQUE INDEX furnishing_active_slot ON furnishing_placement(placement_slot_id)
                WHERE status='placed'`);
            this.database.run(`CREATE UNIQUE INDEX furnishing_active_asset ON furnishing_placement(asset_id)
                WHERE status='placed'`);
            this.database.run(`CREATE TABLE furnishing_audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,placement_id TEXT NOT NULL,occurred_at TEXT NOT NULL,payload_json TEXT NOT NULL,
                previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        }); transaction.immediate();
    }
}
