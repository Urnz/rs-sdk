import { afterEach,beforeAll,expect,test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import World from '../engine/World.js';
import { loadPackedContent } from './native-food-skill-fixture.js';
import { fixture,closeNativeMiningFixtures } from './native-mining-tool-fixture.js';
import { NativeMiningCoverageStore,miningCoverageSourceHeads,type NativeMiningCoverageSelection } from '../../../../item-lifecycle/native-mining-coverage.js';
import { miningOwner } from '../../../../agent-skills/mining-demand-source.js';
import { tickNativeMiningIntents } from './NativeMiningIntentRuntime.js';
import { NativeMiningIntentTracker } from './NativeMiningIntent.js';
import type { MiningCoveragePorts } from './NativeMiningCoverage.js';
import { NativeToolStore } from '../../../../item-lifecycle/native-tool.js';
import InvType from '../cache/config/InvType.js';
import { installMiningExecutorSource } from '../../../../agent-skills/mining-request-source.js';
import { persistMiningOperationAdmission,sealMiningOperationAdmission } from '../../../../agent-skills/mining-admission.js';
import { miningGatherArgs } from '../../../../sdk/mining-demand.js';
import { nativeToolDigest } from '../../../../item-lifecycle/native-tool.js';
import { readNativeMiningCohortCoverage } from '../../../../society-metrics/tool-demand-coverage.js';
beforeAll(loadPackedContent);afterEach(closeNativeMiningFixtures);
function harness(executor=false){
    const f=fixture(undefined,{username:'alice'}),players=[f.miner,...['bob','carol','dave'].map(name=>f.player(name))];
    const originalIdentity=f.p.identity,clock=()=>originalIdentity('alice','coverage',0,World.currentTick)!.clock;
    const actors=players.map(player=>miningOwner(originalIdentity(player.username,'coverage',0,World.currentTick)!.action)),c=clock();
    const selection:NativeMiningCoverageSelection={schemaVersion:1,selectionId:randomUUID(),worldId:actors[0]!.worldId,
        clockId:c.clockId,clockProfileDigest:c.profileDigest,fromSimulationTime:c.simulationTime,
        toSimulationTime:new Date(Date.parse(c.simulationTime)+(executor?1200:60000)).toISOString(),maximumSimulationGapMs:5000,maximumWallGapMs:5000,
        actors,openingHeads:miningCoverageSourceHeads(f.market.db)};
    if(executor){const s={schemaVersion:1 as const,selectionId:selection.selectionId,worldId:selection.worldId,clockId:selection.clockId,clockProfileDigest:selection.clockProfileDigest,
        fromSimulationTime:selection.fromSimulationTime,toSimulationTime:selection.toSimulationTime,actors};
        installMiningExecutorSource(f.workspace,f.checkpointPath,s);selection.executorSelectionDigest=nativeToolDigest(s);selection.openingHeads=miningCoverageSourceHeads(f.market.db);}
    const store=new NativeMiningCoverageStore(f.market.db,selection);let online=true;
    const coverage:MiningCoveragePorts={db:f.market.db,workspace:f.workspace,clock,identity:(...args)=>f.p.identity(...args),
        roster:()=>actors,player:name=>!online&&name==='dave'?null:players.find(p=>p.username===name)??null,admitted:()=>false};
    f.p.miningCoverage=coverage;
    const tracker=new NativeMiningIntentTracker({...f.p,clock,authorizeStart:()=>({authorityDigest:'d'.repeat(64)})});
    const local={workspace:'.',tracker,player:coverage.player,coverage};
    return{...f,players,selection,store,coverage,local,offline(){online=false;}};
}
test('SI-C07 real native tick witnesses executor requests even when no native admission was reached',()=>{
    const f=harness(true),at=f.coverage.clock()!.wallTime;tickNativeMiningIntents(f.local);
    const request={operation:'open' as const,args:miningGatherArgs({name:'copper',skill:'Mining',item:'copper ore',timeoutMs:1000}),
        context:{runId:randomUUID(),skill:{id:'mining.fixture',version:'1.0.0'},stepId:'gather',parametersDigest:'c'.repeat(64),operationSequence:1}};
    persistMiningOperationAdmission(f.workspace,'alice','d'.repeat(64),request,Date.parse(at));World.currentTick++;tickNativeMiningIntents(f.local);
    sealMiningOperationAdmission(f.workspace,request);World.currentTick++;tickNativeMiningIntents(f.local);
    const report=readNativeMiningCohortCoverage(f.market.db,{clockId:f.selection.clockId,clockProfileDigest:f.selection.clockProfileDigest,
        fromSimulationTime:f.selection.fromSimulationTime,toSimulationTime:f.selection.toSimulationTime,actorAgentIds:f.selection.actors.map(a=>a.actorId)},f.selection.worldId,
        f.selection.actors.map(a=>({agentId:a.actorId,username:a.username,lifecycleId:a.lifecycleId})));
    expect(report.completeDemandCoverage).toBeTrue();if(!('executorCoverage'in report))throw Error('No executor source');
    expect(report.executorCoverage.positiveOpportunity).toBeTrue();expect(report.executorCoverage.requests[0]?.nativeIntentObserved).toBeFalse();
});
test('SI-C07 cohort observer samples all four founders through the real tick hook with no standing requests',()=>{
    const f=harness();tickNativeMiningIntents(f.local);const event=f.store.read().entries[0]!.event;
    expect(event.kind).toBe('sample');if(event.kind!=='sample')throw Error('No cohort frame');
    expect(event.actors).toHaveLength(4);expect(event.actors.every(a=>a.status==='observed'&&a.demandId===null)).toBeTrue();
    f.offline();World.currentTick++;tickNativeMiningIntents(f.local);
    const tail=f.store.read().entries.at(-1)!.event;if(tail.kind!=='sample')throw Error('No cohort frame');
    expect(tail.actors.find(a=>a.actorId==='actor-dave')?.status).toBe('offline');
});
test('SI-C07 sleep flag alone, terminal avatars and missing or stale identity never become observed sleepers',()=>{
    for(const mode of ['flag-only','terminal','identity','stale-clock','proof-error'] as const){const f=harness();f.players[0]!.populationSleeping=true;
        if(mode==='terminal')f.players[0]!.populationTerminal=true;
        else if(mode==='identity')f.p.identity=()=>null;
        else if(mode==='stale-clock'){const original=f.p.identity;f.p.identity=(...args)=>{const c=original(...args)!;return{...c,clock:{...c.clock,engineTick:c.clock.engineTick!+1}};};}
        else if(mode==='proof-error')f.coverage.sleeping=()=>{throw Error('missing native lease source');};
        tickNativeMiningIntents(f.local);const event=f.store.read().entries.at(-1)!.event;if(event.kind!=='sample')throw Error('Missing sample');
        expect(event.actors[0]!.status).toBe(mode==='identity'||mode==='stale-clock'?'identity-unavailable':mode==='proof-error'?'source-unavailable':'restricted');
        expect(event.actors[0]!.sleep).toBeUndefined();
    }
});
test('SI-C07 selected cohort raw packed Mining is observed as a legacy gap and rejected without ore or wear',()=>{
    const f=harness();const state=f.mine(),events=f.store.read().entries.map(e=>e.event).filter(e=>e.kind==='ingress');
    expect(events.length).toBeGreaterThan(0);expect(events.every(e=>e.reason==='no-standing-request'&&e.demandId===null)).toBeTrue();
    expect(events.every(e=>typeof e.nativeActionId==='string'&&e.nativeActionId.length===36)).toBeTrue();
    expect(f.store.read().entries.every(e=>e.event.clock.clockId===f.selection.clockId)).toBeTrue();
    expect(f.store.read().selection).toEqual(f.selection);expect(state.execution).toBe(-1);
    expect(f.store.read().entries.every(e=>e.event.kind!=='ingress'||e.event.reason!=='source-bound-request')).toBeTrue();
    expect(f.market.db.query('SELECT 1 FROM native_tool_event WHERE event_id=?').get(events[0]!.nativeActionId)).toBeNull();
    expect(new NativeToolStore(f.market.db).lifecycle.get('tool-alice')!.durability).toBe(100);expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);
    expect(f.store.read().selection.actors).toHaveLength(4);
});
test('SI-C07 missing population identity is durably observed before the native early return or rejection',()=>{
    const f=harness();f.p.identity=()=>null;
    try{f.mine();}catch{ /* Existing native rejection remains unchanged. */ }
    const rows=f.store.read().entries.filter(e=>e.event.kind==='ingress');expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(e=>e.event.kind==='ingress'&&e.event.reason==='identity-unavailable')).toBeTrue();
    World.currentTick++;tickNativeMiningIntents(f.local);const last=f.store.read().entries.at(-1)!.event;
    if(last.kind!=='sample')throw Error('No cohort frame');expect(last.actors.every(a=>a.status==='identity-unavailable')).toBeTrue();
});
test('SI-C07 unbound avatar path still leaves a native ingress gap and does not fabricate a pending request',()=>{
    const f=harness(),unbound=f.player('alice',false);expect(f.mine(4096,unbound).execution).toBe(-1);
    const rows=f.store.read().entries.filter(e=>e.event.kind==='ingress');expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(e=>e.event.kind==='ingress'&&e.event.reason==='no-standing-request')).toBeTrue();
    expect(f.local.tracker.store.pending()).toHaveLength(0);
});
