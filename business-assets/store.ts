import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import { businessRoleHasPermission, loadDefaultBusinessRoleCatalog, resolveBusinessRole,
    type BusinessPermission, type BusinessPermissionDomain, type BusinessRoleCatalog } from '../business-roles/index.js';

export interface BusinessStorage { storageId:string;businessId:string;name:string;propertyId:string|null;
    capacityUnits:number;usedUnits:number;revision:number;createdAt:string;updatedAt:string }
export interface BusinessAssetEntry { businessId:string;storageId:string|null;itemId:number;count:number;
    revision:number;updatedAt:string }
export interface BusinessAssetMovement { operationId:string;businessId:string;actorAgentId:string;itemId:number;
    count:number;sourceStorageId:string|null;targetStorageId:string|null;createdAt:string }
export interface CreateBusinessStorage { storageId:string;businessId:string;actorAgentId:string;name:string;
    propertyId?:string|null;capacityUnits:number }
export interface MoveBusinessAssets { operationId:string;businessId:string;actorAgentId:string;itemId:number;
    count:number;sourceStorageId:string|null;targetStorageId:string|null }

interface StorageRow { storage_id:string;business_id:string;name:string;property_id:string|null;
    capacity_units:number;revision:number;created_at:string;updated_at:string }
interface ItemRow { business_id:string;storage_id:string;item_id:number;count:number;revision:number;updated_at:string }
interface MovementRow { operation_id:string;business_id:string;actor_agent_id:string;item_id:number;count:number;
    source_storage_id:string|null;target_storage_id:string|null;created_at:string }

function id(value:string,field:string):string { const normalized=value.trim().toLowerCase();
    if(!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(normalized))throw new Error(`${field} is invalid`);return normalized }
function positive(value:number,field:string,maximum=2_147_483_647):number {
    if(!Number.isSafeInteger(value)||value<1||value>maximum)throw new Error(`${field} is invalid`);return value }
function validatedItemId(value:number):number {if(!Number.isSafeInteger(value)||value<0||value>65534)
    throw new Error('itemId is invalid');return value}
function movement(row:MovementRow):BusinessAssetMovement{return {operationId:row.operation_id,businessId:row.business_id,
    actorAgentId:row.actor_agent_id,itemId:row.item_id,count:row.count,sourceStorageId:row.source_storage_id,
    targetStorageId:row.target_storage_id,createdAt:row.created_at}}

export class BusinessAssetStore {
    private readonly database:Database;
    constructor(path:string,private readonly roleCatalog:BusinessRoleCatalog=loadDefaultBusinessRoleCatalog()){
        mkdirSync(dirname(path),{recursive:true});this.database=new Database(path,{create:true,strict:true});
        this.database.run('PRAGMA foreign_keys = ON');
        this.database.run(`CREATE TABLE IF NOT EXISTS business_storage (
            storage_id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES business(business_id),name TEXT NOT NULL,
            property_id TEXT,capacity_units INTEGER NOT NULL CHECK(capacity_units>0),revision INTEGER NOT NULL CHECK(revision>=1),
            created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS business_storage_item (
            business_id TEXT NOT NULL,storage_id TEXT NOT NULL REFERENCES business_storage(storage_id),item_id INTEGER NOT NULL,
            count INTEGER NOT NULL CHECK(count>=0),revision INTEGER NOT NULL CHECK(revision>=1),updated_at TEXT NOT NULL,
            PRIMARY KEY(storage_id,item_id),FOREIGN KEY(business_id) REFERENCES business(business_id))`);
        this.database.run(`CREATE TABLE IF NOT EXISTS business_asset_movement (
            operation_id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES business(business_id),actor_agent_id TEXT NOT NULL,
            item_id INTEGER NOT NULL,count INTEGER NOT NULL CHECK(count>0),source_storage_id TEXT,target_storage_id TEXT,
            created_at TEXT NOT NULL,CHECK(source_storage_id IS NOT target_storage_id))`);
    }
    close():void{this.database.close(true)}

    listStorages(businessIdInput:string):BusinessStorage[]{const businessId=id(businessIdInput,'businessId');
        const rows=this.database.query(`SELECT s.*,COALESCE(SUM(i.count),0) used_units FROM business_storage s
            LEFT JOIN business_storage_item i ON i.storage_id=s.storage_id WHERE s.business_id=?1
            GROUP BY s.storage_id ORDER BY s.storage_id`).all(businessId) as Array<StorageRow&{used_units:number}>;
        return rows.map(row=>({storageId:row.storage_id,businessId:row.business_id,name:row.name,propertyId:row.property_id,
            capacityUnits:row.capacity_units,usedUnits:row.used_units,revision:row.revision,
            createdAt:row.created_at,updatedAt:row.updated_at}))}

    createStorage(input:CreateBusinessStorage,now=new Date().toISOString()):BusinessStorage{
        const businessId=id(input.businessId,'businessId'),storageId=id(input.storageId,'storageId');
        const actorAgentId=id(input.actorAgentId,'actorAgentId'),name=input.name.trim().replace(/\s+/g,' ');
        if(!name||name.length>120)throw new Error('storage name is invalid');
        const propertyId=input.propertyId?id(input.propertyId,'propertyId'):null;
        positive(input.capacityUnits,'storage capacity',1_000_000_000);
        this.requirePermission(businessId,actorAgentId,'storage','assign');
        this.database.run(`INSERT INTO business_storage VALUES(?1,?2,?3,?4,?5,1,?6,?6)`,
            [storageId,businessId,name,propertyId,input.capacityUnits,now]);
        return this.listStorages(businessId).find(storage=>storage.storageId===storageId)!;
    }

    listAssets(businessIdInput:string,storageIdInput:string|null):BusinessAssetEntry[]{
        const businessId=id(businessIdInput,'businessId');
        if(storageIdInput===null)return (this.database.query(`SELECT * FROM business_inventory WHERE business_id=?1
            ORDER BY item_id`).all(businessId) as Array<{business_id:string;item_id:number;count:number;revision:number;
            updated_at:string}>).map(row=>({businessId:row.business_id,storageId:null,itemId:row.item_id,count:row.count,
            revision:row.revision,updatedAt:row.updated_at}));
        const storageId=id(storageIdInput,'storageId');this.requireStorage(businessId,storageId);
        return (this.database.query(`SELECT * FROM business_storage_item WHERE business_id=?1 AND storage_id=?2
            ORDER BY item_id`).all(businessId,storageId) as ItemRow[]).map(row=>({businessId:row.business_id,
            storageId:row.storage_id,itemId:row.item_id,count:row.count,revision:row.revision,updatedAt:row.updated_at}))
    }

    move(input:MoveBusinessAssets,now=new Date().toISOString()):BusinessAssetMovement{
        const operationId=id(input.operationId,'operationId'),businessId=id(input.businessId,'businessId');
        const actorAgentId=id(input.actorAgentId,'actorAgentId'),itemId=validatedItemId(input.itemId);
        const count=positive(input.count,'count'),source=input.sourceStorageId?id(input.sourceStorageId,'sourceStorageId'):null;
        const target=input.targetStorageId?id(input.targetStorageId,'targetStorageId'):null;
        if(source===target)throw new Error('Business asset movement requires distinct locations');
        const replay=this.getMovement(operationId);if(replay){const expected={businessId,actorAgentId,itemId,count,
            sourceStorageId:source,targetStorageId:target};for(const [key,value] of Object.entries(expected))
            if(replay[key as keyof BusinessAssetMovement]!==value)throw new Error('Business asset operation id was reused');return replay}
        this.requirePermission(businessId,actorAgentId,source?'storage':'inventory',source?'withdraw':'issue');
        this.requirePermission(businessId,actorAgentId,target?'storage':'inventory',target?'deposit':'receive');
        if(source)this.requireStorage(businessId,source);if(target)this.requireStorage(businessId,target);
        const transaction=this.database.transaction(()=>{
            if(target){const storage=this.listStorages(businessId).find(value=>value.storageId===target)!;
                if(storage.usedUnits+count>storage.capacityUnits)throw new Error('Business storage capacity exceeded')}
            const removed=source?this.database.run(`UPDATE business_storage_item SET count=count-?4,revision=revision+1,
                updated_at=?5 WHERE business_id=?1 AND storage_id=?2 AND item_id=?3 AND count>=?4`,
            [businessId,source,itemId,count,now]):this.database.run(`UPDATE business_inventory SET count=count-?3,
                revision=revision+1,updated_at=?4 WHERE business_id=?1 AND item_id=?2 AND count>=?3`,
            [businessId,itemId,count,now]);if(removed.changes!==1)throw new Error('Business asset source has insufficient stock');
            if(target)this.database.run(`INSERT INTO business_storage_item VALUES(?1,?2,?3,?4,1,?5)
                ON CONFLICT(storage_id,item_id) DO UPDATE SET count=count+excluded.count,revision=revision+1,
                updated_at=excluded.updated_at`,[businessId,target,itemId,count,now]);
            else this.database.run(`INSERT INTO business_inventory VALUES(?1,?2,?3,1,?4)
                ON CONFLICT(business_id,item_id) DO UPDATE SET count=count+excluded.count,revision=revision+1,
                updated_at=excluded.updated_at`,[businessId,itemId,count,now]);
            this.database.run(`INSERT INTO business_asset_movement VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`,
                [operationId,businessId,actorAgentId,itemId,count,source,target,now]);
        });transaction.immediate();return this.getMovement(operationId)!;
    }

    listMovements(businessIdInput:string):BusinessAssetMovement[]{const businessId=id(businessIdInput,'businessId');
        return (this.database.query(`SELECT * FROM business_asset_movement WHERE business_id=?1
            ORDER BY created_at,operation_id`).all(businessId) as MovementRow[]).map(movement)}
    private getMovement(operationId:string):BusinessAssetMovement|null{const row=this.database.query(
        'SELECT * FROM business_asset_movement WHERE operation_id=?1').get(operationId) as MovementRow|null;return row?movement(row):null}
    private requireStorage(businessId:string,storageId:string):void{const row=this.database.query(
        'SELECT 1 ok FROM business_storage WHERE business_id=?1 AND storage_id=?2').get(businessId,storageId);
        if(!row)throw new Error('Business storage does not exist')}
    private requirePermission(businessId:string,actorAgentId:string,domain:BusinessPermissionDomain,
        permission:BusinessPermission):void{const business=this.database.query('SELECT owner_agent_id,status FROM business WHERE business_id=?1')
            .get(businessId) as {owner_agent_id:string;status:string}|null;if(!business||business.status!=='active')
            throw new Error('Business asset operation requires an active business');if(business.owner_agent_id===actorAgentId)return;
        const employment=this.database.query(`SELECT role_definition_id FROM business_employment WHERE business_id=?1
            AND worker_agent_id=?2 AND status='active'`).get(businessId,actorAgentId) as {role_definition_id:string}|null;
        if(!employment||!businessRoleHasPermission(resolveBusinessRole(this.roleCatalog,employment.role_definition_id),domain,permission))
            throw new Error(`Business role lacks ${domain}.${permission} permission`)}
}
