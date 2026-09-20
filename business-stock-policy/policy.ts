import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { loadDefaultBusinessRoleCatalog } from '../business-roles/index.js';

export interface SkillRef{id:string;version:string}
export interface BusinessStockPolicy{policyId:string;businessId:string;itemId:number;minimumStock:number;
    targetStock:number;maximumStock:number;procurement:{maxUnitPriceGp:number;verifiedSkills:SkillRef[]};
    pricing:{mode:'fixed';saleUnitPriceGp:number};sales:{minimumReserve:number;maxUnitsPerSettlement:number;
        verifiedSkills:SkillRef[]}}
export interface BusinessStockPolicyCatalog{schemaVersion:1;policies:BusinessStockPolicy[];digest:string}
export interface BusinessStockDecision{policyId:string;businessId:string;itemId:number;observedStock:number;
    procurement:{quantity:number;maxUnitPriceGp:number}|null;sale:{unitPriceGp:number;availableUnits:number;
        maxUnitsPerSettlement:number};policyDigest:string;decisionDigest:string}
export type StockDirection='procurement'|'sale';
export interface StockMovementEvidence{kind:'verified-skill'|'trusted-settlement';evidenceId:string;status:'completed'|'committed';
    businessId:string;itemId:number;quantity:number;unitPriceGp:number;direction:StockDirection;skill?:SkillRef;occurredAt:string}
export interface AuthorizedStockMovement{policyId:string;businessId:string;itemId:number;quantity:number;
    direction:StockDirection;evidence:StockMovementEvidence;decisionDigest:string;authorizationDigest:string}
export interface BusinessStockSettlement{settlementId:string;businessId:string;itemId:number;quantity:number;
    direction:StockDirection;evidenceId:string;createdAt:string}
export type StockMovementEvidenceVerifier=(evidence:StockMovementEvidence)=>boolean;

const ID=/^[a-z0-9][a-z0-9._-]{1,119}$/;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]))}
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}
function integer(value:unknown,field:string,minimum=0):number{if(!Number.isSafeInteger(value)||Number(value)<minimum||Number(value)>2_147_483_647)
    throw new Error(`${field} is invalid`);return Number(value)}
function exact(value:Record<string,unknown>,keys:string[],field:string):void{if(Object.keys(value).sort().join(',')!==keys.sort().join(','))
    throw new Error(`${field} is invalid`)}
function ref(value:unknown,field:string):SkillRef{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${field} is invalid`);
    const input=value as Record<string,unknown>;exact(input,['id','version'],field);if(typeof input.id!=='string'||!ID.test(input.id)
        ||typeof input.version!=='string'||!/^\d+\.\d+\.\d+$/.test(input.version))throw new Error(`${field} is invalid`);
    return {id:input.id,version:input.version}}

export function validateBusinessStockPolicyCatalog(value:unknown):BusinessStockPolicyCatalog{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Business stock policy catalog is invalid');
    const input=value as Record<string,unknown>;exact(input,['schemaVersion','policies'],'Business stock policy catalog');
    if(input.schemaVersion!==1||!Array.isArray(input.policies)||input.policies.length<1)throw new Error('Business stock policy catalog is invalid');
    const policies=input.policies.map((entry,index):BusinessStockPolicy=>{const field=`policies[${index}]`;
        if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error(`${field} is invalid`);const item=entry as Record<string,unknown>;
        exact(item,['policyId','businessId','itemId','minimumStock','targetStock','maximumStock','procurement','pricing','sales'],field);
        if(typeof item.policyId!=='string'||!ID.test(item.policyId)||typeof item.businessId!=='string'||!ID.test(item.businessId))
            throw new Error(`${field} is invalid`);const minimumStock=integer(item.minimumStock,`${field}.minimumStock`),
            targetStock=integer(item.targetStock,`${field}.targetStock`),maximumStock=integer(item.maximumStock,`${field}.maximumStock`);
        if(minimumStock>targetStock||targetStock>maximumStock)throw new Error(`${field} stock bounds are invalid`);
        const procurement=item.procurement as Record<string,unknown>,pricing=item.pricing as Record<string,unknown>,
            sales=item.sales as Record<string,unknown>;if(!procurement||!pricing||!sales)throw new Error(`${field} is invalid`);
        exact(procurement,['maxUnitPriceGp','verifiedSkills'],`${field}.procurement`);
        exact(pricing,['mode','saleUnitPriceGp'],`${field}.pricing`);
        exact(sales,['minimumReserve','maxUnitsPerSettlement','verifiedSkills'],`${field}.sales`);
        if(!Array.isArray(procurement.verifiedSkills)||!Array.isArray(sales.verifiedSkills)||pricing.mode!=='fixed')
            throw new Error(`${field} is invalid`);const policy={policyId:item.policyId,businessId:item.businessId,
            itemId:integer(item.itemId,`${field}.itemId`),minimumStock,targetStock,maximumStock,
            procurement:{maxUnitPriceGp:integer(procurement.maxUnitPriceGp,`${field}.procurement.maxUnitPriceGp`,1),
                verifiedSkills:procurement.verifiedSkills.map((value,i)=>ref(value,`${field}.procurement.verifiedSkills[${i}]`))},
            pricing:{mode:'fixed' as const,saleUnitPriceGp:integer(pricing.saleUnitPriceGp,`${field}.pricing.saleUnitPriceGp`,1)},
            sales:{minimumReserve:integer(sales.minimumReserve,`${field}.sales.minimumReserve`),
                maxUnitsPerSettlement:integer(sales.maxUnitsPerSettlement,`${field}.sales.maxUnitsPerSettlement`,1),
                verifiedSkills:sales.verifiedSkills.map((value,i)=>ref(value,`${field}.sales.verifiedSkills[${i}]`))}};
        if(policy.sales.minimumReserve<policy.minimumStock||!policy.procurement.verifiedSkills.length||!policy.sales.verifiedSkills.length)
            throw new Error(`${field} is invalid`);return policy});
    if(new Set(policies.map(policy=>policy.policyId)).size!==policies.length||new Set(policies.map(policy=>`${policy.businessId}:${policy.itemId}`)).size!==policies.length)
        throw new Error('Business stock policies must be unique');const definition={schemaVersion:1 as const,policies};
    return {...definition,digest:hash(definition)}}

export function loadDefaultBusinessStockPolicyCatalog():BusinessStockPolicyCatalog{const catalog=validateBusinessStockPolicyCatalog(
    JSON.parse(readFileSync(join(import.meta.dir,'..','config','business-stock-policies.json'),'utf8')) as unknown);
    const verified=new Set(loadDefaultBusinessRoleCatalog().verifiedSkillKeys);for(const policy of catalog.policies)
        for(const skill of [...policy.procurement.verifiedSkills,...policy.sales.verifiedSkills])if(!verified.has(`${skill.id}@${skill.version}`))
            throw new Error(`Business stock policy ${policy.policyId} references an unverified skill`);return catalog}
export function decideBusinessStock(policy:BusinessStockPolicy,catalog:BusinessStockPolicyCatalog,observedStock:number):BusinessStockDecision{
    integer(observedStock,'observedStock');if(!catalog.policies.some(value=>value.policyId===policy.policyId)||catalog.digest!==hash({schemaVersion:catalog.schemaVersion,policies:catalog.policies}))
        throw new Error('Business stock policy evidence mismatch');const base={policyId:policy.policyId,businessId:policy.businessId,
        itemId:policy.itemId,observedStock,procurement:observedStock<=policy.minimumStock?{quantity:policy.targetStock-observedStock,
            maxUnitPriceGp:policy.procurement.maxUnitPriceGp}:null,sale:{unitPriceGp:policy.pricing.saleUnitPriceGp,
            availableUnits:Math.max(0,observedStock-policy.sales.minimumReserve),maxUnitsPerSettlement:policy.sales.maxUnitsPerSettlement},
        policyDigest:catalog.digest};return {...base,decisionDigest:hash(base)}}
export function authorizeStockMovement(policy:BusinessStockPolicy,decision:BusinessStockDecision,
    evidence:StockMovementEvidence,verifyEvidence?:StockMovementEvidenceVerifier):AuthorizedStockMovement{
    if(!verifyEvidence||verifyEvidence(evidence)!==true)throw new Error('Stock movement evidence is not trusted');
    if(decision.decisionDigest!==hash({...decision,decisionDigest:undefined})
        ||decision.policyId!==policy.policyId||evidence.businessId!==policy.businessId||evidence.itemId!==policy.itemId
        ||evidence.quantity<1||!Number.isSafeInteger(evidence.unitPriceGp)||evidence.unitPriceGp<1
        ||evidence.status!==(evidence.kind==='verified-skill'?'completed':'committed'))
        throw new Error('Stock movement evidence does not match the policy decision');const allowed=evidence.direction==='procurement'
        ?policy.procurement.verifiedSkills:policy.sales.verifiedSkills;if(evidence.kind==='verified-skill'&&(!evidence.skill
        ||!allowed.some(skill=>skill.id===evidence.skill!.id&&skill.version===evidence.skill!.version)))throw new Error('Stock movement skill is not allowed');
    if(evidence.direction==='procurement'&&(!decision.procurement||evidence.quantity>decision.procurement.quantity)
        ||evidence.direction==='procurement'&&evidence.unitPriceGp>decision.procurement!.maxUnitPriceGp
        ||evidence.direction==='sale'&&(evidence.quantity>decision.sale.availableUnits||evidence.quantity>decision.sale.maxUnitsPerSettlement
            ||evidence.unitPriceGp!==decision.sale.unitPriceGp))
        throw new Error('Stock movement exceeds the policy decision');const base={policyId:policy.policyId,businessId:policy.businessId,
            itemId:policy.itemId,quantity:evidence.quantity,direction:evidence.direction,evidence,decisionDigest:decision.decisionDigest};
    return {...base,authorizationDigest:hash(base)}}

export class BusinessStockSettlementStore{private readonly database:Database;constructor(path:string){this.database=new Database(path,{create:true,strict:true});
    this.database.run(`CREATE TABLE IF NOT EXISTS business_stock_settlement(settlement_id TEXT PRIMARY KEY,business_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,quantity INTEGER NOT NULL,direction TEXT NOT NULL,evidence_id TEXT NOT NULL UNIQUE,
        authorization_digest TEXT NOT NULL,created_at TEXT NOT NULL)`)}close():void{this.database.close(true)}
    apply(settlementId:string,authorization:AuthorizedStockMovement,now=new Date().toISOString()):BusinessStockSettlement{
        if(!ID.test(settlementId)||authorization.authorizationDigest!==hash({...authorization,authorizationDigest:undefined}))
            throw new Error('Stock movement authorization is invalid');const existing=this.database.query('SELECT * FROM business_stock_settlement WHERE settlement_id=?1')
            .get(settlementId) as Record<string,unknown>|null;if(existing){if(existing.authorization_digest!==authorization.authorizationDigest)
            throw new Error('Stock settlement id was reused');return {settlementId,businessId:String(existing.business_id),itemId:Number(existing.item_id),
                quantity:Number(existing.quantity),direction:existing.direction as StockDirection,evidenceId:String(existing.evidence_id),createdAt:String(existing.created_at)}}
        const transaction=this.database.transaction(()=>{if(authorization.direction==='procurement')this.database.run(`INSERT INTO business_inventory
            VALUES(?1,?2,?3,1,?4) ON CONFLICT(business_id,item_id) DO UPDATE SET count=count+excluded.count,revision=revision+1,
            updated_at=excluded.updated_at`,[authorization.businessId,authorization.itemId,authorization.quantity,now]);else{const result=this.database.run(
            `UPDATE business_inventory SET count=count-?3,revision=revision+1,updated_at=?4 WHERE business_id=?1 AND item_id=?2 AND count>=?3`,
            [authorization.businessId,authorization.itemId,authorization.quantity,now]);if(result.changes!==1)throw new Error('Business sale stock is insufficient')}
            this.database.run(`INSERT INTO business_stock_settlement VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`,[settlementId,
                authorization.businessId,authorization.itemId,authorization.quantity,authorization.direction,
                authorization.evidence.evidenceId,authorization.authorizationDigest,now])});transaction.immediate();
        return {settlementId,businessId:authorization.businessId,itemId:authorization.itemId,quantity:authorization.quantity,
            direction:authorization.direction,evidenceId:authorization.evidence.evidenceId,createdAt:now}}
}
