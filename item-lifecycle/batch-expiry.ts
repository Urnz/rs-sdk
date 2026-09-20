import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { itemStatePolicyDigest } from './classification.js';
import type { BatchExpiryItemDefinition,BatchExpiryPolicyCatalog,BatchExpiryPolicyDefinition,
    BatchStorageProfileDefinition,ItemStatePolicyCatalog,PreparedBatchExpiryContract } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{0,127}$/i;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]));}
function exact(value:Record<string,unknown>,keys:string[],field:string):void{
    if(Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw new Error(`${field} is invalid`);}
export function batchExpiryPolicyDigest(value:Omit<BatchExpiryPolicyCatalog,'digest'>):string{
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
export function validateBatchExpiryPolicyCatalog(value:unknown,stateCatalog:ItemStatePolicyCatalog):BatchExpiryPolicyCatalog{
    const{digest:stateDigest,...stateDefinition}=stateCatalog;
    if(stateDigest!==itemStatePolicyDigest(stateDefinition))throw new Error('Item state policy digest mismatch');
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Batch expiry policy catalog is invalid');
    const input=value as Record<string,unknown>;exact(input,['schemaVersion','activation','policies'],'Batch expiry policy catalog');
    if(input.schemaVersion!==1||input.activation!=='prepared'||!Array.isArray(input.policies)
        ||input.policies.length<1||input.policies.length>1_000)throw new Error('Batch expiry policy catalog is invalid');
    const policies:BatchExpiryPolicyDefinition[]=input.policies.map((value,index)=>{const field=`policies[${index}]`;
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${field} is invalid`);
        const policy=value as Record<string,unknown>;exact(policy,
            ['policyId','expiryClock','defaultStorageProfileId','items','storageProfiles'],field);
        if(typeof policy.policyId!=='string'||!ID.test(policy.policyId)||policy.expiryClock!=='simulation-time'
            ||typeof policy.defaultStorageProfileId!=='string'||!ID.test(policy.defaultStorageProfileId)
            ||!Array.isArray(policy.items)||policy.items.length<1||policy.items.length>10_000
            ||!Array.isArray(policy.storageProfiles)||policy.storageProfiles.length<1||policy.storageProfiles.length>100)
            throw new Error(`${field} is invalid`);
        const items:BatchExpiryItemDefinition[]=policy.items.map((value,itemIndex)=>{const itemField=`${field}.items[${itemIndex}]`;
            if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${itemField} is invalid`);
            const item=value as Record<string,unknown>;exact(item,['itemId','shelfLifeSimulationMinutes'],itemField);
            if(!Number.isSafeInteger(item.itemId)||Number(item.itemId)<0||Number(item.itemId)>65_535
                ||!Number.isSafeInteger(item.shelfLifeSimulationMinutes)||Number(item.shelfLifeSimulationMinutes)<1
                ||Number(item.shelfLifeSimulationMinutes)>5_256_000)throw new Error(`${itemField} is invalid`);
            return{itemId:Number(item.itemId),shelfLifeSimulationMinutes:Number(item.shelfLifeSimulationMinutes)};});
        const storageProfiles:BatchStorageProfileDefinition[]=policy.storageProfiles.map((value,profileIndex)=>{
            const profileField=`${field}.storageProfiles[${profileIndex}]`;
            if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${profileField} is invalid`);
            const profile=value as Record<string,unknown>;exact(profile,
                ['storageProfileId','label','shelfLifeMultiplierBasisPoints','requiredCapabilityId'],profileField);
            if(typeof profile.storageProfileId!=='string'||!ID.test(profile.storageProfileId)||typeof profile.label!=='string'
                ||!profile.label.trim()||profile.label.length>80||!Number.isSafeInteger(profile.shelfLifeMultiplierBasisPoints)
                ||Number(profile.shelfLifeMultiplierBasisPoints)<1_000||Number(profile.shelfLifeMultiplierBasisPoints)>100_000
                ||(profile.requiredCapabilityId!==null&&(typeof profile.requiredCapabilityId!=='string'
                    ||!ID.test(profile.requiredCapabilityId))))throw new Error(`${profileField} is invalid`);
            return{storageProfileId:profile.storageProfileId,label:profile.label.trim(),
                shelfLifeMultiplierBasisPoints:Number(profile.shelfLifeMultiplierBasisPoints),
                requiredCapabilityId:profile.requiredCapabilityId as string|null};});
        if(new Set(items.map(item=>item.itemId)).size!==items.length)throw new Error(`${field} item ids must be unique`);
        if(new Set(storageProfiles.map(profile=>profile.storageProfileId)).size!==storageProfiles.length)
            throw new Error(`${field} storage profile ids must be unique`);
        if(!storageProfiles.some(profile=>profile.storageProfileId===policy.defaultStorageProfileId))
            throw new Error(`${field} default storage profile is missing`);
        return{policyId:policy.policyId,expiryClock:'simulation-time',defaultStorageProfileId:policy.defaultStorageProfileId,
            items,storageProfiles};});
    if(new Set(policies.map(policy=>policy.policyId)).size!==policies.length)
        throw new Error('Batch expiry policies must have unique ids');
    const batchRules=stateCatalog.rules.filter(rule=>rule.mode==='batch');
    for(const rule of batchRules){const policy=policies.find(candidate=>candidate.policyId===rule.batchPolicyId);
        if(!policy||!policy.items.some(item=>item.itemId===rule.itemId))throw new Error(`Batch item ${rule.itemId} has no expiry policy`);}
    for(const policy of policies)for(const item of policy.items){const rule=batchRules.find(candidate=>candidate.itemId===item.itemId);
        if(!rule||rule.batchPolicyId!==policy.policyId)throw new Error(`Expiry item ${item.itemId} has no matching batch binding`);}
    const definition={schemaVersion:1 as const,activation:'prepared' as const,policies};
    return{...definition,digest:batchExpiryPolicyDigest(definition)};
}
export function loadBatchExpiryPolicyCatalog(path:string,stateCatalog:ItemStatePolicyCatalog):BatchExpiryPolicyCatalog{
    return validateBatchExpiryPolicyCatalog(JSON.parse(readFileSync(path,'utf8')) as unknown,stateCatalog);}
export function resolvePreparedBatchExpiryContract(catalog:BatchExpiryPolicyCatalog,stateCatalog:ItemStatePolicyCatalog,
    itemId:number):PreparedBatchExpiryContract{const{digest,...definition}=catalog;
    if(digest!==batchExpiryPolicyDigest(definition))throw new Error('Batch expiry policy digest mismatch');
    const{digest:stateDigest,...stateDefinition}=stateCatalog;
    if(stateDigest!==itemStatePolicyDigest(stateDefinition))throw new Error('Item state policy digest mismatch');
    const rule=stateCatalog.rules.find(candidate=>candidate.itemId===itemId);
    if(!rule||rule.mode!=='batch'||!rule.batchPolicyId)throw new Error(`Item ${itemId} has no batch expiry contract`);
    const policy=catalog.policies.find(candidate=>candidate.policyId===rule.batchPolicyId),
        item=policy?.items.find(candidate=>candidate.itemId===itemId);
    if(!policy||!item)throw new Error(`Item ${itemId} has no batch expiry contract`);
    return{activation:'prepared',policy,item};}
