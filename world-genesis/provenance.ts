import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { validateWorldGenesisResult } from './result.js';
import { WORLD_GENESIS_PROFILE_SCHEMA_VERSION, type GenesisAssetAllocation, type GenesisAssetOwner,
    type GenesisAssetOwnerKind, type GenesisAssetProvenance, type WorldGenesisResult } from './types.js';

export const WORLD_GENESIS_PROVENANCE_STORE_SCHEMA_VERSION = 1 as const;
const DIGEST = /^[0-9a-f]{64}$/;
const STABLE_ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/;
const OWNER_KINDS = new Set<GenesisAssetOwnerKind>(['player', 'business', 'faction', 'world']);

interface ProvenanceRow {
    provenance_id: string; result_id: string; result_digest: string; configuration_digest: string;
    allocation_id: string; kind: GenesisAssetAllocation['kind']; owner_kind: GenesisAssetOwnerKind;
    owner_id: string; asset_json: string; asset_digest: string; created_at_simulation_time: string;
    created_at_audit: string;
}

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function timestamp(value: string, field: string): string {
    if (Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
        throw new Error(`${field} must be a canonical UTC timestamp`);
    }
    return value;
}
function stableId(value: unknown, field: string): string {
    if (typeof value !== 'string' || !STABLE_ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function exact(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
        || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error(`${field} is invalid`);
    return value as Record<string, unknown>;
}
function positive(value: unknown, field: string, allowZero = false): number {
    if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1) || Number(value) > 2_147_483_647) {
        throw new Error(`${field} is invalid`);
    }
    return Number(value);
}
function owner(value: unknown): GenesisAssetOwner {
    const input = exact(value, ['kind', 'id'], 'Genesis asset owner');
    if (!OWNER_KINDS.has(input.kind as GenesisAssetOwnerKind)) throw new Error('Genesis asset owner kind is invalid');
    return { kind: input.kind as GenesisAssetOwnerKind, id: stableId(input.id, 'Genesis asset owner id') };
}

export function validateGenesisAssetAllocation(value: unknown): GenesisAssetAllocation {
    const base = value as Record<string, unknown> | null;
    if (!base || typeof base !== 'object' || Array.isArray(base)) throw new Error('Genesis asset allocation is invalid');
    const allocationId = stableId(base.allocationId, 'Genesis allocation id');
    const assetOwner = owner(base.owner);
    if (base.kind === 'currency') {
        const input = exact(base, ['allocationId', 'kind', 'owner', 'amountGp'], 'Currency genesis allocation');
        return { allocationId, kind: 'currency', owner: assetOwner, amountGp: positive(input.amountGp, 'amountGp') };
    }
    if (base.kind === 'item') {
        const input = exact(base, ['allocationId', 'kind', 'owner', 'container', 'itemId', 'count', 'slot'],
            'Item genesis allocation');
        if (!['inventory', 'equipment', 'bank', 'business-stock'].includes(String(input.container))) {
            throw new Error('Genesis item container is invalid');
        }
        const container = input.container as 'inventory' | 'equipment' | 'bank' | 'business-stock';
        if ((container === 'equipment' && (!Number.isSafeInteger(input.slot) || Number(input.slot) < 0
            || Number(input.slot) > 13)) || (container !== 'equipment' && input.slot !== null)) {
            throw new Error('Genesis item slot is invalid for its container');
        }
        return { allocationId, kind: 'item', owner: assetOwner, container,
            itemId: positive(input.itemId, 'itemId', true), count: positive(input.count, 'count'),
            slot: container === 'equipment' ? Number(input.slot) : null };
    }
    if (base.kind === 'property') {
        const input = exact(base, ['allocationId', 'kind', 'owner', 'propertyId'], 'Property genesis allocation');
        return { allocationId, kind: 'property', owner: assetOwner,
            propertyId: stableId(input.propertyId, 'propertyId') };
    }
    if (base.kind === 'business') {
        const input = exact(base, ['allocationId', 'kind', 'owner', 'businessId', 'openingCapitalGp',
            'openingInventoryDigest'], 'Business genesis allocation');
        if (typeof input.openingInventoryDigest !== 'string' || !DIGEST.test(input.openingInventoryDigest)) {
            throw new Error('Business opening inventory digest is invalid');
        }
        return { allocationId, kind: 'business', owner: assetOwner,
            businessId: stableId(input.businessId, 'businessId'),
            openingCapitalGp: positive(input.openingCapitalGp, 'openingCapitalGp', true),
            openingInventoryDigest: input.openingInventoryDigest };
    }
    throw new Error('Genesis asset kind is invalid');
}

export function businessGenesisInventoryDigest(allocations: readonly GenesisAssetAllocation[], businessId: string): string {
    const counts = new Map<number, number>();
    for (const allocation of allocations) if (allocation.kind === 'item' && allocation.container === 'business-stock'
        && allocation.owner.kind === 'business' && allocation.owner.id === businessId) {
        const count = (counts.get(allocation.itemId) ?? 0) + allocation.count;
        if (!Number.isSafeInteger(count) || count > 2_147_483_647) {
            throw new Error('Business genesis inventory would overflow');
        }
        counts.set(allocation.itemId, count);
    }
    return hash([...counts].sort(([left], [right]) => left - right).map(([itemId, count]) => ({ itemId, count })));
}

function record(row: ProvenanceRow): GenesisAssetProvenance {
    return { schemaVersion: WORLD_GENESIS_PROFILE_SCHEMA_VERSION, provenanceId: row.provenance_id,
        source: 'world-genesis', resultId: row.result_id, resultDigest: row.result_digest,
        configurationDigest: row.configuration_digest, allocationId: row.allocation_id, kind: row.kind,
        owner: { kind: row.owner_kind, id: row.owner_id },
        asset: JSON.parse(row.asset_json) as GenesisAssetAllocation, assetDigest: row.asset_digest,
        createdAtSimulationTime: row.created_at_simulation_time, createdAtAudit: row.created_at_audit };
}

function resultAssets(result: WorldGenesisResult): GenesisAssetAllocation[] {
    if (!result.output || typeof result.output !== 'object' || Array.isArray(result.output)
        || !Array.isArray(result.output.assets)) throw new Error('Genesis result output must contain an assets array');
    const assets = result.output.assets.map(validateGenesisAssetAllocation);
    if (new Set(assets.map(asset => asset.allocationId)).size !== assets.length) {
        throw new Error('Genesis result contains duplicate allocation ids');
    }
    return assets;
}

export class WorldGenesisProvenanceStore {
    private readonly database: Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        try {
            this.database.run('PRAGMA journal_mode = WAL');
            const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
            if (version > WORLD_GENESIS_PROVENANCE_STORE_SCHEMA_VERSION) {
                throw new Error(`Genesis provenance schema ${version} is newer than supported`);
            }
            if (version < 1) {
                const migration = this.database.transaction(() => {
                    this.database.run(`CREATE TABLE genesis_asset_provenance (
                        provenance_id TEXT PRIMARY KEY,source TEXT NOT NULL CHECK(source='world-genesis'),
                        result_id TEXT NOT NULL,result_digest TEXT NOT NULL,configuration_digest TEXT NOT NULL,
                        allocation_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('currency','item','property','business')),
                        owner_kind TEXT NOT NULL CHECK(owner_kind IN ('player','business','faction','world')),
                        owner_id TEXT NOT NULL,asset_json TEXT NOT NULL,asset_digest TEXT NOT NULL,
                        created_at_simulation_time TEXT NOT NULL,created_at_audit TEXT NOT NULL,
                        UNIQUE(result_digest,allocation_id))`);
                    this.database.run('CREATE INDEX genesis_asset_owner ON genesis_asset_provenance(owner_kind,owner_id,kind)');
                    this.database.run('PRAGMA user_version = 1');
                });
                migration.immediate();
            }
        } catch (error) { this.database.close(false); throw error; }
    }

    close(): void { this.database.close(false); }

    recordResult(resultInput: WorldGenesisResult, createdAtSimulationTime: string,
        createdAtAudit = new Date().toISOString()): GenesisAssetProvenance[] {
        const result = validateWorldGenesisResult(resultInput), assets = resultAssets(result);
        const simulationTime = timestamp(createdAtSimulationTime, 'Genesis provenance simulation time');
        const auditTime = timestamp(createdAtAudit, 'Genesis provenance audit time');
        const transaction = this.database.transaction(() => {
            for (const asset of assets) {
                const assetJson = JSON.stringify(asset), assetDigest = hash(asset);
                const provenanceId = `genesis-asset-${hash({ resultDigest: result.resultDigest,
                    allocationId: asset.allocationId }).slice(0, 24)}`;
                const existing = this.database.query(`SELECT * FROM genesis_asset_provenance
                    WHERE result_digest=?1 AND allocation_id=?2`).get(result.resultDigest,
                    asset.allocationId) as ProvenanceRow | null;
                if (existing) {
                    if (existing.asset_digest !== assetDigest || existing.created_at_simulation_time !== simulationTime) {
                        throw new Error('Genesis allocation id was reused with different provenance');
                    }
                    continue;
                }
                this.database.run(`INSERT INTO genesis_asset_provenance
                    (provenance_id,source,result_id,result_digest,configuration_digest,allocation_id,kind,
                    owner_kind,owner_id,asset_json,asset_digest,created_at_simulation_time,created_at_audit)
                    VALUES(?1,'world-genesis',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
                [provenanceId, result.resultId, result.resultDigest, result.configurationDigest, asset.allocationId,
                    asset.kind, asset.owner.kind, asset.owner.id, assetJson, assetDigest, simulationTime, auditTime]);
            }
        });
        transaction.immediate();
        return this.listByResult(result.resultDigest);
    }

    listByResult(resultDigest: string): GenesisAssetProvenance[] {
        if (!DIGEST.test(resultDigest)) throw new Error('Genesis result digest is invalid');
        return (this.database.query(`SELECT * FROM genesis_asset_provenance WHERE result_digest=?1
            ORDER BY allocation_id`).all(resultDigest) as ProvenanceRow[]).map(record);
    }

    listByOwner(ownerInput: GenesisAssetOwner): GenesisAssetProvenance[] {
        const value = owner(ownerInput);
        return (this.database.query(`SELECT * FROM genesis_asset_provenance WHERE owner_kind=?1 AND owner_id=?2
            ORDER BY created_at_simulation_time,allocation_id`).all(value.kind, value.id) as ProvenanceRow[]).map(record);
    }
}
