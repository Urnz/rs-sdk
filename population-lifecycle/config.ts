import { readFileSync } from 'node:fs';
import type { WorldGenesisProfile } from '../world-genesis/types.js';
import { validatePopulationLifecyclePolicy } from './policy.js';
import { POPULATION_LIFECYCLE_SCHEMA_VERSION, type PopulationLifecyclePolicy,
    type PopulationLifecyclePolicyCatalog, type PopulationWorldProfileBinding,
    type PopulationWorldProfileBindingCatalog } from './types.js';

const PROFILE_IDS=new Set(['blank-slate','frontier','seeded-economy','mature-society','historical-burn-in']);
const ID=/^[a-z0-9][a-z0-9.-]{0,63}$/;const VERSION=/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;const DIGEST=/^[0-9a-f]{64}$/;
function record(value:unknown):value is Record<string,unknown>{return!!value&&typeof value==='object'&&!Array.isArray(value)}

export function validatePopulationLifecyclePolicyCatalog(value:unknown):PopulationLifecyclePolicyCatalog{
    if(!record(value)||value.schemaVersion!==POPULATION_LIFECYCLE_SCHEMA_VERSION||!Array.isArray(value.policies)
        ||Object.keys(value).sort().join(',')!=='policies,schemaVersion')throw new Error('Population lifecycle policy catalog is invalid');
    const policies=value.policies.map(validatePopulationLifecyclePolicy);
    if(policies.length<2||new Set(policies.map(item=>`${item.policyId}@${item.version}`)).size!==policies.length
        ||policies.filter(item=>item.kind==='finite').length!==1
        ||policies.filter(item=>item.kind==='classic-respawn-compatibility').length!==1)
        throw new Error('Population lifecycle catalog must define unique finite and compatibility policies');
    return{schemaVersion:POPULATION_LIFECYCLE_SCHEMA_VERSION,policies};
}

export function loadPopulationLifecyclePolicyCatalog(path:string):PopulationLifecyclePolicyCatalog{
    return validatePopulationLifecyclePolicyCatalog(JSON.parse(readFileSync(path,'utf8')));
}

export function validatePopulationWorldProfileBindingCatalog(value:unknown):PopulationWorldProfileBindingCatalog{
    if(!record(value)||value.schemaVersion!==POPULATION_LIFECYCLE_SCHEMA_VERSION||!Array.isArray(value.bindings)
        ||Object.keys(value).sort().join(',')!=='bindings,schemaVersion')throw new Error('Population world-profile binding catalog is invalid');
    const bindings=value.bindings.map((raw,index):PopulationWorldProfileBinding=>{
        if(!record(raw)||Object.keys(raw).sort().join(',')!==
            'policyDigest,policyId,policyVersion,worldProfileDigest,worldProfileId,worldProfileVersion'
            ||!PROFILE_IDS.has(String(raw.worldProfileId))||typeof raw.worldProfileVersion!=='string'||!VERSION.test(raw.worldProfileVersion)
            ||typeof raw.worldProfileDigest!=='string'||!DIGEST.test(raw.worldProfileDigest)
            ||typeof raw.policyId!=='string'||!ID.test(raw.policyId)||typeof raw.policyVersion!=='string'||!VERSION.test(raw.policyVersion)
            ||typeof raw.policyDigest!=='string'||!DIGEST.test(raw.policyDigest))throw new Error(`Population binding ${index} is invalid`);
        return raw as unknown as PopulationWorldProfileBinding;
    });
    if(new Set(bindings.map(item=>item.worldProfileId)).size!==bindings.length)
        throw new Error('A world profile may have only one population lifecycle binding');
    return{schemaVersion:POPULATION_LIFECYCLE_SCHEMA_VERSION,bindings};
}

export function loadPopulationWorldProfileBindingCatalog(path:string):PopulationWorldProfileBindingCatalog{
    return validatePopulationWorldProfileBindingCatalog(JSON.parse(readFileSync(path,'utf8')));
}

export function resolvePopulationLifecyclePolicy(profile:WorldGenesisProfile,policies:PopulationLifecyclePolicyCatalog,
    bindings:PopulationWorldProfileBindingCatalog):PopulationLifecyclePolicy|null{
    const binding=bindings.bindings.find(item=>item.worldProfileId===profile.profileId);if(!binding)return null;
    if(binding.worldProfileVersion!==profile.version||binding.worldProfileDigest!==profile.digest)
        throw new Error('World profile population lifecycle binding is stale');
    const policy=policies.policies.find(item=>item.policyId===binding.policyId&&item.version===binding.policyVersion);
    if(!policy||policy.digest!==binding.policyDigest)throw new Error('Population lifecycle policy binding is stale');
    if(policy.kind!=='finite')throw new Error('Compatibility respawn policy cannot create PopulationMember records');
    return policy;
}
