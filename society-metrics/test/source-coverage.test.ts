import {expect,test} from 'bun:test';
import {join} from 'node:path';
import {loadSocietyMinimumContract} from '../../society-minimum/contract.js';
import type {MinimumFrame} from '../../society-minimum/assessment.js';
import {projectNativeSourceCoverage} from '../source-coverage.js';
import {societyMinimumDigest as digest} from '../../society-minimum/policy.js';
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

test('administrative value coverage requires the original full native seal and genesis binding',()=>{
    const f=fixture();f.sources.administrativeValue=available({scope,worldId:'world',fromSimulationTime:frame.genesisAppliedAtSimulationTime,toSimulationTime:frame.toSimulationTime,
        genesisResultId:'genesis',genesisResultDigest:'c'.repeat(64),completeAdministrativeValueCoverage:true,sourceHead:{sequence:1,hash:'d'.repeat(64)},stateDigest:'e'.repeat(64)});
    const row=()=>projectNativeSourceCoverage(contract,frame,f.outcomes).rows.find(r=>r.sourceId==='administrative-value-history')!;
    expect(row().status).toBe('complete');f.sources.administrativeValue.value.fromSimulationTime=scope.fromSimulationTime;expect(row().status).not.toBe('complete');
    f.sources.administrativeValue.value.fromSimulationTime=frame.genesisAppliedAtSimulationTime;f.sources.administrativeValue.value.genesisResultDigest='f'.repeat(64);expect(row().status).not.toBe('complete');
});

test('lifecycle source coverage requires the joined original full-window native guarantee, not separate empty ledgers',()=>{
    const f=fixture();f.sources.lifecycleEnforcement=available({scope,worldId:'world',fromSimulationTime:frame.genesisAppliedAtSimulationTime,
        toSimulationTime:frame.toSimulationTime,completeLifecycleEnforcement:true,completeNativeHealthCoverage:true,attemptHead:{sequence:0},censusHead:{sequence:2},healthSnapshotDigest:'c'.repeat(64)});
    const selected=()=>projectNativeSourceCoverage(contract,frame,f.outcomes).rows.filter(r=>['native-health-deaths','login-respawn-enforcement'].includes(r.sourceId));
    expect(selected().map(r=>r.status)).toEqual(['complete','complete']);
    f.sources.lifecycleEnforcement.value.fromSimulationTime=scope.fromSimulationTime;expect(selected().every(r=>r.status!=='complete')).toBeTrue();
    f.sources.lifecycleEnforcement.value.fromSimulationTime=frame.genesisAppliedAtSimulationTime;f.sources.lifecycleEnforcement.value.completeLifecycleEnforcement=false;
    expect(selected().every(r=>r.status!=='complete')).toBeTrue();
});

test('external value coverage requires the original cohort/genesis and full native producer window',()=>{
    const f=fixture();f.sources.externalValue=available({scope,worldId:'world',fromSimulationTime:frame.genesisAppliedAtSimulationTime,toSimulationTime:frame.toSimulationTime,
        genesisResultId:'genesis',genesisResultDigest:'c'.repeat(64),completeExternalValueCoverage:true,sourceHeads:{trades:{sequence:0},market:{sequence:0},treasury:{sequence:0}}});
    const row=()=>projectNativeSourceCoverage(contract,frame,f.outcomes).rows.find(r=>r.sourceId==='external-shop-import-history')!;
    expect(row().status).toBe('complete');f.sources.externalValue.value.fromSimulationTime=scope.fromSimulationTime;expect(row().status).not.toBe('complete');
    f.sources.externalValue.value.fromSimulationTime=frame.genesisAppliedAtSimulationTime;f.sources.externalValue.value.genesisResultDigest='f'.repeat(64);expect(row().status).not.toBe('complete');
    f.sources.externalValue.value.genesisResultDigest='c'.repeat(64);f.sources.externalValue.value.scope={...scope,actorAgentIds:['foreign']};expect(row().status).not.toBe('complete');
});

test('lineage coverage consumes only sealed original food and tool windows, separately from numeric final-use or cycle minima',()=>{
    const f=fixture();f.sources.internalLineage=available({scope,worldId:'world',fromSimulationTime:frame.genesisAppliedAtSimulationTime,toSimulationTime:frame.toSimulationTime,
        genesisResultId:'genesis',genesisResultDigest:'c'.repeat(64),completeFoodLineageCoverage:true,completeToolLineageCoverage:true,sourceHead:{stateDigest:'d'.repeat(64)}});
    const selected=()=>projectNativeSourceCoverage(contract,frame,f.outcomes).rows.filter(r=>['native-food-lineage','tool-lifecycle-work','tool-material-custody'].includes(r.sourceId));
    expect(selected().map(r=>r.status)).toEqual(['complete','complete','complete']);f.sources.internalLineage.value.completeFoodLineageCoverage=false;
    expect(selected().map(r=>r.status)).toEqual(['partial','complete','complete']);f.sources.internalLineage.value.genesisResultDigest='f'.repeat(64);
    expect(selected().every(r=>r.status!=='complete')).toBeTrue();
});

function historyFixture(){
    // Contract-only join fixture; actual native replay/paused snapshots are exercised in population-outcomes.test.ts.
    const f=fixture(),fullScope={...scope,fromSimulationTime:frame.genesisAppliedAtSimulationTime},window={scope,worldId:'world',
        fromSimulationTime:frame.genesisAppliedAtSimulationTime,toSimulationTime:scope.toSimulationTime,genesisResultId:'genesis',genesisResultDigest:'c'.repeat(64)};
    f.sources.populationDeaths.value.deaths=[];
    f.sources.internalLineage=available({...window,completeFoodLineageCoverage:true,completeToolLineageCoverage:true});
    f.sources.administrativeValue=available({...window,completeAdministrativeValueCoverage:true});
    f.sources.externalValue=available({...window,completeExternalValueCoverage:true});
    f.sources.minimumDemandHistory=available({scope:fullScope,worldId:'world',cohortCoverage:{completeDemandCoverage:true},sourceHead:{sequence:0,digest:null}});
    const boundaryTimes=Array.from({length:193},(_,i)=>new Date(Date.parse(frame.genesisAppliedAtSimulationTime)+i*3600000).toISOString());
    const history={...window,scope,fullScope,contractDigest:contract.digest,founderAgentIds:[...scope.actorAgentIds].sort(),
        founderDigest:digest(f.sources.populationDeaths.value.founderBindings),completePhysiologyCoverage:true,completePhysicalBoundaries:true,
        completeHousingCoverage:true,completeCustodyBoundaries:true,boundaryTimes,populationAtBoundaries:boundaryTimes.map(at=>({at,terminalAgentIds:[]})),
        sources:Object.fromEntries(['needs','modes','nutrition','foodBoundaries','housingAccess','toolBoundaries','wealthBoundaries'].map(name=>[name,available({})])),
        sourceDigest:'a'.repeat(64),exposureDigest:'a'.repeat(64),housingDigest:'a'.repeat(64)};
    const integration={scope,worldId:'world',minimumHistory:history,sources:{}} as any;
    return{...f,history,integration,read:(binding=frame)=>projectNativeSourceCoverage(contract,binding,f.outcomes,integration)};
}

test('full original history independently joins all five boundary/access/demand families while the other minimum gates remain unknown',()=>{
    const f=historyFixture(),r=f.read();
    for(const id of ['physiology-modes','frozen-physical-boundaries','housing-rights','executor-native-demand','business-treasury-custody'])
        expect(r.rows.find(s=>s.sourceId===id)!.status).toBe('complete');
    expect(r.verdict).toBe('inconclusive');expect(r.integrity.some(g=>g.coverage==='inconclusive')).toBeTrue();
    f.history.completePhysiologyCoverage=false;expect(f.read().rows.find(s=>s.sourceId==='physiology-modes')!.status).toBe('partial');
    expect(f.read().rows.find(s=>s.sourceId==='housing-rights')!.status).toBe('complete');
    f.sources.minimumDemandHistory.value.cohortCoverage.completeDemandCoverage=false;
    expect(f.read().rows.find(s=>s.sourceId==='executor-native-demand')!.status).toBe('partial');
});

test('missing warmup, foreign history bindings, sparse or extra physical observations and missing custody flows cannot borrow a complete family',()=>{
    const cases:Array<(f:ReturnType<typeof historyFixture>)=>void>=[f=>{f.history.fromSimulationTime=scope.fromSimulationTime;},
        f=>{f.history.genesisResultDigest='f'.repeat(64);},f=>{f.history.founderDigest='f'.repeat(64);},
        f=>{f.history.fullScope={...f.history.fullScope,clockId:'foreign'};},f=>{f.integration.worldId='foreign';},
        f=>{f.history.founderAgentIds=f.history.founderAgentIds.slice(1);}];
    for(const mutate of cases){const f=historyFixture();mutate(f);const r=f.read();
        for(const id of ['physiology-modes','frozen-physical-boundaries','housing-rights','business-treasury-custody'])expect(r.rows.find(s=>s.sourceId===id)!.status).not.toBe('complete');}
    const f=historyFixture();f.history.boundaryTimes.splice(1,1);expect(f.read().rows.find(s=>s.sourceId==='frozen-physical-boundaries')!.status).toBe('partial');
    const g=historyFixture(),extra=new Date(Date.parse(scope.fromSimulationTime)+1000).toISOString();
    expect(g.read({...frame,boundaries:{times:[scope.fromSimulationTime,extra,scope.toSimulationTime],sourceDigest:'a'.repeat(64),complete:false}}).rows.find(s=>s.sourceId==='frozen-physical-boundaries')!.status).toBe('partial');
    g.sources.administrativeValue.value.worldId='foreign';expect(g.read().rows.find(s=>s.sourceId==='business-treasury-custody')!.status).toBe('partial');
    g.sources.minimumDemandHistory.value.scope=scope;expect(g.read().rows.find(s=>s.sourceId==='executor-native-demand')!.status).toBe('partial');
    const h=historyFixture();h.sources.internalLineage.value.completeFoodLineageCoverage=false;
    expect(h.read().rows.find(s=>s.sourceId==='business-treasury-custody')!.status).toBe('partial');
    const stale=historyFixture();stale.sources.populationDeaths.value.deaths=[{agentId:'ada',atSimulationTime:scope.fromSimulationTime}];
    expect(stale.read().rows.find(s=>s.sourceId==='frozen-physical-boundaries')!.status).toBe('partial');
    expect(stale.read().rows.find(s=>s.sourceId==='business-treasury-custody')!.status).toBe('partial');
});
