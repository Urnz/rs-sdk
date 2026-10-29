import { expect,test } from 'bun:test';
import { join } from 'node:path';
import { loadSocietyMinimumContract } from '../contract.js';
import { assessSocietyMinimum,minimumAssessmentLayout,type MinimumCell,type MinimumFrame,type MinimumGate } from '../assessment.js';
const contract=loadSocietyMinimumContract(join(import.meta.dir,'../../config')),day=86400000,start=Date.UTC(2001,0,2);
function fixture(){
    const frame:MinimumFrame={contractDigest:contract.digest,worldId:'fixture-world',clockId:'clock',clockProfileDigest:'a'.repeat(64),
        founderAgentIds:['alice','bob','carol','dave'],genesisAppliedAtSimulationTime:new Date(start-day).toISOString(),fromSimulationTime:new Date(start).toISOString(),
        toSimulationTime:new Date(start+7*day).toISOString(),boundaries:{times:Array.from({length:169},(_,i)=>new Date(start+i*3600000).toISOString()),sourceDigest:'b'.repeat(64),complete:true}};
    const cells:MinimumCell[]=minimumAssessmentLayout(contract,frame).flatMap(({requirement,subjects})=>subjects.map(subject=>({requirementId:requirement.requirementId,
        subject,opportunity:'positive' as const,lower:{numerator:String(requirement.threshold),denominator:'1'},upper:{numerator:String(requirement.threshold),denominator:'1'},evidenceDigests:['c'.repeat(64)]})));
    const gates:MinimumGate[]=contract.policy.integrityGates.map(gateId=>({gateId,verdict:'pass',evidenceDigests:['d'.repeat(64)]}));
    return{frame,cells,gates,read:()=>assessSocietyMinimum(contract,frame,cells,gates)};
}
test('calculation covers all17 original quantifiers and8 gates at unchanged thresholds; this is not native run evidence',()=>{
    const f=fixture(),r=f.read();expect(r.requirements).toHaveLength(17);expect(r.integrity).toHaveLength(8);expect(r.verdict).toBe('pass');
    expect(r.requirements.find(v=>v.requirementId==='hunger-satisfied-time')!.cells).toHaveLength(28);
    expect(r.requirements.find(v=>v.requirementId==='minimum-living-founders')!.cells).toHaveLength(169);
});
test('one missing founder/day cannot be hidden by other buckets or a population average',()=>{
    const f=fixture();f.cells.splice(f.cells.findIndex(c=>c.requirementId==='legal-housing-access-time'&&c.subject.actorAgentId==='dave'&&c.subject.bucket===6),1);
    expect(f.read().verdict).toBe('inconclusive');const c=f.cells.find(c=>c.requirementId==='hunger-satisfied-time'&&c.subject.actorAgentId==='alice'&&c.subject.bucket===0)!;
    c.upper=c.lower={numerator:'9499',denominator:'1'};expect(f.read().verdict).toBe('fail');
});
test('a reduced roster cannot borrow the original founder count; a genuinely small cohort fails the original minimum',()=>{
    const f=fixture();f.frame.founderAgentIds=f.frame.founderAgentIds.slice(0,3);
    const cells=f.cells.filter(c=>c.subject.actorAgentId!=='dave');
    expect(()=>assessSocietyMinimum(contract,f.frame,cells,f.gates)).toThrow('founder count');
    const opening=cells.find(c=>c.requirementId==='founders-at-start')!;opening.lower=opening.upper={numerator:'3',denominator:'1'};
    expect(assessSocietyMinimum(contract,f.frame,cells,f.gates).verdict).toBe('fail');
});
test('directional bounds only prove the side they support; incomplete requests cannot prove a short maximum',()=>{
    const f=fixture(),tool=f.cells.find(c=>c.requirementId==='tool-unusable-demand-time')!;
    delete tool.upper;tool.lower={numerator:'1200000',denominator:'1'};expect(f.read().verdict).toBe('inconclusive');
    tool.lower={numerator:'3600001',denominator:'1'};f.gates.splice(0);expect(f.read().verdict).toBe('fail');
    const g=fixture(),count=g.cells.find(c=>c.requirementId==='productive-participants')!;delete count.upper;expect(g.read().verdict).toBe('pass');
    count.lower={numerator:'1',denominator:'1'};expect(g.read().verdict).toBe('inconclusive');
});
test('exact rational comparison avoids rounding a forbidden excess down to the allowed threshold',()=>{
    const f=fixture(),tool=f.cells.find(c=>c.requirementId==='tool-unusable-demand-time')!;
    tool.lower=tool.upper={numerator:'7200001',denominator:'2'};expect(f.read().verdict).toBe('fail');
    const g=fixture(),share=g.cells.find(c=>c.requirementId==='hunger-satisfied-time')!;
    share.lower=share.upper={numerator:'18999',denominator:'2'};expect(g.read().verdict).toBe('fail');
});
test('zero or unknown opportunity is inconclusive, while measured zero under positive exposure can prove failure',()=>{
    const f=fixture(),c=f.cells.find(c=>c.requirementId==='productive-participants')!;c.opportunity='zero';expect(f.read().verdict).toBe('inconclusive');
    c.opportunity='unknown';expect(f.read().verdict).toBe('inconclusive');c.opportunity='positive';c.lower=c.upper={numerator:'0',denominator:'1'};
    expect(f.read().verdict).toBe('fail');c.lower={numerator:'0',denominator:'0'};expect(f.read).toThrow('denominator');
});
test('missing gate cannot qualify, gate failure survives missing cells and unknown sources',()=>{
    const f=fixture();f.gates.pop();expect(f.read().verdict).toBe('inconclusive');f.cells.splice(0);f.gates[0]!.verdict='fail';expect(f.read().verdict).toBe('fail');
});
test('clock, window, warmup, roster, original contract digest and cell budget are enforced before assessment',()=>{
    const f=fixture();
    for(const frame of [{...f.frame,contractDigest:'e'.repeat(64)},{...f.frame,toSimulationTime:new Date(start+day).toISOString()},
        {...f.frame,genesisAppliedAtSimulationTime:f.frame.fromSimulationTime},{...f.frame,founderAgentIds:['alice','alice']},
        {...f.frame,clockProfileDigest:'bad'}])expect(()=>assessSocietyMinimum(contract,frame,f.cells,f.gates)).toThrow();
});
test('sparse or uncertified boundary inventories cannot certify all-observation-boundaries, but retain observed failures',()=>{
    const f=fixture();f.frame.boundaries!.complete=false;expect(f.read().verdict).toBe('inconclusive');
    const cell=f.cells.find(c=>c.requirementId==='food-reserve-coverage')!;cell.lower=cell.upper={numerator:'0',denominator:'1'};expect(f.read().verdict).toBe('fail');
    const g=fixture();g.frame.boundaries!.times=[g.frame.fromSimulationTime,g.frame.toSimulationTime];
    const cells=g.cells.filter(c=>!c.subject.boundary||g.frame.boundaries!.times.includes(c.subject.boundary));
    expect(assessSocietyMinimum(contract,g.frame,cells,g.gates).verdict).toBe('inconclusive');
});
test('duplicates, foreign actors/buckets/cycles and contradictory rational bounds cannot enter the quantifier matrix',()=>{
    const f=fixture();expect(()=>assessSocietyMinimum(contract,f.frame,[...f.cells,f.cells[0]!],f.gates)).toThrow('duplicated');
    for(const subject of [{actorAgentId:'intruder',bucket:0},{actorAgentId:'alice',bucket:7},{cycleId:'foreign-cycle'}])
        expect(()=>assessSocietyMinimum(contract,f.frame,[{...f.cells[0]!,subject}],f.gates)).toThrow('scope');
    f.cells[0]!.lower={numerator:'5',denominator:'1'};f.cells[0]!.upper={numerator:'4',denominator:'1'};expect(f.read).toThrow('Contradictory');
});

test('population boundaries certify living counts independently of incomplete physical reserve boundaries',()=>{
    const f=fixture();f.frame.populationBoundaries={...f.frame.boundaries!};f.frame.boundaries!.complete=false;
    const r=f.read();expect(r.requirements.find(v=>v.requirementId==='minimum-living-founders')!.verdict).toBe('pass');
    expect(r.requirements.find(v=>v.requirementId==='food-reserve-coverage')!.verdict).toBe('inconclusive');expect(r.verdict).toBe('inconclusive');
    f.frame.populationBoundaries.complete=false;
    expect(f.read().requirements.find(v=>v.requirementId==='minimum-living-founders')!.verdict).toBe('inconclusive');
});

test('independent population schedules still require ordered exact endpoints, density, evidence and bounded size',()=>{
    const f=fixture(),times=f.frame.boundaries!.times;
    for(const points of [[times[0]!,times[0]!,...times.slice(1)],times.slice(1),[...times].reverse(),Array(10001).fill(times[0]!)]){
        f.frame.populationBoundaries={times:points,complete:true,sourceDigest:'a'.repeat(64)};expect(f.read).toThrow();
    }
    f.frame.populationBoundaries={times,complete:true,sourceDigest:'bad'};
    expect(f.read().requirements.find(v=>v.requirementId==='minimum-living-founders')!.verdict).toBe('inconclusive');
    const points=[times[0]!,times.at(-1)!];f.frame.populationBoundaries={times:points,complete:true,sourceDigest:'a'.repeat(64)};
    const cells=f.cells.filter(c=>c.requirementId!=='minimum-living-founders'||points.includes(c.subject.boundary!));
    const r=assessSocietyMinimum(contract,f.frame,cells,f.gates);
    expect(r.requirements.find(v=>v.requirementId==='minimum-living-founders')!.verdict).toBe('inconclusive');
    expect(r.requirements.find(v=>v.requirementId==='food-reserve-coverage')!.verdict).toBe('pass');
});
