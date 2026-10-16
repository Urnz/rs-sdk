import { createHash } from 'node:crypto';
import { POPULATION_LIFECYCLE_SCHEMA_VERSION, type PopulationLifecyclePolicy,
    type PopulationLifecyclePolicyDefinition } from './types.js';

const ID=/^[a-z0-9][a-z0-9.-]{0,63}$/;
const VERSION=/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;

function record(value:unknown,field:string):Record<string,unknown>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${field} must be an object`);
    return value as Record<string,unknown>;
}
function exact(value:Record<string,unknown>,keys:string[],field:string){
    if(Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw new Error(`${field} fields are invalid`);
}
function canonical(value:unknown):unknown{
    if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]));
}

export function populationLifecyclePolicyDigest(value:PopulationLifecyclePolicyDefinition):string{
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function validatePopulationLifecyclePolicy(value:unknown):PopulationLifecyclePolicy{
    const input=record(value,'Population lifecycle policy');
    exact(input,['schemaVersion','policyId','version','kind','scope','deathTransition','respawn'],
        'Population lifecycle policy');
    if(input.schemaVersion!==POPULATION_LIFECYCLE_SCHEMA_VERSION||typeof input.policyId!=='string'||!ID.test(input.policyId)
        ||typeof input.version!=='string'||!VERSION.test(input.version))throw new Error('Population lifecycle policy identity is invalid');
    const finite=input.kind==='finite'&&input.scope==='social-simulation'&&input.deathTransition==='terminal'
        &&input.respawn==='forbidden';
    const compatibility=input.kind==='classic-respawn-compatibility'&&input.scope==='compatibility-experiment'
        &&input.deathTransition==='avatar-respawn'&&input.respawn==='engine-classic';
    if(!finite&&!compatibility)throw new Error('Population lifecycle policy semantics are invalid');
    const definition:PopulationLifecyclePolicyDefinition={schemaVersion:POPULATION_LIFECYCLE_SCHEMA_VERSION,
        policyId:input.policyId,version:input.version,kind:input.kind,scope:input.scope,
        deathTransition:input.deathTransition,respawn:input.respawn} as PopulationLifecyclePolicyDefinition;
    return{...definition,digest:populationLifecyclePolicyDigest(definition)};
}
