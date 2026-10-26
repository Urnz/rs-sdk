import { assertSocietyMinimumContractBinding,type SocietyMinimumContract } from './contract.js';
import { societyMinimumDigest as digest,type SocietyMinimumRequirement } from './policy.js';
export type MinimumVerdict='pass'|'fail'|'inconclusive';
export interface MinimumFrame {
    contractDigest:string;worldId:string;clockId:string;clockProfileDigest:string;founderAgentIds:string[];
    genesisAppliedAtSimulationTime:string;fromSimulationTime:string;toSimulationTime:string;
    /** Backend-owned complete native boundary inventory, not a sample count or caller receipt. */
    boundaries?:{times:string[];sourceDigest:string;complete:boolean};
}
export interface MinimumSubject {actorAgentId?:string;cycleId?:string;bucket?:number;boundary?:string}
export interface MinimumFraction {numerator:string;denominator:string}
export interface MinimumCell {
    requirementId:string;subject:MinimumSubject;opportunity:'positive'|'zero'|'unknown';
    lower?:MinimumFraction;upper?:MinimumFraction;evidenceDigests:string[];
}
export interface MinimumGate {gateId:string;verdict:MinimumVerdict;evidenceDigests:string[]}
const check=(v:unknown,m:string)=>{if(!v)throw Error(m);};
const time=(s:string)=>{check(typeof s==='string'&&Number.isFinite(Date.parse(s)),'Invalid minimum timestamp');return Date.parse(s);};
const hex=(s:string)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const key=(id:string,s:MinimumSubject)=>digest({id,subject:s});
function fraction(f:MinimumFraction){
    check(f&&Object.keys(f).sort().join(',')==='denominator,numerator'&&/^\d{1,40}$/.test(f.numerator)&&/^\d{1,40}$/.test(f.denominator),'Invalid minimum rational');
    const n=BigInt(f.numerator),d=BigInt(f.denominator);check(d>0n,'Zero minimum denominator is not evidence');return{n,d};
}
function cellVerdict(r:SocietyMinimumRequirement,c:MinimumCell|undefined):MinimumVerdict{
    if(!c||c.opportunity!=='positive')return'inconclusive';
    const l=c.lower?fraction(c.lower):null,u=c.upper?fraction(c.upper):null,t=BigInt(r.threshold);
    if(r.comparison==='at-least')return l&&l.n>=t*l.d?'pass':u&&u.n<t*u.d?'fail':'inconclusive';
    return l&&l.n>t*l.d?'fail':u&&u.n<=t*u.d?'pass':'inconclusive';
}
/** Pure internal calculation. Digests identify evidence; this function does not authenticate uploaded data. */
export function minimumAssessmentLayout(contract:SocietyMinimumContract,frame:MinimumFrame){
    assertSocietyMinimumContractBinding(frame.contractDigest,contract);
    const p=contract.policy,from=time(frame.fromSimulationTime),to=time(frame.toSimulationTime);
    check(typeof frame.worldId==='string'&&frame.worldId.length>0&&frame.worldId.length<=256&&typeof frame.clockId==='string'&&frame.clockId.length>0
        &&hex(frame.clockProfileDigest),'Invalid minimum world/clock');
    check(to-from===p.window.evaluationSimulationMilliseconds&&from-time(frame.genesisAppliedAtSimulationTime)===p.window.warmupSimulationMilliseconds,
        'Minimum requires its original warmup and complete evaluation window');
    const actors=frame.founderAgentIds;
    check(Array.isArray(actors)&&actors.length>0&&actors.length<=1000&&new Set(actors).size===actors.length
        &&actors.every(a=>typeof a==='string'&&/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(a)),'Invalid frozen minimum founder roster');
    const buckets=p.window.evaluationSimulationMilliseconds/p.window.bucketSimulationMilliseconds;
    const boundaries=frame.boundaries?.times??[frame.fromSimulationTime,frame.toSimulationTime];
    check(buckets<=10000&&boundaries.length>=2&&boundaries.length<=10000
        &&time(boundaries[0]!)===from&&time(boundaries.at(-1)!)===to,'Invalid minimum boundary inventory');
    const points=boundaries.map(time);check(points.every((v,i)=>!i||v>points[i-1]!),'Minimum boundaries must be ordered and unique');
    const boundaryComplete=frame.boundaries?.complete===true&&hex(frame.boundaries.sourceDigest)
        &&points.every((v,i)=>!i||v-points[i-1]!<=p.window.maximumTraceGapSimulationMilliseconds);
    const estimate=actors.length*buckets*3+actors.length*2+boundaries.length*2+buckets*4+p.tools.cycleIds.length*2+5;
    check(estimate<=50000,'Minimum assessment exceeds scoped cell budget');
    return contract.requirements.map(requirement=>{
        const subjects:MinimumSubject[]=[];
        switch(requirement.scope){
            case'opening-boundary':subjects.push({boundary:frame.fromSimulationTime});break;
            case'closing-boundary':subjects.push({boundary:frame.toSimulationTime});break;
            case'all-observation-boundaries':subjects.push(...boundaries.map(boundary=>({boundary})));break;
            case'every-member-every-bucket':for(const actorAgentId of actors)for(let bucket=0;bucket<buckets;bucket++)subjects.push({actorAgentId,bucket});break;
            case'every-bucket':for(let bucket=0;bucket<buckets;bucket++)subjects.push({bucket});break;
            case'every-member-whole-window':subjects.push(...actors.map(actorAgentId=>({actorAgentId})));break;
            case'every-tool-type-whole-window':subjects.push(...p.tools.cycleIds.map(cycleId=>({cycleId})));break;
            case'whole-window':subjects.push({});break;
        }
        return{requirement,subjects,boundaryComplete:requirement.scope==='all-observation-boundaries'?boundaryComplete:true};
    });
}
export function assessSocietyMinimum(contract:SocietyMinimumContract,frame:MinimumFrame,cells:MinimumCell[],gates:MinimumGate[]){
    const layout=minimumAssessmentLayout(contract,frame),expected=new Set(layout.flatMap(r=>r.subjects.map(s=>key(r.requirement.requirementId,s))));
    check(cells.length<=50000&&gates.length<=contract.policy.integrityGates.length,'Minimum evidence budget exceeded');
    const byCell=new Map<string,MinimumCell>(),byGate=new Map<string,MinimumGate>();
    const evidence=(values:string[])=>check(Array.isArray(values)&&values.length>0&&values.length<=256&&values.every(hex)
        &&new Set(values).size===values.length,'Minimum observation needs source evidence');
    for(const cell of cells){
        const k=key(cell.requirementId,cell.subject);check(expected.has(k)&&!byCell.has(k),'Minimum observation scope is foreign or duplicated');
        check(['positive','zero','unknown'].includes(cell.opportunity),'Invalid minimum opportunity');evidence(cell.evidenceDigests);
        const l=cell.lower?fraction(cell.lower):null,u=cell.upper?fraction(cell.upper):null;
        check((l||u)&&(!l||!u||l.n*u.d<=u.n*l.d),'Contradictory or missing minimum bounds');
        if(cell.requirementId==='founders-at-start'&&cell.opportunity==='positive'){
            const actual=BigInt(frame.founderAgentIds.length);
            check((!l||l.n<=actual*l.d)&&(!u||u.n>=actual*u.d),'Opening founder count contradicts the frozen assessment roster');
        }
        byCell.set(k,cell);
    }
    for(const gate of gates){check(contract.policy.integrityGates.includes(gate.gateId as typeof contract.policy.integrityGates[number])&&!byGate.has(gate.gateId)
        &&['pass','fail','inconclusive'].includes(gate.verdict),'Foreign or duplicated minimum integrity gate');evidence(gate.evidenceDigests);byGate.set(gate.gateId,gate);}
    const requirements=layout.map(({requirement,subjects,boundaryComplete})=>{
        const results=subjects.map(subject=>{const c=byCell.get(key(requirement.requirementId,subject));return{subject,
            verdict:cellVerdict(requirement,c),lower:c?.lower??null,upper:c?.upper??null,opportunity:c?.opportunity??'unknown',evidenceDigests:c?.evidenceDigests??[]};});
        const verdict:MinimumVerdict=results.some(r=>r.verdict==='fail')?'fail':boundaryComplete&&results.every(r=>r.verdict==='pass')?'pass':'inconclusive';
        return{...requirement,verdict,boundaryComplete,cells:results};
    });
    const integrity=contract.policy.integrityGates.map(gateId=>({gateId,verdict:byGate.get(gateId)?.verdict??'inconclusive' as MinimumVerdict,
        evidenceDigests:byGate.get(gateId)?.evidenceDigests??[]}));
    const verdict:MinimumVerdict=[...requirements,...integrity].some(r=>r.verdict==='fail')?'fail':
        [...requirements,...integrity].every(r=>r.verdict==='pass')?'pass':'inconclusive';
    const body={protocol:'society-minimum-assessment-v1',frame,contractDigest:contract.digest,requirements,integrity,verdict,
        evidenceAuthority:'internal-calculation-from-verified-source-adapters',qualifiesMinimum:verdict==='pass'};
    return{...body,digest:digest(body)};
}
