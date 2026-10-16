import type { WorldGenesisProfileCatalog, WorldGenesisResult } from '../world-genesis/types.js';
import { resolvePopulationLifecyclePolicy } from './config.js';
import type { PopulationGenesisMember, PopulationLifecyclePolicyCatalog,
    PopulationWorldProfileBindingCatalog } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{0,127}$/i;const USER=/^[a-z0-9]{1,12}$/i;

export function populationMembersFromGenesis(result:WorldGenesisResult,required:boolean):PopulationGenesisMember[]{
    const output=result.output;
    if(!output||typeof output!=='object'||Array.isArray(output))throw new Error('Genesis result output must be an object');
    const raw=(output as Record<string,unknown>).populationMembers;
    if(raw===undefined){if(required)throw new Error('Finite population genesis requires populationMembers');return[]}
    if(!Array.isArray(raw))throw new Error('populationMembers must be an array');
    const members=raw.map((value,index):PopulationGenesisMember=>{
        if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='agentId,playerUsername')
            throw new Error(`populationMembers[${index}] is invalid`);
        const member=value as Record<string,unknown>;
        if(typeof member.agentId!=='string'||!ID.test(member.agentId)||typeof member.playerUsername!=='string'||!USER.test(member.playerUsername))
            throw new Error(`populationMembers[${index}] identity is invalid`);
        return{agentId:member.agentId.toLowerCase(),playerUsername:member.playerUsername.toLowerCase()};
    });
    if(new Set(members.map(item=>item.agentId)).size!==members.length||new Set(members.map(item=>item.playerUsername)).size!==members.length)
        throw new Error('Population members must be unique by agent and player');
    return members.sort((a,b)=>a.agentId.localeCompare(b.agentId));
}

export function resolvePopulationGenesis(result:WorldGenesisResult,profiles:WorldGenesisProfileCatalog,
    policies:PopulationLifecyclePolicyCatalog,bindings:PopulationWorldProfileBindingCatalog){
    const profile=profiles.profiles.find(value=>value.profileId===result.profile.profileId);
    if(!profile||profile.version!==result.profile.version||profile.digest!==result.profile.digest)
        throw new Error('Genesis result does not reference the exact configured world profile');
    const policy=resolvePopulationLifecyclePolicy(profile,policies,bindings);
    const members=populationMembersFromGenesis(result,policy!==null);
    if(!policy&&members.length)throw new Error('World profile has no finite population lifecycle policy');
    if(policy&&(members.length<profile.population.minimumAgents||members.length>profile.population.maximumAgents))
        throw new Error('Genesis population member count is outside the world profile bounds');
    return{profile,policy,members};
}
