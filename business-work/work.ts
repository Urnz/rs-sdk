import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { loadDefaultBusinessRoleCatalog,resolveBusinessRole,type BusinessRoleCatalog } from '../business-roles/index.js';

export interface SkillRef{id:string;version:string}
export interface BusinessWorkPolicy{policyId:string;businessId:string;roleDefinitionId:string;requiredSkill:SkillRef;
    propertyId:string;facilityCapability:string;minimumMinutes:number;maximumMinutes:number;
    paymentCondition:'verified-completion'}
export interface BusinessWorkPolicyCatalog{schemaVersion:1;policies:BusinessWorkPolicy[];digest:string}
export interface FacilityEntitlement{entitlementId:string;businessId:string;propertyId:string;facilityCapability:string;
    validFrom:string;validUntil:string|null;createdAt:string}
export interface BusinessWorkOrder{workOrderId:string;policyId:string;businessId:string;employmentId:string;
    workerAgentId:string;roleDefinitionId:string;skill:SkillRef;propertyId:string;facilityCapability:string;
    wageGp:number;scheduledStart:string;scheduledEnd:string;status:'scheduled'|'running'|'completed'|'cancelled';
    actualMinutes:number|null;evidenceId:string|null;wageStatus:'unearned'|'earned'|'paid';wageSettlementId:string|null;
    createdAt:string;updatedAt:string}
export interface WorkCompletionEvidence{evidenceId:string;workOrderId:string;businessId:string;workerAgentId:string;
    skill:SkillRef;status:'completed';startedAt:string;completedAt:string}
export type WorkEvidenceVerifier=(evidence:WorkCompletionEvidence)=>boolean;

const ID=/^[a-z0-9][a-z0-9._-]{1,119}$/;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]))}
function digest(value:unknown):string{return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}
function id(value:unknown,field:string):string{if(typeof value!=='string'||!ID.test(value))throw new Error(`${field} is invalid`);return value}
function time(value:string,field:string):string{if(!Number.isFinite(Date.parse(value)))throw new Error(`${field} is invalid`);return value}
function integer(value:unknown,field:string,minimum=0):number{if(!Number.isSafeInteger(value)||Number(value)<minimum||Number(value)>2_147_483_647)
    throw new Error(`${field} is invalid`);return Number(value)}
function exact(value:Record<string,unknown>,keys:string[],field:string):void{if(Object.keys(value).sort().join(',')!==keys.sort().join(','))
    throw new Error(`${field} is invalid`)}
function skill(value:unknown,field:string):SkillRef{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${field} is invalid`);
    const input=value as Record<string,unknown>;exact(input,['id','version'],field);return {id:id(input.id,`${field}.id`),
        version:typeof input.version==='string'&&/^\d+\.\d+\.\d+$/.test(input.version)?input.version:(()=>{throw new Error(`${field}.version is invalid`)})()}}
function workOrder(row:Record<string,unknown>):BusinessWorkOrder{return {workOrderId:String(row.work_order_id),policyId:String(row.policy_id),
    businessId:String(row.business_id),employmentId:String(row.employment_id),workerAgentId:String(row.worker_agent_id),
    roleDefinitionId:String(row.role_definition_id),skill:{id:String(row.skill_id),version:String(row.skill_version)},
    propertyId:String(row.property_id),facilityCapability:String(row.facility_capability),wageGp:Number(row.wage_gp),
    scheduledStart:String(row.scheduled_start),scheduledEnd:String(row.scheduled_end),status:row.status as BusinessWorkOrder['status'],
    actualMinutes:row.actual_minutes===null?null:Number(row.actual_minutes),evidenceId:row.evidence_id===null?null:String(row.evidence_id),
    wageStatus:row.wage_status as BusinessWorkOrder['wageStatus'],wageSettlementId:row.wage_settlement_id===null?null:String(row.wage_settlement_id),
    createdAt:String(row.created_at),updatedAt:String(row.updated_at)}}

export function validateBusinessWorkPolicyCatalog(value:unknown):BusinessWorkPolicyCatalog{if(!value||typeof value!=='object'||Array.isArray(value))
    throw new Error('Business work policy catalog is invalid');const input=value as Record<string,unknown>;
    exact(input,['schemaVersion','policies'],'Business work policy catalog');if(input.schemaVersion!==1||!Array.isArray(input.policies)||!input.policies.length)
        throw new Error('Business work policy catalog is invalid');const policies=input.policies.map((entry,index):BusinessWorkPolicy=>{
        const field=`policies[${index}]`;if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error(`${field} is invalid`);
        const item=entry as Record<string,unknown>;exact(item,['policyId','businessId','roleDefinitionId','requiredSkill','propertyId',
            'facilityCapability','minimumMinutes','maximumMinutes','paymentCondition'],field);const minimumMinutes=integer(item.minimumMinutes,
            `${field}.minimumMinutes`,1),maximumMinutes=integer(item.maximumMinutes,`${field}.maximumMinutes`,1);
        if(minimumMinutes>maximumMinutes||maximumMinutes>1440||item.paymentCondition!=='verified-completion')throw new Error(`${field} is invalid`);
        return {policyId:id(item.policyId,`${field}.policyId`),businessId:id(item.businessId,`${field}.businessId`),
            roleDefinitionId:id(item.roleDefinitionId,`${field}.roleDefinitionId`),requiredSkill:skill(item.requiredSkill,`${field}.requiredSkill`),
            propertyId:id(item.propertyId,`${field}.propertyId`),facilityCapability:id(item.facilityCapability,`${field}.facilityCapability`),
            minimumMinutes,maximumMinutes,paymentCondition:'verified-completion'}});if(new Set(policies.map(value=>value.policyId)).size!==policies.length)
        throw new Error('Business work policy ids must be unique');const definition={schemaVersion:1 as const,policies};return {...definition,digest:digest(definition)}}
export function loadDefaultBusinessWorkPolicyCatalog():BusinessWorkPolicyCatalog{const catalog=validateBusinessWorkPolicyCatalog(JSON.parse(
    readFileSync(join(import.meta.dir,'..','config','business-work-policies.json'),'utf8')) as unknown),roles=loadDefaultBusinessRoleCatalog();
    for(const policy of catalog.policies){const role=resolveBusinessRole(roles,policy.roleDefinitionId);if(role.legacyProjection!=='worker')
        throw new Error(`Business work policy ${policy.policyId} must target a worker role`);if(!roles.verifiedSkillKeys.includes(
            `${policy.requiredSkill.id}@${policy.requiredSkill.version}`))throw new Error(`Business work policy ${policy.policyId} skill is not verified`)}return catalog}

export class BusinessWorkStore{private readonly database:Database;constructor(path:string,private readonly catalog:BusinessWorkPolicyCatalog=
    loadDefaultBusinessWorkPolicyCatalog(),private readonly roles:BusinessRoleCatalog=loadDefaultBusinessRoleCatalog()){
    this.database=new Database(path,{create:true,strict:true});this.database.run('PRAGMA foreign_keys = ON');
    this.database.run(`CREATE TABLE IF NOT EXISTS business_facility_entitlement(entitlement_id TEXT PRIMARY KEY,business_id TEXT NOT NULL,
        property_id TEXT NOT NULL,facility_capability TEXT NOT NULL,valid_from TEXT NOT NULL,valid_until TEXT,created_at TEXT NOT NULL,
        UNIQUE(business_id,property_id,facility_capability,valid_from))`);
    this.database.run(`CREATE TABLE IF NOT EXISTS business_work_order(work_order_id TEXT PRIMARY KEY,policy_id TEXT NOT NULL,business_id TEXT NOT NULL,
        employment_id TEXT NOT NULL,worker_agent_id TEXT NOT NULL,role_definition_id TEXT NOT NULL,skill_id TEXT NOT NULL,skill_version TEXT NOT NULL,
        property_id TEXT NOT NULL,facility_capability TEXT NOT NULL,wage_gp INTEGER NOT NULL,scheduled_start TEXT NOT NULL,scheduled_end TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN('scheduled','running','completed','cancelled')),actual_minutes INTEGER,evidence_id TEXT UNIQUE,
        wage_status TEXT NOT NULL CHECK(wage_status IN('unearned','earned','paid')),wage_settlement_id TEXT UNIQUE,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`)}close():void{this.database.close(true)}
    grantEntitlement(input:Omit<FacilityEntitlement,'createdAt'>,now=new Date().toISOString()):FacilityEntitlement{
        const entitlement={entitlementId:id(input.entitlementId,'entitlementId'),businessId:id(input.businessId,'businessId'),
            propertyId:id(input.propertyId,'propertyId'),facilityCapability:id(input.facilityCapability,'facilityCapability'),
            validFrom:time(input.validFrom,'validFrom'),validUntil:input.validUntil?time(input.validUntil,'validUntil'):null,createdAt:time(now,'now')};
        if(entitlement.validUntil&&entitlement.validUntil<=entitlement.validFrom)throw new Error('Facility entitlement window is invalid');
        const business=this.database.query('SELECT property_id FROM business WHERE business_id=?1').get(entitlement.businessId) as {property_id:string|null}|null;
        if(!business||business.property_id!==entitlement.propertyId)throw new Error('Facility entitlement requires the exact Business Property');
        this.database.run(`INSERT INTO business_facility_entitlement VALUES(?1,?2,?3,?4,?5,?6,?7)`,[entitlement.entitlementId,
            entitlement.businessId,entitlement.propertyId,entitlement.facilityCapability,entitlement.validFrom,entitlement.validUntil,entitlement.createdAt]);return entitlement}
    createWorkOrder(workOrderIdInput:string,policyId:string,employmentId:string,scheduledStartInput:string,scheduledEndInput:string,
        now=new Date().toISOString()):BusinessWorkOrder{const workOrderId=id(workOrderIdInput,'workOrderId'),policy=this.policy(policyId),
            scheduledStart=time(scheduledStartInput,'scheduledStart'),scheduledEnd=time(scheduledEndInput,'scheduledEnd');
        const minutes=(Date.parse(scheduledEnd)-Date.parse(scheduledStart))/60000;if(!Number.isInteger(minutes)||minutes<policy.minimumMinutes||minutes>policy.maximumMinutes)
            throw new Error('Work order shift duration is outside policy');const employment=this.database.query(`SELECT * FROM business_employment
            WHERE employment_id=?1 AND business_id=?2 AND status='active'`).get(employmentId,policy.businessId) as Record<string,unknown>|null;
        if(!employment||employment.role_definition_id!==policy.roleDefinitionId)throw new Error('Work order requires an active exact-role employment');
        resolveBusinessRole(this.roles,String(employment.role_definition_id));if(employment.required_skill_id&&
            (employment.required_skill_id!==policy.requiredSkill.id||employment.required_skill_version!==policy.requiredSkill.version))
            throw new Error('Work order skill does not match employment');this.requireEntitlement(policy,scheduledStart,scheduledEnd);
        this.database.run(`INSERT INTO business_work_order VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,
            'scheduled',NULL,NULL,'unearned',NULL,?14,?14)`,
            [workOrderId,policy.policyId,policy.businessId,employmentId,employment.worker_agent_id,employment.role_definition_id,
                policy.requiredSkill.id,policy.requiredSkill.version,policy.propertyId,policy.facilityCapability,employment.wage_gp,
                scheduledStart,scheduledEnd,now]);return this.get(workOrderId)!}
    start(workOrderId:string,now=new Date().toISOString()):BusinessWorkOrder{const order=this.required(workOrderId);if(order.status==='running')return order;
        if(order.status!=='scheduled'||now<order.scheduledStart||now>order.scheduledEnd)throw new Error('Work order is outside its scheduled shift');
        this.database.run(`UPDATE business_work_order SET status='running',updated_at=?2 WHERE work_order_id=?1 AND status='scheduled'`,[workOrderId,now]);
        return this.get(workOrderId)!}
    complete(workOrderId:string,evidence:WorkCompletionEvidence,verify?:WorkEvidenceVerifier):BusinessWorkOrder{const order=this.required(workOrderId);
        if(order.status==='completed'){if(order.evidenceId!==evidence.evidenceId)throw new Error('Completed work order evidence differs');return order}
        if(!verify||!verify(evidence))throw new Error('Work completion evidence is not trusted');if(order.status!=='running'||evidence.workOrderId!==order.workOrderId
            ||evidence.businessId!==order.businessId||evidence.workerAgentId!==order.workerAgentId||evidence.skill.id!==order.skill.id
            ||evidence.skill.version!==order.skill.version||evidence.status!=='completed')throw new Error('Work completion evidence does not match work order');
        const minutes=(Date.parse(evidence.completedAt)-Date.parse(evidence.startedAt))/60000,policy=this.policy(order.policyId);
        if(!Number.isInteger(minutes)||minutes<policy.minimumMinutes||minutes>policy.maximumMinutes||evidence.startedAt<order.scheduledStart
            ||evidence.completedAt>order.scheduledEnd)throw new Error('Verified work time is outside the scheduled shift');
        this.database.run(`UPDATE business_work_order SET status='completed',actual_minutes=?2,evidence_id=?3,wage_status='earned',updated_at=?4
            WHERE work_order_id=?1 AND status='running'`,[order.workOrderId,minutes,evidence.evidenceId,evidence.completedAt]);return this.get(workOrderId)!}
    settleWage(workOrderId:string,settlementIdInput:string,verify?:(order:BusinessWorkOrder,settlementId:string)=>boolean,
        now=new Date().toISOString()):BusinessWorkOrder{const order=this.required(workOrderId),settlementId=id(settlementIdInput,'settlementId');
        if(order.wageStatus==='paid'){if(order.wageSettlementId!==settlementId)throw new Error('Work order wage settlement differs');return order}
        if(order.status!=='completed'||order.wageStatus!=='earned'||!verify||!verify(order,settlementId))
            throw new Error('Work order wage requires a trusted exact settlement');this.database.run(`UPDATE business_work_order
            SET wage_status='paid',wage_settlement_id=?2,updated_at=?3 WHERE work_order_id=?1 AND wage_status='earned'`,
        [order.workOrderId,settlementId,now]);return this.get(workOrderId)!}
    get(workOrderIdInput:string):BusinessWorkOrder|null{const row=this.database.query('SELECT * FROM business_work_order WHERE work_order_id=?1')
        .get(id(workOrderIdInput,'workOrderId')) as Record<string,unknown>|null;return row?workOrder(row):null}
    private required(workOrderId:string):BusinessWorkOrder{const order=this.get(workOrderId);if(!order)throw new Error('Business work order does not exist');return order}
    private policy(policyId:string):BusinessWorkPolicy{if(this.catalog.digest!==digest({schemaVersion:this.catalog.schemaVersion,policies:this.catalog.policies}))
        throw new Error('Business work policy catalog digest mismatch');const policy=this.catalog.policies.find(value=>value.policyId===policyId);
        if(!policy)throw new Error('Business work policy does not exist');return policy}
    private requireEntitlement(policy:BusinessWorkPolicy,start:string,end:string):void{const row=this.database.query(`SELECT 1 ok FROM business_facility_entitlement
        WHERE business_id=?1 AND property_id=?2 AND facility_capability=?3 AND valid_from<=?4 AND(valid_until IS NULL OR valid_until>=?5)`)
        .get(policy.businessId,policy.propertyId,policy.facilityCapability,start,end);if(!row)throw new Error('Work order lacks Property facility entitlement')}
}
