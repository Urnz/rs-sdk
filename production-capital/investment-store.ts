import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { businessRoleHasPermission, loadDefaultBusinessRoleCatalog, resolveBusinessRole,
    type BusinessRoleCatalog } from '../business-roles/index.js';
import type { FacilityCapabilityAuthorization } from '../facility-capability/index.js';
import { ItemLifecycleStore, itemLifecycleCatalogDigest, type ItemInstanceState,
    type ItemLifecycleCatalog } from '../item-lifecycle/index.js';
import { productionCapitalCatalogDigest } from './catalog.js';
import type { CapitalInstallationEvidence, ProductionCapitalCatalog } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{1,127}$/,DIGEST=/^[0-9a-f]{64}$/,ZERO='0'.repeat(64);
export interface ProductionCapitalInvestmentInput { operationId:string;businessId:string;actorAgentId:string;
    capitalAssetTypeId:string;itemInstanceId:string;sourceStorageId:string|null;qualityBasisPoints:number;
    productionEvidenceDigest:string;installationEvidenceId:string;facilityAuthorization:FacilityCapabilityAuthorization;
    atSimulationTime:string }
export interface ProductionCapitalInvestmentRecord { operationId:string;businessId:string;actorAgentId:string;
    capitalAssetTypeId:string;lifecycleTypeId:string;itemId:number;itemInstanceId:string;sourceStorageId:string|null;
    qualityBasisPoints:number;productionEvidenceDigest:string;installation:CapitalInstallationEvidence;
    requestDigest:string;committedAt:string;materializedAt:string|null }
export type InvestmentFacilityVerifier=(authorization:FacilityCapabilityAuthorization)=>boolean;
export type InvestmentReceiptVerifier=(record:ProductionCapitalInvestmentRecord)=>boolean;
type Row={operation_id:string;business_id:string;actor_agent_id:string;capital_asset_type_id:string;lifecycle_type_id:string;
    item_id:number;item_instance_id:string;source_storage_id:string|null;quality_bps:number;production_evidence_digest:string;
    installation_evidence_id:string;facility_id:string;facility_capability_id:string;facility_evidence_digest:string;
    request_digest:string;committed_at:string;materialized_at:string|null};
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function id(value:string,field:string):string{if(!ID.test(value))throw new Error(`${field} is invalid`);return value}
function time(value:string):string{const parsed=Date.parse(value);if(Number.isNaN(parsed)||new Date(parsed).toISOString()!==value)
    throw new Error('Investment simulation time is invalid');return value}
function record(row:Row):ProductionCapitalInvestmentRecord{return{operationId:row.operation_id,businessId:row.business_id,
    actorAgentId:row.actor_agent_id,capitalAssetTypeId:row.capital_asset_type_id,lifecycleTypeId:row.lifecycle_type_id,
    itemId:row.item_id,itemInstanceId:row.item_instance_id,sourceStorageId:row.source_storage_id,
    qualityBasisPoints:row.quality_bps,productionEvidenceDigest:row.production_evidence_digest,
    installation:{installationEvidenceId:row.installation_evidence_id,itemInstanceId:row.item_instance_id,
        facilityId:row.facility_id,capabilityId:row.facility_capability_id,status:'active',
        sourceEvidenceDigest:row.facility_evidence_digest},requestDigest:row.request_digest,
    committedAt:row.committed_at,materializedAt:row.materialized_at}}

export class ProductionCapitalInvestmentStore {
    private readonly database:Database;
    constructor(path:string,private readonly capitalCatalog:ProductionCapitalCatalog,
        private readonly lifecycleCatalog:ItemLifecycleCatalog,private readonly roles:BusinessRoleCatalog=loadDefaultBusinessRoleCatalog()){
        const{digest:capitalDigest,...capital}=capitalCatalog;if(capitalDigest!==productionCapitalCatalogDigest(capital))
            throw new Error('Production capital catalog digest mismatch');
        const{digest:lifecycleDigest,...lifecycle}=lifecycleCatalog;if(lifecycleDigest!==itemLifecycleCatalogDigest(lifecycle))
            throw new Error('Item lifecycle catalog digest mismatch');
        mkdirSync(dirname(path),{recursive:true});this.database=new Database(path,{create:true,strict:true});
        this.database.run('PRAGMA foreign_keys = ON');this.migrate()}
    close():void{this.database.close(true)}
    get(operationIdInput:string):ProductionCapitalInvestmentRecord|null{const row=this.database.query(
        'SELECT * FROM business_capital_investment WHERE operation_id=?1').get(id(operationIdInput,'operationId')) as Row|null;
        return row?record(row):null}
    commit(input:ProductionCapitalInvestmentInput,verifyFacility?:InvestmentFacilityVerifier):ProductionCapitalInvestmentRecord{
        const operationId=id(input.operationId,'operationId'),businessId=id(input.businessId,'businessId'),
            actorAgentId=id(input.actorAgentId,'actorAgentId'),itemInstanceId=id(input.itemInstanceId,'itemInstanceId'),
            installationEvidenceId=id(input.installationEvidenceId,'installationEvidenceId'),at=time(input.atSimulationTime),
            sourceStorageId=input.sourceStorageId===null?null:id(input.sourceStorageId,'sourceStorageId');
        if(!Number.isSafeInteger(input.qualityBasisPoints)||input.qualityBasisPoints<1||input.qualityBasisPoints>20_000
            ||!DIGEST.test(input.productionEvidenceDigest))throw new Error('Capital investment evidence is invalid');
        const definition=this.capitalCatalog.assets.find(asset=>asset.capitalAssetTypeId===input.capitalAssetTypeId),
            lifecycle=definition&&this.lifecycleCatalog.items.find(item=>item.lifecycleTypeId===definition.lifecycleTypeId);
        if(!definition||!lifecycle)throw new Error('Capital investment type is unknown');
        const business=this.database.query('SELECT owner_agent_id,property_id,status FROM business WHERE business_id=?1').get(businessId) as
            {owner_agent_id:string;property_id:string|null;status:string}|null,authorization=input.facilityAuthorization;
        if(!business||business.status!=='active')throw new Error('Capital investment requires an active Business');
        if(business.owner_agent_id!==actorAgentId){const employment=this.database.query(`SELECT role_definition_id FROM business_employment
            WHERE business_id=?1 AND worker_agent_id=?2 AND status='active'`).get(businessId,actorAgentId) as{role_definition_id:string}|null;
            if(!employment||!businessRoleHasPermission(resolveBusinessRole(this.roles,employment.role_definition_id),
                sourceStorageId?'storage':'inventory',sourceStorageId?'withdraw':'issue'))throw new Error('Business role cannot invest this asset')}
        if(authorization.subjectAgentId!==actorAgentId||authorization.propertyId!==business.property_id
            ||authorization.capabilityId!==definition.installationCapabilityId
            ||(authorization.businessId!==null&&authorization.businessId!==businessId)||!verifyFacility?.(authorization))
            throw new Error('Capital investment facility authority is invalid');
        const request={operationId,businessId,actorAgentId,capitalAssetTypeId:definition.capitalAssetTypeId,
            lifecycleTypeId:lifecycle.lifecycleTypeId,itemId:lifecycle.itemId,itemInstanceId,sourceStorageId,
            qualityBasisPoints:input.qualityBasisPoints,productionEvidenceDigest:input.productionEvidenceDigest,
            installationEvidenceId,facilityAuthorization:authorization,atSimulationTime:at},requestDigest=hash(request),existing=this.get(operationId);
        if(existing){if(existing.requestDigest!==requestDigest)throw new Error('Capital investment operation id was reused');return existing}
        if(this.database.query('SELECT 1 ok FROM business_capital_investment WHERE item_instance_id=?1').get(itemInstanceId))
            throw new Error('Capital investment item instance id was reused');
        const transaction=this.database.transaction(()=>{const removed=sourceStorageId?this.database.run(`UPDATE business_storage_item
                SET count=count-1,revision=revision+1,updated_at=?4 WHERE business_id=?1 AND storage_id=?2 AND item_id=?3 AND count>=1`,
                [businessId,sourceStorageId,lifecycle.itemId,at]):this.database.run(`UPDATE business_inventory
                SET count=count-1,revision=revision+1,updated_at=?3 WHERE business_id=?1 AND item_id=?2 AND count>=1`,
                [businessId,lifecycle.itemId,at]);if(removed.changes!==1)throw new Error('Capital investment asset stock is insufficient');
            this.database.run(`INSERT INTO business_capital_investment VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,NULL)`,
                [operationId,businessId,actorAgentId,definition.capitalAssetTypeId,lifecycle.lifecycleTypeId,lifecycle.itemId,
                    itemInstanceId,sourceStorageId,input.qualityBasisPoints,input.productionEvidenceDigest,installationEvidenceId,
                    authorization.facilityId,authorization.capabilityId,hash(authorization),requestDigest,at]);
            this.audit(operationId,'committed',at,{requestDigest,itemInstanceId,itemId:lifecycle.itemId})});
        transaction.immediate();return this.get(operationId)!}
    materialize(operationIdInput:string,lifecycleStore:ItemLifecycleStore,verify?:InvestmentReceiptVerifier):ItemInstanceState{
        const investment=this.get(operationIdInput);if(!investment||!verify?.(investment))throw new Error('Capital investment receipt is not trusted');
        const item=lifecycleStore.create({itemInstanceId:investment.itemInstanceId,lifecycleTypeId:investment.lifecycleTypeId,
            ownerActorId:investment.businessId,qualityBasisPoints:investment.qualityBasisPoints,
            provenanceDigest:investment.requestDigest,atSimulationTime:investment.committedAt});
        if(!investment.materializedAt){const transaction=this.database.transaction(()=>{const changed=this.database.run(
                `UPDATE business_capital_investment SET materialized_at=?2 WHERE operation_id=?1 AND materialized_at IS NULL`,
                [investment.operationId,investment.committedAt]);if(changed.changes===1)this.audit(investment.operationId,'materialized',
                    investment.committedAt,{itemInstanceId:investment.itemInstanceId,requestDigest:investment.requestDigest})});
            transaction.immediate()}return item}
    verifyAuditChain():boolean{const rows=this.database.query(`SELECT previous_hash,entry_hash,payload_json
        FROM business_capital_investment_audit ORDER BY sequence`).all() as Array<{previous_hash:string;entry_hash:string;payload_json:string}>;
        let head=ZERO;for(const row of rows){if(row.previous_hash!==head||hash({previousHash:head,payload:JSON.parse(row.payload_json)})!==row.entry_hash)
            return false;head=row.entry_hash}return true}
    private audit(operationId:string,kind:string,at:string,detail:Record<string,unknown>):void{const previous=(this.database.query(
        'SELECT entry_hash FROM business_capital_investment_audit ORDER BY sequence DESC LIMIT 1').get() as{entry_hash:string}|null)?.entry_hash??ZERO,
        payload={operationId,kind,at,detail};this.database.run(`INSERT INTO business_capital_investment_audit
        (operation_id,kind,payload_json,previous_hash,entry_hash) VALUES(?1,?2,?3,?4,?5)`,
        [operationId,kind,JSON.stringify(payload),previous,hash({previousHash:previous,payload})])}
    private migrate():void{this.database.run(`CREATE TABLE IF NOT EXISTS business_capital_investment(
        operation_id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES business(business_id),actor_agent_id TEXT NOT NULL,
        capital_asset_type_id TEXT NOT NULL,lifecycle_type_id TEXT NOT NULL,item_id INTEGER NOT NULL,item_instance_id TEXT NOT NULL UNIQUE,
        source_storage_id TEXT,quality_bps INTEGER NOT NULL,production_evidence_digest TEXT NOT NULL,installation_evidence_id TEXT NOT NULL,
        facility_id TEXT NOT NULL,facility_capability_id TEXT NOT NULL,facility_evidence_digest TEXT NOT NULL,request_digest TEXT NOT NULL,
        committed_at TEXT NOT NULL,materialized_at TEXT)`);this.database.run(`CREATE TABLE IF NOT EXISTS business_capital_investment_audit(
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL,kind TEXT NOT NULL,payload_json TEXT NOT NULL,
        previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`)}}
