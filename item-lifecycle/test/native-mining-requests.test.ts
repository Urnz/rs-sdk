import { afterEach,expect,test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { OwnedDatabase } from '../../server/engine/src/io/OwnedDatabase.js';
import { NativeMiningRequestStore,type MiningExecutorSelection } from '../native-mining-requests.js';
import { NativeMiningCoverageStore,miningCoverageSourceHeads,miningRosterDigest,type NativeMiningCoverageSample } from '../native-mining-coverage.js';
import { NativeMiningDemandStore } from '../native-mining-demand.js';
import { NativeMiningIntentStore } from '../native-mining-intent.js';
import { nativeToolDigest as hash } from '../native-tool.js';
import { miningDemandId } from '../../agent-skills/mining-admission.js';
import { miningGatherArgs,type MiningDemandRequest } from '../../sdk/mining-demand.js';
import { readNativeMiningCohortCoverage } from '../../society-metrics/tool-demand-coverage.js';
const dbs:OwnedDatabase[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close(true);});
function fixture(){const db=new OwnedDatabase(':memory:');dbs.push(db);new NativeMiningDemandStore(db);new NativeMiningIntentStore(db);
    const actors=['alice','bob','carol','dave'].map(username=>({actorId:username,username,lifecycleId:`life-${username}`,worldId:'world',clockId:'clock',clockProfileDigest:'b'.repeat(64)}));
    const s:MiningExecutorSelection={schemaVersion:1,selectionId:randomUUID(),worldId:'world',clockId:'clock',clockProfileDigest:'b'.repeat(64),actors,
        fromSimulationTime:'2001-01-01T00:00:00.000Z',toSimulationTime:'2001-01-01T00:00:01.200Z'};
    const requests=new NativeMiningRequestStore(db,s),selection={...s,maximumSimulationGapMs:600,maximumWallGapMs:1000,openingHeads:miningCoverageSourceHeads(db),executorSelectionDigest:hash(s)},
        coverage=new NativeMiningCoverageStore(db,selection),scope={clockId:s.clockId,clockProfileDigest:s.clockProfileDigest,actorAgentIds:actors.map(a=>a.actorId),fromSimulationTime:s.fromSimulationTime,toSimulationTime:s.toSimulationTime};
    function sample(tick:number):NativeMiningCoverageSample{return{kind:'sample',sessionId:'session',rosterDigest:miningRosterDigest(actors),heads:miningCoverageSourceHeads(db),ingressWriteFailed:false,executorSourceAvailable:true,
        clock:{clockId:s.clockId,profileDigest:s.clockProfileDigest,status:'running',revision:1,engineTick:tick,simulationTime:new Date(Date.parse(s.fromSimulationTime)+tick*600).toISOString(),
            wallTime:new Date(Date.UTC(2026,9,26)+tick*600).toISOString()},actors:actors.map(a=>({actorId:a.actorId,status:'observed',demandId:null}))};}
    const request:MiningDemandRequest={operation:'open',args:miningGatherArgs({name:'copper',item:'copper ore',skill:'Mining',timeoutMs:1000}),
        context:{runId:randomUUID(),skill:{id:'mining.fixture',version:'1.0.0'},stepId:'gather',parametersDigest:'d'.repeat(64),operationSequence:1}};
    const body={schemaVersion:1 as const,username:'alice',checksum:'c'.repeat(64),args:request.args,context:request.context,admittedAt:new Date(Date.UTC(2026,9,26)+100).toISOString(),expiresAtWallTime:new Date(Date.UTC(2026,9,26)+1100).toISOString()};
    const r={schemaVersion:1 as const,demandId:miningDemandId(request),owner:actors[0]!,admission:{...body,digest:hash(body)},phase:'requested' as const};
    const read=()=>readNativeMiningCohortCoverage(db,scope,'world',actors.map(a=>({agentId:a.actorId,username:a.username,lifecycleId:a.lifecycleId})));
    return{db,s,requests,coverage,sample,r,read};
}
test('prospective request source counts pre-native failures and native tick heads bound their entire outstanding lifetime',()=>{
    const f=fixture();f.coverage.append(f.sample(0));f.requests.append(f.r);f.coverage.append(f.sample(1));f.requests.append({...f.r,phase:'closed'});f.coverage.append(f.sample(2));
    const before=f.db.serialize(),r=f.read();expect(r.completeDemandCoverage).toBeTrue();
    if(!('executorCoverage'in r))throw Error('No executor coverage');expect(r.executorCoverage).toMatchObject({positiveOpportunity:true,longestOutstandingUpperSimulationMs:1200});
    expect(r.executorCoverage.requests[0]).toMatchObject({nativeIntentObserved:false,outstandingUpperSimulationMs:1200});expect(f.db.serialize()).toEqual(before);
});
test('covered empty producer is zero opportunity, never an invented zero-duration certificate',()=>{
    const f=fixture();for(let i=0;i<3;i++)f.coverage.append(f.sample(i));const r=f.read();expect(r.completeDemandCoverage).toBeTrue();
    if(!('executorCoverage'in r))throw Error('No executor coverage');expect(r.executorCoverage).toMatchObject({positiveOpportunity:false,longestOutstandingUpperSimulationMs:null});
});
test('adjacent requests by one actor do not reset a possible continuous wait',()=>{
    const f=fixture();f.coverage.append(f.sample(0));f.requests.append(f.r);f.requests.append({...f.r,phase:'closed'});f.coverage.append(f.sample(1));
    const {digest,...prior}=f.r.admission,body={...prior,context:{...prior.context,operationSequence:2},
        admittedAt:new Date(Date.UTC(2026,9,26)+700).toISOString(),expiresAtWallTime:new Date(Date.UTC(2026,9,26)+1700).toISOString()},
        r={...f.r,demandId:miningDemandId({operation:'open',args:body.args,context:body.context}),admission:{...body,digest:hash(body)}};
    f.requests.append(r);f.requests.append({...r,phase:'closed'});f.coverage.append(f.sample(2));const report=f.read();
    if(!('executorCoverage'in report))throw Error('Missing coverage');expect(report.executorCoverage.longestOutstandingUpperSimulationMs).toBe(1200);
    expect(report.executorCoverage.requests.map(r=>r.outstandingUpperSimulationMs)).toEqual([600,600]);
});
test('missing native watermark or observer tick cannot certify a producer request',()=>{
    const f=fixture();f.coverage.append(f.sample(0));f.requests.append(f.r);f.coverage.append(f.sample(2));expect(f.read().completeDemandCoverage).toBeFalse();
    const g=fixture();for(let i=0;i<3;i++)g.coverage.append(g.sample(i));g.requests.append(g.r);expect(g.read().completeDemandCoverage).toBeFalse();
});
test('own additive schema reopens idempotently, preserves shared version, rejects conflicting install, unknown closes and payload mutation',()=>{
    const f=fixture();f.db.run('PRAGMA user_version=42');f.requests.append(f.r);f.requests.append(f.r);new NativeMiningRequestStore(f.db,f.s);
    expect(f.requests.read().entries).toHaveLength(1);expect(f.db.query('PRAGMA user_version').get()).toEqual({user_version:42});
    expect(()=>new NativeMiningRequestStore(f.db,{...f.s,selectionId:randomUUID()})).toThrow('conflict');
    expect(()=>f.requests.append({...f.r,phase:'closed',demandId:randomUUID()})).toThrow();expect(()=>f.db.run("UPDATE native_mining_request_event SET payload='{}'")).toThrow('immutable');
    f.requests.append({...f.r,phase:'closed'});expect(f.requests.read().entries).toHaveLength(2);
    const db=new OwnedDatabase(':memory:');dbs.push(db);db.exec(`CREATE TABLE native_mining_request_selection(singleton INTEGER PRIMARY KEY,payload TEXT,digest TEXT);
        CREATE TRIGGER fail_install BEFORE INSERT ON native_mining_request_selection BEGIN SELECT RAISE(ABORT,'injected install failure'); END;`);
    expect(()=>new NativeMiningRequestStore(db,f.s)).toThrow('injected');expect(db.query("SELECT name FROM sqlite_master WHERE name='native_mining_request_event'").get()).toBeNull();
});
test('corrupt executor source prefix or future producer clock is rejected rather than narrowing the request denominator',()=>{
    const f=fixture();f.coverage.append(f.sample(0));f.requests.append(f.r);f.coverage.append(f.sample(1));f.coverage.append(f.sample(2));
    f.db.run('UPDATE native_mining_request_head SET digest=?',['e'.repeat(64)]);expect(f.read).toThrow();
    const g=fixture();g.coverage.append(g.sample(0));const {digest,...body}=g.r.admission;
    const admission={...body,admittedAt:new Date(Date.UTC(2026,9,27)).toISOString(),expiresAtWallTime:new Date(Date.UTC(2026,9,27)+1000).toISOString()};
    g.requests.append({...g.r,admission:{...admission,digest:hash(admission)}});g.coverage.append(g.sample(1));g.coverage.append(g.sample(2));expect(g.read().completeDemandCoverage).toBeFalse();
});
