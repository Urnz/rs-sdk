import {expect,test} from 'bun:test';
import {join} from 'node:path';
import {loadSocietyMinimumContract} from '../../society-minimum/contract.js';
import type {MinimumFrame} from '../../society-minimum/assessment.js';
import {projectNativeSourceCoverage} from '../source-coverage.js';
const contract=loadSocietyMinimumContract(join(import.meta.dir,'../../config'));
const scope={clockId:'clock',clockProfileDigest:'a'.repeat(64),actorAgentIds:['ada','bea','cora','dora'],
    fromSimulationTime:'2001-01-02T00:00:00.000Z',toSimulationTime:'2001-01-09T00:00:00.000Z'};
const frame:MinimumFrame={...scope,worldId:'world',contractDigest:contract.digest,founderAgentIds:scope.actorAgentIds,genesisAppliedAtSimulationTime:'2001-01-01T00:00:00.000Z'};
const available=(value:any)=>({status:'available',digest:'b'.repeat(64),value});
function fixture(){
    // Reader-contract fixture, not proof of actual native coverage. The genesis test exercises real SQLite sources.
    const world=contract.dependencies.worlds[0]!;
    const sources:any={populationBaseline:available({worldId:'world',clockId:scope.clockId,clockProfileDigest:scope.clockProfileDigest,
        genesisAppliedAtSimulationTime:frame.genesisAppliedAtSimulationTime,worldProfile:world.profile,lifecyclePolicy:world.lifecyclePolicy,
        founders:scope.actorAgentIds.map(agentId=>({agentId,playerUsername:agentId})),genesisResultId:'genesis',genesisResultDigest:'c'.repeat(64)}),
        populationDeaths:available({founderBindings:scope.actorAgentIds.map(actorId=>({actorId}))}),
        genesisOpening:available({scope,worldId:'world',at:frame.genesisAppliedAtSimulationTime,genesisResultId:'genesis',genesisResultDigest:'c'.repeat(64),completeOpeningSources:true}),
        mortalityCoverage:available({scope,worldId:'world',completeMortalityTickCoverage:true,fromSimulationTime:frame.genesisAppliedAtSimulationTime,
            toSimulationTime:scope.toSimulationTime,sourceHead:{sequence:100,hash:'d'.repeat(64)}})};
    return{sources,outcomes:{scope,worldId:'world',sources} as any};
}
test('native coverage consumes the existing opening/original/mortality guarantees while all remaining unavailable producers stay unknown',()=>{
    const f=fixture(),r=projectNativeSourceCoverage(contract,frame,f.outcomes);expect(r.completeSourceCount).toBe(3);expect(r.verdict).toBe('inconclusive');
    expect(r.rows.filter(x=>x.status==='complete').map(x=>x.sourceId)).toEqual(['applied-genesis','original-population','native-mortality-passes']);
    expect(r.rows.find(x=>x.sourceId==='native-mortality-passes')!.certifiedIntervals).toEqual([{from:frame.genesisAppliedAtSimulationTime,to:frame.toSimulationTime}]);
    expect(r.remainingImplementationDependencies.find(x=>x.sourceId==='clock-world-policy')!.closureIds).toEqual(['P2-04']);
    expect(r.remainingImplementationDependencies.find(x=>x.sourceId==='administrative-value-history')!.closureIds).toEqual(['P2-06']);
});
test('available databases, empty queues and ledger heads alone cannot certify any temporal denominator or producer universe',()=>{
    const f=fixture();for(const key of ['lifecycleAttempts','lifecycleWatermarks','lifecyclePolicy','policyMutations','toolDemand','toolMaintenance'])f.sources[key]=available({});
    const integration={scope,worldId:'world',sources:Object.fromEntries(['needs','modes','nutrition','lineage','production','foodBoundaries','housingAccess','toolBoundaries','currentAssets','custody']
        .map(k=>[k,available({})]))} as any;
    const r=projectNativeSourceCoverage(contract,frame,f.outcomes,integration);expect(r.completeSourceCount).toBe(3);expect(r.verdict).toBe('inconclusive');
    expect(r.rows.find(x=>x.sourceId==='executor-native-demand')!.gaps).toContain('warmup-request-history-unproven');
    expect(r.rows.find(x=>x.sourceId==='business-treasury-custody')!.status).toBe('partial');
});
test('wrong world/profile/genesis/clock/window or partial opening cannot donate complete coverage',()=>{
    const cases:Array<(f:ReturnType<typeof fixture>)=>void>=[f=>{f.outcomes.worldId='foreign';},f=>{f.outcomes.scope={...scope,clockId:'foreign'};},
        f=>{f.sources.genesisOpening.value.genesisResultDigest='f'.repeat(64);},f=>{f.sources.genesisOpening.value.completeOpeningSources=false;},
        f=>{f.sources.mortalityCoverage.value.fromSimulationTime=scope.fromSimulationTime;},f=>{f.sources.mortalityCoverage.value.scope={...scope,toSimulationTime:'2001-01-08T00:00:00.000Z'};},
        f=>{f.sources.populationBaseline.value.lifecyclePolicy={digest:'f'.repeat(64)};}];
    for(const mutate of cases){const f=fixture();mutate(f);const r=projectNativeSourceCoverage(contract,frame,f.outcomes);expect(r.completeSourceCount).toBeLessThan(3);expect(r.verdict).toBe('inconclusive');}
});
test('world policy source coverage requires the joined native guarantee and exact original window',()=>{
    const f=fixture();f.sources.worldPolicy=available({scope,worldId:'world',fromSimulationTime:frame.genesisAppliedAtSimulationTime,toSimulationTime:frame.toSimulationTime,
        completeWorldPolicyCoverage:true,policyHead:{sequence:2},mutationHead:{sequence:0},runtimeHead:{sequence:2}});
    expect(projectNativeSourceCoverage(contract,frame,f.outcomes).rows.find(r=>r.sourceId==='clock-world-policy')!.status).toBe('complete');
    f.sources.worldPolicy.value.fromSimulationTime=scope.fromSimulationTime;
    expect(projectNativeSourceCoverage(contract,frame,f.outcomes).rows.find(r=>r.sourceId==='clock-world-policy')!.status).not.toBe('complete');
});

test('invalid/unbound frame is redacted, and mere raw result fields cannot upload coverage proofs',()=>{
    const f=fixture();f.outcomes.sourceCoverage={verdict:'pass',completeSourceCount:16};
    expect(projectNativeSourceCoverage(contract,frame,f.outcomes).completeSourceCount).toBe(3);
    const r=projectNativeSourceCoverage(contract,{...frame,contractDigest:'PRIVATE FRAME'},f.outcomes);expect(r.bindingStatus).toBe('invalid');expect(JSON.stringify(r)).not.toContain('PRIVATE FRAME');
    expect(projectNativeSourceCoverage(contract,{...frame,founderAgentIds:null} as any,f.outcomes).bindingStatus).toBe('invalid');
    expect(projectNativeSourceCoverage(contract,frame,null).completeSourceCount).toBe(0);
});
