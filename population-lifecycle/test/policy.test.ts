import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { buildWorldGenesisConfiguration, buildWorldGenesisResult,
    loadWorldGenesisProfileCatalog } from '../../world-genesis/index.js';
import { loadPopulationLifecyclePolicyCatalog, loadPopulationWorldProfileBindingCatalog,
    resolvePopulationGenesis, resolvePopulationLifecyclePolicy } from '../index.js';

const configDirectory=join(import.meta.dir,'..','..','config');
const profiles=loadWorldGenesisProfileCatalog(join(configDirectory,'world-genesis-profiles.json'));
const policies=loadPopulationLifecyclePolicyCatalog(join(configDirectory,'population-lifecycle-policies.json'));
const bindings=loadPopulationWorldProfileBindingCatalog(join(configDirectory,'population-world-profile-bindings.json'));

function result(profileId:'mature-society'|'frontier',members=4){
    const profile=profiles.profiles.find(item=>item.profileId===profileId)!;
    const configuration=buildWorldGenesisConfiguration({seed:`population-${profileId}`,profile,
        worldBuild:'lostcity-local-v1',simulationClock:{clockId:'world',profileDigest:'e'.repeat(64),
            initialSimulationTime:'2001-01-01T00:00:00.000Z'}});
    return buildWorldGenesisResult(configuration,{assets:[],populationMembers:Array.from({length:members},(_,index)=>({
        agentId:`member-${index+1}`,playerUsername:`member${index+1}`}))},'2026-10-13T12:00:00.000Z');
}

describe('population lifecycle policy binding',()=>{
    test('binds only social-simulation profiles to the finite policy',()=>{
        const mature=profiles.profiles.find(item=>item.profileId==='mature-society')!;
        const historical=profiles.profiles.find(item=>item.profileId==='historical-burn-in')!;
        const frontier=profiles.profiles.find(item=>item.profileId==='frontier')!;
        expect(resolvePopulationLifecyclePolicy(mature,policies,bindings)).toMatchObject({kind:'finite',
            scope:'social-simulation',deathTransition:'terminal',respawn:'forbidden'});
        expect(resolvePopulationLifecyclePolicy(historical,policies,bindings)).toMatchObject({kind:'finite'});
        expect(resolvePopulationLifecyclePolicy(frontier,policies,bindings)).toBeNull();
        expect(policies.policies.find(item=>item.kind==='classic-respawn-compatibility')).toMatchObject({
            scope:'compatibility-experiment',deathTransition:'avatar-respawn',respawn:'engine-classic'});
        expect(bindings.bindings.some(binding=>binding.policyId==='classic-respawn-compatibility')).toBeFalse();
    });

    test('requires exact profile and policy digests and a bounded unique population',()=>{
        expect(resolvePopulationGenesis(result('mature-society'),profiles,policies,bindings).members).toHaveLength(4);
        expect(()=>resolvePopulationGenesis(result('mature-society',3),profiles,policies,bindings))
            .toThrow('outside the world profile bounds');
        expect(()=>resolvePopulationGenesis(result('frontier'),profiles,policies,bindings))
            .toThrow('no finite population lifecycle policy');
        const stale={...bindings,bindings:bindings.bindings.map((binding,index)=>index===0
            ?{...binding,worldProfileDigest:'0'.repeat(64)}:binding)};
        expect(()=>resolvePopulationGenesis(result('mature-society'),profiles,policies,stale))
            .toThrow('binding is stale');
    });
});
