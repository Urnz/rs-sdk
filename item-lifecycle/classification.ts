import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { itemLifecycleCatalogDigest } from './catalog.js';
import type { ItemLifecycleCatalog, ItemStateMode, ItemStatePolicyCatalog, ItemStateRule } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{0,127}$/i;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]));}
export function itemStatePolicyDigest(value:Omit<ItemStatePolicyCatalog,'digest'>):string{
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
export function validateItemStatePolicyCatalog(value:unknown,lifecycle:ItemLifecycleCatalog):ItemStatePolicyCatalog{
    const{digest:lifecycleDigest,...lifecycleDefinition}=lifecycle;
    if(lifecycleDigest!==itemLifecycleCatalogDigest(lifecycleDefinition))throw new Error('Item lifecycle catalog digest mismatch');
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Item state policy catalog is invalid');
    const input=value as Record<string,unknown>;
    if(Object.keys(input).sort().join(',')!=='rules,schemaVersion'||input.schemaVersion!==1||!Array.isArray(input.rules)
        ||input.rules.length<1||input.rules.length>10_000)throw new Error('Item state policy catalog is invalid');
    const lifecycleIds=new Set(lifecycle.items.map(item=>item.lifecycleTypeId));
    const rules:ItemStateRule[]=input.rules.map((value,index)=>{const field=`rules[${index}]`;
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${field} is invalid`);
        const rule=value as Record<string,unknown>;
        if(Object.keys(rule).sort().join(',')!=='batchPolicyId,itemId,itemName,lifecycleTypeId,mode,rationale'
            ||!Number.isSafeInteger(rule.itemId)||Number(rule.itemId)<0||Number(rule.itemId)>65_535
            ||typeof rule.itemName!=='string'||!rule.itemName.trim()||rule.itemName.length>80
            ||!['instance','stack','batch'].includes(String(rule.mode))||typeof rule.rationale!=='string'
            ||!rule.rationale.trim()||rule.rationale.length>240)throw new Error(`${field} is invalid`);
        const mode=rule.mode as ItemStateMode,lifecycleTypeId=rule.lifecycleTypeId,batchPolicyId=rule.batchPolicyId;
        if(mode==='instance'&&(typeof lifecycleTypeId!=='string'||!ID.test(lifecycleTypeId)
            ||!lifecycleIds.has(lifecycleTypeId)||batchPolicyId!==null))throw new Error(`${field} instance binding is invalid`);
        if(mode==='stack'&&(lifecycleTypeId!==null||batchPolicyId!==null))throw new Error(`${field} stack binding is invalid`);
        if(mode==='batch'&&(lifecycleTypeId!==null||typeof batchPolicyId!=='string'||!ID.test(batchPolicyId)))
            throw new Error(`${field} batch binding is invalid`);
        return{itemId:Number(rule.itemId),itemName:rule.itemName.trim(),mode,
            lifecycleTypeId:lifecycleTypeId as string|null,batchPolicyId:batchPolicyId as string|null,
            rationale:rule.rationale.trim()};});
    if(new Set(rules.map(rule=>rule.itemId)).size!==rules.length)throw new Error('Item state rules must have unique item ids');
    const definition={schemaVersion:1 as const,rules};return{...definition,digest:itemStatePolicyDigest(definition)};
}
export function loadItemStatePolicyCatalog(path:string,lifecycle:ItemLifecycleCatalog):ItemStatePolicyCatalog{
    return validateItemStatePolicyCatalog(JSON.parse(readFileSync(path,'utf8')) as unknown,lifecycle);}
export function resolveItemStateRule(catalog:ItemStatePolicyCatalog,itemId:number):ItemStateRule{
    const{digest,...definition}=catalog;if(digest!==itemStatePolicyDigest(definition))throw new Error('Item state policy digest mismatch');
    const rule=catalog.rules.find(item=>item.itemId===itemId);if(!rule)throw new Error(`Item ${itemId} has no state policy`);return rule;}
