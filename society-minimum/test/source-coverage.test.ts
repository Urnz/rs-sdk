import {expect,test} from 'bun:test';
import {join} from 'node:path';
import {loadSocietyMinimumContract} from '../contract.js';
import {minimumSourceInventory} from '../source-inventory.js';
import {assessMinimumSourceCoverage,minimumCoverageBinding,type MinimumSourceCoverageProof} from '../source-coverage.js';
import type {MinimumFrame} from '../assessment.js';
const contract=loadSocietyMinimumContract(join(import.meta.dir,'../../config')),hour=3600000,start=Date.UTC(2001,0,1),iso=(n:number)=>new Date(n).toISOString();
function fixture(){
    const frame:MinimumFrame={contractDigest:contract.digest,worldId:'fixture',clockId:'clock',clockProfileDigest:'a'.repeat(64),founderAgentIds:['ada','bea','cora','dora'],
        genesisAppliedAtSimulationTime:iso(start),fromSimulationTime:iso(start+24*hour),toSimulationTime:iso(start+192*hour),
        boundaries:{times:Array.from({length:169},(_,i)=>iso(start+(24+i)*hour)),sourceDigest:'b'.repeat(64),complete:true}};
    // Pure contract fixture: these certificates do not claim actual native coverage or a functioning economy.
    const proofs:MinimumSourceCoverageProof[]=minimumSourceInventory(contract).definitions.map(d=>({sourceId:d.id,bindingDigest:minimumCoverageBinding(frame),
        status:'complete',headDigest:'c'.repeat(64),evidenceDigests:['d'.repeat(64)],actorAgentIds:frame.founderAgentIds,
        intervals:[{from:frame.genesisAppliedAtSimulationTime,to:frame.toSimulationTime}],openingAt:frame.genesisAppliedAtSimulationTime,
        boundaryTimes:Array.from({length:193},(_,i)=>iso(start+i*hour)),gaps:[]}));
    return{frame,proofs,read:()=>assessMinimumSourceCoverage(contract,frame,proofs)};
}
test('coverage contract ANDs all16 source families and maps all17 requirements/eight gates without certifying economic thresholds',()=>{
    const f=fixture(),r=f.read();expect(r.verdict).toBe('pass');expect(r.completeSourceCount).toBe(16);
    expect(r.requirements).toHaveLength(17);expect(r.integrity).toHaveLength(8);expect(r.requirements.every(x=>x.coverage==='complete')).toBeTrue();
    expect(r.integrity.every(x=>x.coverage==='complete')).toBeTrue();expect('qualifiesMinimum' in r).toBeFalse();expect(f.read().digest).toBe(r.digest);
});
test('each required family is mandatory even if every remaining source reports complete',()=>{
    for(let index=0;index<16;index++){const f=fixture(),missing=f.proofs.splice(index,1)[0]!,r=f.read();
        expect(r.verdict).toBe('inconclusive');expect(r.completeSourceCount).toBe(15);expect(r.rows.find(x=>x.sourceId===missing.sourceId)!.status).toBe('unavailable');}
});
test('warmup cannot be replaced by complete evaluation, adjacent certified intervals join but one millisecond of missing history does not',()=>{
    const f=fixture(),p=f.proofs.find(p=>p.sourceId==='physiology-modes')!;
    p.intervals=[{from:f.frame.fromSimulationTime,to:f.frame.toSimulationTime}];expect(f.read().verdict).toBe('inconclusive');
    p.intervals=[{from:f.frame.genesisAppliedAtSimulationTime,to:f.frame.fromSimulationTime},{from:f.frame.fromSimulationTime,to:f.frame.toSimulationTime}];expect(f.read().verdict).toBe('pass');
    p.intervals[1]!.from=iso(Date.parse(f.frame.fromSimulationTime)+1);expect(f.read().verdict).toBe('inconclusive');
});
test('boundary coverage requires warmup, exact evaluation boundaries and maximum trace-gap density',()=>{
    const f=fixture(),p=f.proofs.find(p=>p.sourceId==='frozen-physical-boundaries')!,original=p.boundaryTimes!;
    for(const times of [[original[0]!,original.at(-1)!],original.slice(24),original.filter((_,i)=>i!==70),[...original.slice(0,50),original[49]!,...original.slice(50)]]){
        p.boundaryTimes=times;expect(f.read().verdict).toBe('inconclusive');}
    p.boundaryTimes=original;expect(f.read().verdict).toBe('pass');
});
test('head, evidence, cohort, opening and binding failures never become completeness; gaps are not zero demand or minimum FAIL',()=>{
    const mutations:Array<(p:MinimumSourceCoverageProof)=>void>=[p=>{p.headDigest=null;},p=>{p.evidenceDigests=[];},p=>{p.evidenceDigests=['private'];},
        p=>{p.actorAgentIds=p.actorAgentIds.slice(1);},p=>{p.actorAgentIds=[...p.actorAgentIds,p.actorAgentIds[0]!];},p=>{p.bindingDigest='f'.repeat(64);},
        p=>{p.gaps=['missing-source-head'];},p=>{p.status='partial';},p=>{p.openingAt=iso(start+1);},p=>{p.evidenceDigests=null as any;}];
    for(const mutate of mutations){const f=fixture();mutate(f.proofs[0]!);const r=f.read();expect(r.verdict).toBe('inconclusive');expect(r.rows[0]!.status).not.toBe('complete');expect(JSON.stringify(r)).not.toContain('private');}
});
test('duplicate and foreign families, altered contract/frame and malformed private frames fail closed without echoing payloads',()=>{
    const f=fixture();f.proofs[1]=f.proofs[0]!;expect(f.read().verdict).toBe('inconclusive');
    const g=fixture();g.proofs[0]!.sourceId='private-foreign';const r=g.read();expect(r.verdict).toBe('inconclusive');expect(JSON.stringify(r)).not.toContain('private-foreign');
    const h=fixture();h.frame.contractDigest='e'.repeat(64);expect(h.read().bindingStatus).toBe('invalid');
    h.frame.genesisAppliedAtSimulationTime='PRIVATE SOURCE';expect(JSON.stringify(h.read())).not.toContain('PRIVATE SOURCE');
});
