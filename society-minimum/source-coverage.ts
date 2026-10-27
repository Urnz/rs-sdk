import {minimumAssessmentLayout,type MinimumFrame} from './assessment.js';
import type {SocietyMinimumContract} from './contract.js';
import {minimumSourceInventory} from './source-inventory.js';
import {societyMinimumDigest as digest} from './policy.js';

/** Internal reader output, never a request/upload schema. Digests identify evidence; they do not authenticate caller claims. */
export interface MinimumSourceCoverageProof {
    sourceId:string;bindingDigest:string;status:'complete'|'partial'|'unavailable'|'invalid';
    headDigest:string|null;evidenceDigests:string[];actorAgentIds:string[];
    intervals:Array<{from:string;to:string}>;openingAt?:string;boundaryTimes?:string[];gaps:string[];
}
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function time(v:string){const n=Date.parse(v);if(!Number.isSafeInteger(n)||new Date(n).toISOString()!==v)throw Error('Invalid coverage time');return n;}
export function minimumCoverageBinding(frame:MinimumFrame){return digest({contractDigest:frame.contractDigest,worldId:frame.worldId,
    clockId:frame.clockId,clockProfileDigest:frame.clockProfileDigest,founderAgentIds:[...frame.founderAgentIds].sort(),
    genesisAppliedAtSimulationTime:frame.genesisAppliedAtSimulationTime,fromSimulationTime:frame.fromSimulationTime,toSimulationTime:frame.toSimulationTime});}
function covers(intervals:MinimumSourceCoverageProof['intervals'],from:number,to:number){
    const sorted=intervals.map(i=>({from:time(i.from),to:time(i.to)})).sort((a,b)=>a.from-b.from||a.to-b.to);
    if(sorted.some(i=>i.from<from||i.to>to||i.to<=i.from))throw Error('Foreign coverage interval');
    let end=from;for(const i of sorted){if(i.from>end)return false;end=Math.max(end,i.to);}return end===to;
}
/** Definition-owned AND over every family. Missing history is unknown, not evidence of a minimum violation or zero demand. */
export function assessMinimumSourceCoverage(contract:SocietyMinimumContract,frame:MinimumFrame,proofs:MinimumSourceCoverageProof[]){
    const inventory=minimumSourceInventory(contract);let frameValid=false,bindingDigest:string|null=null;
    try{minimumAssessmentLayout(contract,frame);bindingDigest=minimumCoverageBinding(frame);frameValid=true;}catch{/* No private malformed frame echoed. */}
    const unexpected=proofs.length>inventory.definitions.length||new Set(proofs.map(p=>p.sourceId)).size!==proofs.length
        ||proofs.some(p=>!inventory.definitions.some(d=>d.id===p.sourceId));
    const rows=inventory.definitions.map(definition=>{
        const proof=proofs.find(p=>p.sourceId===definition.id),gaps:string[]=[];
        let status:'complete'|'partial'|'unavailable'|'invalid'=proof?.status??'unavailable';
        const evidenceDigests=Array.isArray(proof?.evidenceDigests)?proof.evidenceDigests.slice(0,256).filter(hex):[],headDigest=hex(proof?.headDigest)?proof!.headDigest:null;
        if(!frameValid||unexpected){status='invalid';gaps.push(frameValid?'duplicate-or-foreign-family':'invalid-minimum-frame');}
        else if(!proof)gaps.push('source-not-observed');
        else try{
            if(!['complete','partial','unavailable','invalid'].includes(proof.status)||proof.bindingDigest!==bindingDigest
                ||!Array.isArray(proof.intervals)||!Array.isArray(proof.evidenceDigests)||!Array.isArray(proof.gaps)||!Array.isArray(proof.actorAgentIds)
                ||proof.intervals.length>10000||proof.evidenceDigests.length>256||proof.gaps.length>128
                ||proof.gaps.some(g=>typeof g!=='string'||!/^[a-z0-9][a-z0-9-]{0,95}$/.test(g))
                ||new Set(proof.actorAgentIds).size!==proof.actorAgentIds.length
                ||digest([...proof.actorAgentIds].sort())!==digest([...frame.founderAgentIds].sort()))throw Error('Coverage binding differs');
            gaps.push(...proof.gaps);
            if(proof.status==='complete'){
                if(!headDigest||!evidenceDigests.length||evidenceDigests.length!==proof.evidenceDigests.length
                    ||new Set(evidenceDigests).size!==evidenceDigests.length)throw Error('Coverage needs bound native heads');
                if(definition.span==='applied-opening'){
                    if(proof.openingAt!==frame.genesisAppliedAtSimulationTime)gaps.push('applied-opening-not-covered');
                }else if(!covers(proof.intervals,time(frame.genesisAppliedAtSimulationTime),time(frame.toSimulationTime)))gaps.push('warmup-or-evaluation-gap');
                if(definition.span==='every-native-boundary'){
                    const points=proof.boundaryTimes??[];if(points.length>10000)throw Error('Boundary budget exceeded');const times=points.map(time);
                    if(times[0]!==time(frame.genesisAppliedAtSimulationTime)||times.at(-1)!==time(frame.toSimulationTime)
                        ||times.some((n,i)=>i>0&&(n<=times[i-1]!||n-times[i-1]!>contract.policy.window.maximumTraceGapSimulationMilliseconds))
                        ||![frame.fromSimulationTime,...frame.boundaries?.times??[]].every(t=>points.includes(t)))gaps.push('native-boundary-inventory-gap');
                }
                if(gaps.length)status='partial';
            }else if(!gaps.length)gaps.push(status==='partial'?'source-history-partial':`source-${status}`);
        }catch{status='invalid';gaps.splice(0,gaps.length,'source-proof-invalid');}
        return{sourceId:definition.id,span:definition.span,status,headDigest,evidenceDigests,
            requiredFrom:frameValid?frame.genesisAppliedAtSimulationTime:null,requiredTo:frameValid?(definition.span==='applied-opening'?frame.genesisAppliedAtSimulationTime:frame.toSimulationTime):null,
            certifiedIntervals:status==='complete'&&definition.span!=='applied-opening'?proof!.intervals:[],
            certifiedOpeningAt:status==='complete'&&definition.span==='applied-opening'?proof!.openingAt:null,gaps:[...new Set(gaps)].sort()};
    });
    const complete=(ids:string[])=>ids.every(id=>rows.find(r=>r.sourceId===id)?.status==='complete');
    const body={protocol:'society-minimum-source-coverage-v1',contractDigest:contract.digest,inventoryDigest:inventory.digest,bindingDigest,
        bindingStatus:frameValid?'bound':'invalid',rows,completeSourceCount:rows.filter(r=>r.status==='complete').length,
        requirements:inventory.requirements.map(r=>({...r,coverage:complete(r.sourceIds)?'complete':'inconclusive'})),
        integrity:inventory.integrity.map(r=>({...r,coverage:complete(r.sourceIds)?'complete':'inconclusive'})),
        verdict:frameValid&&!unexpected&&complete(inventory.definitions.map(d=>d.id))?'pass' as const:'inconclusive' as const,
        meaning:'Reader-bound complete warmup/evaluation source history, separate from passing numerical minimum thresholds or other integrity gates.'};
    return{...body,digest:digest(body)};
}
