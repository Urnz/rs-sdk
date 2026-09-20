import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { itemLifecycleCatalogDigest } from './catalog.js';
import { assertVerifiedRepairAuthorization } from './repair-authorization.js';
import type { VerifiedRepairAuthorization } from './repair-authorization.js';
import type { ItemInstanceState, ItemLifecycleCatalog, ItemLifecycleLoopMetrics, ItemReplacementRecord } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i, ZERO = '0'.repeat(64), DIGEST = /^[0-9a-f]{64}$/;
type Row = { item_instance_id: string; lifecycle_type_id: string; item_id: number; owner_actor_id: string;
    durability: number; max_durability: number; status: 'usable'|'broken'; quality_bps: number;
    provenance_digest: string; created_at: string; updated_at: string; revision: number };
type ReplacementRow = { operation_id:string; replaced_item_instance_id:string; replacement_item_instance_id:string;
    owner_actor_id:string; evidence_digest:string; occurred_at:string };
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function id(value: string, field: string): string { if (!ID.test(value)) throw new Error(`${field} is invalid`); return value; }
function time(value: string): string { const parsed = Date.parse(value);
    if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) throw new Error('Simulation time is invalid'); return value; }
function state(row: Row): ItemInstanceState { return { itemInstanceId: row.item_instance_id,
    lifecycleTypeId: row.lifecycle_type_id, itemId: row.item_id, ownerActorId: row.owner_actor_id,
    durability: row.durability, maxDurability: row.max_durability, status: row.status,
    qualityBasisPoints: row.quality_bps, provenanceDigest: row.provenance_digest,
    createdAtSimulationTime: row.created_at, updatedAtSimulationTime: row.updated_at, revision: row.revision }; }

export class ItemLifecycleStore {
    private readonly database: Database;
    constructor(path: string, private readonly catalog: ItemLifecycleCatalog) {
        const { digest, ...definition } = catalog;
        if (digest !== itemLifecycleCatalogDigest(definition)) throw new Error('Item lifecycle catalog digest mismatch');
        mkdirSync(dirname(path), { recursive: true }); this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON'); this.migrate();
    }
    close(): void { this.database.close(true); }
    get(itemInstanceId: string): ItemInstanceState | null { const row = this.database.query(
        'SELECT * FROM item_instance WHERE item_instance_id=?1').get(id(itemInstanceId, 'Item instance id')) as Row|null;
        return row ? state(row) : null; }
    hasOperation(operationId:string):boolean{return this.database.query(`SELECT 1 AS found FROM item_lifecycle_operation
        WHERE operation_id=?1`).get(id(operationId,'Operation id'))!==null;}
    remainingUses(itemInstanceId:string):number{const item=this.get(itemInstanceId);if(!item)throw new Error('Unknown item instance');
        if(item.status==='broken'||this.getReplacement(itemInstanceId))return 0;
        const definition=this.catalog.items.find(candidate=>candidate.lifecycleTypeId===item.lifecycleTypeId);
        if(!definition)throw new Error('Unknown lifecycle item type');return Math.floor(item.durability/definition.wearPerUse);}
    getReplacement(itemInstanceId:string):ItemReplacementRecord|null{const row=this.database.query(`SELECT * FROM item_replacement
        WHERE replaced_item_instance_id=?1`).get(id(itemInstanceId,'Item instance id')) as ReplacementRow|null;
        return row?{operationId:row.operation_id,replacedItemInstanceId:row.replaced_item_instance_id,
            replacementItemInstanceId:row.replacement_item_instance_id,ownerActorId:row.owner_actor_id,
            evidenceDigest:row.evidence_digest,occurredAtSimulationTime:row.occurred_at}:null;}
    loopMetrics(lifecycleTypeId:string,ownerActorId?:string):ItemLifecycleLoopMetrics{
        const type=id(lifecycleTypeId,'Lifecycle type id'),owner=ownerActorId===undefined?null:id(ownerActorId,'Owner actor id');
        if(!this.catalog.items.some(item=>item.lifecycleTypeId===type))throw new Error('Unknown lifecycle item type');
        const instances=this.database.query(`SELECT item_instance_id,status FROM item_instance
            WHERE lifecycle_type_id=?1 AND (?2 IS NULL OR owner_actor_id=?2)`).all(type,owner) as
            Array<{item_instance_id:string;status:'usable'|'broken'}>;
        const instanceIds=new Set(instances.map(item=>item.item_instance_id)),operations=this.database.query(
            `SELECT item_instance_id,kind,detail_json FROM item_lifecycle_operation WHERE kind IN ('used','replaced')`).all() as
            Array<{item_instance_id:string;kind:string;detail_json:string}>;
        let successfulUses=0,breakages=0,replacements=0;
        for(const operation of operations){if(!instanceIds.has(operation.item_instance_id))continue;
            if(operation.kind==='replaced'){replacements++;continue;}const detail=JSON.parse(operation.detail_json) as{amount?:unknown;after?:unknown};
            if(Number.isSafeInteger(detail.amount))successfulUses+=Number(detail.amount);if(detail.after===0)breakages++;}
        const brokenAwaitingReplacement=instances.filter(item=>item.status==='broken'&&!this.getReplacement(item.item_instance_id)).length;
        return{lifecycleTypeId:type,ownerActorId:owner,usableStock:instances.filter(item=>item.status==='usable').length,
            brokenAwaitingReplacement,successfulUses,breakages,replacements,
            replacementCoverageBasisPoints:breakages===0?null:Math.floor(replacements*10_000/breakages),
            replacementsPerThousandUses:successfulUses===0?null:Math.floor(replacements*1_000/successfulUses)};
    }
    create(input: { itemInstanceId: string; lifecycleTypeId: string; ownerActorId: string;
        qualityBasisPoints: number; provenanceDigest: string; atSimulationTime: string }): ItemInstanceState {
        const instanceId = id(input.itemInstanceId, 'Item instance id'), owner = id(input.ownerActorId, 'Owner actor id');
        const definition = this.catalog.items.find(item => item.lifecycleTypeId === input.lifecycleTypeId);
        if (!definition) throw new Error('Unknown lifecycle item type');
        if (!Number.isSafeInteger(input.qualityBasisPoints) || input.qualityBasisPoints < 1
            || input.qualityBasisPoints > 20_000 || !DIGEST.test(input.provenanceDigest)) throw new Error('Item provenance is invalid');
        const at = time(input.atSimulationTime), existing = this.get(instanceId);
        if (existing) { if (existing.lifecycleTypeId !== input.lifecycleTypeId || existing.ownerActorId !== owner
            || existing.qualityBasisPoints !== input.qualityBasisPoints
            || existing.provenanceDigest !== input.provenanceDigest) throw new Error('Item instance id was reused'); return existing; }
        const transaction = this.database.transaction(() => { this.database.run(`INSERT INTO item_instance
            VALUES(?1,?2,?3,?4,?5,?5,'usable',?6,?7,?8,?8,1)`, [instanceId, definition.lifecycleTypeId,
            definition.itemId, owner, definition.maxDurability, input.qualityBasisPoints, input.provenanceDigest, at]);
            this.operation('created', `create:${instanceId}`, instanceId, at, { provenanceDigest: input.provenanceDigest }); });
        transaction.immediate(); return this.get(instanceId)!;
    }
    use(operationId: string, itemInstanceId: string, expectedRevision: number, useCount: number,
        evidenceDigest: string, atSimulationTime: string): ItemInstanceState {
        return this.mutate('used', operationId, itemInstanceId, expectedRevision, useCount, evidenceDigest,
            atSimulationTime, false);
    }
    applyVerifiedRepair(authorization:VerifiedRepairAuthorization):ItemInstanceState{
        assertVerifiedRepairAuthorization(authorization);
        return this.mutate('repaired',authorization.operationId,authorization.itemInstanceId,
            authorization.expectedRevision,authorization.restoredDurability,authorization.authorizationDigest,
            authorization.atSimulationTime,true,authorization.evidence);
    }
    replace(input:{operationId:string;replacedItemInstanceId:string;replacementItemInstanceId:string;
        expectedRevision:number;ownerActorId:string;qualityBasisPoints:number;provenanceDigest:string;
        evidenceDigest:string;atSimulationTime:string}):ItemInstanceState{
        const operationId=id(input.operationId,'Operation id'),replacedId=id(input.replacedItemInstanceId,'Replaced item instance id');
        const replacementId=id(input.replacementItemInstanceId,'Replacement item instance id'),owner=id(input.ownerActorId,'Owner actor id');
        if(replacedId===replacementId||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1
            ||!Number.isSafeInteger(input.qualityBasisPoints)||input.qualityBasisPoints<1||input.qualityBasisPoints>20_000
            ||!DIGEST.test(input.provenanceDigest)||!DIGEST.test(input.evidenceDigest))throw new Error('Replacement evidence is invalid');
        const at=time(input.atSimulationTime),current=this.get(replacedId);if(!current)throw new Error('Unknown replaced item instance');
        const requestDigest=hash({replacedId,replacementId,expectedRevision:input.expectedRevision,owner,
            qualityBasisPoints:input.qualityBasisPoints,provenanceDigest:input.provenanceDigest,evidenceDigest:input.evidenceDigest});
        const existing=this.database.query(`SELECT request_digest,detail_json FROM item_lifecycle_operation WHERE operation_id=?1`)
            .get(operationId) as {request_digest:string;detail_json:string}|null;
        if(existing){if(existing.request_digest!==requestDigest)throw new Error('Lifecycle operation id was reused');
            const detail=JSON.parse(existing.detail_json) as {replacementItemInstanceId:string};
            return this.get(detail.replacementItemInstanceId)!;}
        if(current.revision!==input.expectedRevision)throw new Error('Item instance changed before replacement');
        if(current.ownerActorId!==owner||current.status!=='broken'||this.getReplacement(replacedId))
            throw new Error('Only an owned unreplaced broken item can be replaced');
        if(this.get(replacementId))throw new Error('Replacement item instance id already exists');
        if(Date.parse(at)<Date.parse(current.updatedAtSimulationTime))throw new Error('Replacement precedes current simulation time');
        const definition=this.catalog.items.find(item=>item.lifecycleTypeId===current.lifecycleTypeId)!;
        const detail={replacementItemInstanceId:replacementId,evidenceDigest:input.evidenceDigest,
            provenanceDigest:input.provenanceDigest,requestDigest};
        const transaction=this.database.transaction(()=>{const changed=this.database.run(`UPDATE item_instance
            SET updated_at=?3,revision=revision+1 WHERE item_instance_id=?1 AND revision=?2`,[replacedId,input.expectedRevision,at]);
            if(changed.changes!==1)throw new Error('Item instance changed before replacement');
            this.database.run(`INSERT INTO item_instance VALUES(?1,?2,?3,?4,?5,?5,'usable',?6,?7,?8,?8,1)`,
                [replacementId,definition.lifecycleTypeId,definition.itemId,owner,definition.maxDurability,
                    input.qualityBasisPoints,input.provenanceDigest,at]);
            this.operation('replaced',operationId,replacedId,at,detail);
            this.database.run(`INSERT INTO item_replacement VALUES(?1,?2,?3,?4,?5,?6)`,
                [operationId,replacedId,replacementId,owner,input.evidenceDigest,at]);});
        transaction.immediate();return this.get(replacementId)!;
    }
    verifyAuditChain(): boolean { const rows = this.database.query(`SELECT previous_hash,entry_hash,payload_json
        FROM item_lifecycle_audit ORDER BY sequence`).all() as Array<{previous_hash:string;entry_hash:string;payload_json:string}>;
        let head=ZERO; for(const row of rows){if(row.previous_hash!==head
            ||hash({previousHash:head,payload:JSON.parse(row.payload_json)})!==row.entry_hash)return false;head=row.entry_hash;}return true; }
    private mutate(kind: 'used'|'repaired', operationId: string, instanceId: string, expectedRevision: number,
        amount: number, evidenceDigest: string, atInput: string, repair: boolean,
        evidenceDetail?:Record<string,unknown>): ItemInstanceState {
        id(operationId, 'Operation id'); if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000
            || !DIGEST.test(evidenceDigest)) throw new Error('Lifecycle operation evidence is invalid');
        const current = this.get(instanceId); if (!current) throw new Error('Unknown item instance');
        const existing = this.database.query(`SELECT request_digest,detail_json,occurred_at FROM item_lifecycle_operation
            WHERE operation_id=?1`).get(operationId) as {request_digest:string;detail_json:string;occurred_at:string}|null;
        const requestDigest=hash({kind,instanceId,expectedRevision,amount,evidenceDigest});
        if(existing){if(existing.request_digest!==requestDigest)throw new Error('Lifecycle operation id was reused');
            const detail=JSON.parse(existing.detail_json) as {after:number};return {...current,durability:detail.after,
                status:detail.after===0?'broken':'usable',updatedAtSimulationTime:existing.occurred_at,
                revision:expectedRevision+1};}
        if(repair&&evidenceDetail){const materialReceiptId=id(String(evidenceDetail.materialReceiptId),'Material receipt id');
            const consumed=this.database.query(`SELECT operation_id FROM item_repair_evidence WHERE material_receipt_id=?1`)
                .get(materialReceiptId) as{operation_id:string}|null;
            if(consumed)throw new Error('Repair material receipt was already consumed');}
        const definition=this.catalog.items.find(item=>item.lifecycleTypeId===current.lifecycleTypeId)!;
        if(this.getReplacement(instanceId))throw new Error('Replaced item cannot be used or repaired');
        if(repair&&!definition.repairable)throw new Error('Item type is not repairable');
        if(!repair&&current.status==='broken')throw new Error('Broken item cannot be used');
        const delta=repair?amount:-(definition.wearPerUse*amount), next=Math.max(0,Math.min(current.maxDurability,current.durability+delta));
        if(repair&&next===current.durability)throw new Error('Repair would not restore durability');
        const at=time(atInput);if(Date.parse(at)<Date.parse(current.updatedAtSimulationTime)){
            throw new Error('Lifecycle operation precedes current simulation time');
        }
        const status=next===0?'broken':'usable'; const transaction=this.database.transaction(()=>{
            const changed=this.database.run(`UPDATE item_instance SET durability=?3,status=?4,updated_at=?5,revision=revision+1
                WHERE item_instance_id=?1 AND revision=?2`,[current.itemInstanceId,expectedRevision,next,status,at]);
            if(changed.changes!==1)throw new Error('Item instance changed before lifecycle operation');
            this.operation(kind,operationId,current.itemInstanceId,at,{amount,evidenceDigest,evidenceDetail,
                before:current.durability,after:next,requestDigest});
            if(repair&&evidenceDetail)this.database.run(`INSERT INTO item_repair_evidence
                (material_receipt_id,operation_id,receipt_digest) VALUES(?1,?2,?3)`,
            [String(evidenceDetail.materialReceiptId),operationId,String(evidenceDetail.inputReceiptDigest)]);});
        transaction.immediate();return this.get(current.itemInstanceId)!;
    }
    private operation(kind:string,operationId:string,instanceId:string,at:string,detail:Record<string,unknown>):void{
        const requestDigest=typeof detail.requestDigest==='string'?detail.requestDigest:hash(detail);
        this.database.run('INSERT INTO item_lifecycle_operation VALUES(?1,?2,?3,?4,?5,?6)',
            [operationId,instanceId,kind,requestDigest,JSON.stringify(detail),at]);
        const last=this.database.query('SELECT entry_hash FROM item_lifecycle_audit ORDER BY sequence DESC LIMIT 1')
            .get() as {entry_hash:string}|null;const previousHash=last?.entry_hash??ZERO,payload={kind,operationId,instanceId,at,detail};
        this.database.run(`INSERT INTO item_lifecycle_audit
            (operation_id,payload_json,previous_hash,entry_hash) VALUES(?1,?2,?3,?4)`,
        [operationId,JSON.stringify(payload),previousHash,hash({previousHash,payload})]); }
    private migrate():void{let version=Number((this.database.query('PRAGMA user_version').get() as{user_version:number}).user_version);
        if(version>3)throw new Error(`Item lifecycle schema ${version} is newer than supported version 3`);
        if(version===0){const transaction=this.database.transaction(()=>{this.database.run(`CREATE TABLE item_instance (
            item_instance_id TEXT PRIMARY KEY,lifecycle_type_id TEXT NOT NULL,item_id INTEGER NOT NULL,owner_actor_id TEXT NOT NULL,
            durability INTEGER NOT NULL,max_durability INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('usable','broken')),
            quality_bps INTEGER NOT NULL,provenance_digest TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL)`);
            this.database.run(`CREATE TABLE item_lifecycle_operation (operation_id TEXT PRIMARY KEY,item_instance_id TEXT NOT NULL
            REFERENCES item_instance(item_instance_id),kind TEXT NOT NULL,request_digest TEXT NOT NULL,detail_json TEXT NOT NULL,occurred_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE item_lifecycle_audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');});transaction.immediate();version=1;}
        if(version===1){const transaction=this.database.transaction(()=>{this.database.run(`CREATE TABLE item_replacement (
            operation_id TEXT PRIMARY KEY REFERENCES item_lifecycle_operation(operation_id),
            replaced_item_instance_id TEXT NOT NULL UNIQUE REFERENCES item_instance(item_instance_id),
            replacement_item_instance_id TEXT NOT NULL UNIQUE REFERENCES item_instance(item_instance_id),
            owner_actor_id TEXT NOT NULL,evidence_digest TEXT NOT NULL,occurred_at TEXT NOT NULL)`);
            this.database.run('PRAGMA user_version = 2');});transaction.immediate();version=2;}
        if(version===2){const transaction=this.database.transaction(()=>{this.database.run(`CREATE TABLE item_repair_evidence (
            material_receipt_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE REFERENCES item_lifecycle_operation(operation_id),
            receipt_digest TEXT NOT NULL)`);this.database.run('PRAGMA user_version = 3');});transaction.immediate();}}
}
