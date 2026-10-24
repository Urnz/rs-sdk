import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { outcomeCheck as check,outcomeCount as count,outcomeTime as time } from './outcome-work.js';

export interface OutcomeWallWindow {from:string;to:string}
export interface OutcomeQueueRow {request_id:string;agent_id:string;enqueued_at:string;completed_at:string|null;status:string}
interface AuditRow {runId:string;agentId:string;timestamp:string;type:string;provider:string;model:string;data?:Record<string,unknown>}
/** Audit-reported usage, never a token-price estimate. The wall window is independent of simulation time. */
export function providerOutcomes(text:string,queue:OutcomeQueueRow[]|null,actors:readonly string[],window:OutcomeWallWindow){
    const from=time(window.from),to=time(window.to);check(from<to,'Invalid provider wall window');
    check(text.length<=32*1024*1024&&(!text||text.endsWith('\n')),'Truncated or oversized provider audit');
    const lines=text.trim()?text.trim().split('\n'):[];check(lines.length<=100000,'Provider audit exceeds row limit');
    const grouped=new Map<string,AuditRow[]>(),seen=new Set<string>();
    for(const line of lines){const e=JSON.parse(line) as AuditRow;
        check(e&&typeof e.runId==='string'&&typeof e.agentId==='string'&&typeof e.type==='string'
            &&typeof e.provider==='string'&&typeof e.model==='string','Invalid provider audit event');time(e.timestamp);
        if(!actors.includes(e.agentId))continue;
        const key=digest(e);if(seen.has(key))continue;seen.add(key);
        const entries=grouped.get(e.runId)??[];check(entries.every(r=>r.agentId===e.agentId),'Provider run has multiple owners');
        entries.push(e);grouped.set(e.runId,entries);
    }
    const runs=[...grouped].flatMap(([runId,events])=>{
        const requests=events.filter(e=>e.type==='model.requested'),responses=events.filter(e=>e.type==='model.responded'),starts=events.filter(e=>e.type==='run.started');
        const anchors=requests.length?requests:starts.length?starts:responses.length?responses:events;
        const anchor=anchors.find(e=>time(e.timestamp)>from&&time(e.timestamp)<=to);if(!anchor)return[];
        const request=requests.length===1?requests[0]:null,response=responses.length===1?responses[0]:null;
        const matching=response&&request&&response.provider===request.provider&&response.model===request.model
            &&time(response.timestamp)>=time(request.timestamp)&&time(response.timestamp)<=to;
        const usage=(field:string)=>matching&&response?.data?.[field]!==undefined?count(response.data[field]):null;
        const claims=queue?.filter(q=>q.request_id===runId)??[],claim=claims.length===1?claims[0]:null;
        if(claim)check(claim.agent_id===anchor.agentId,'Queue/audit actor differs');
        const start=starts.length===1?starts[0]:null;
        const elapsed=(a:string|undefined|null,b:string|undefined|null)=>a&&b&&time(b)>=time(a)&&time(b)<=to?time(b)-time(a):null;
        return[{runId,agentId:anchor.agentId,provider:anchor.provider,model:anchor.model,requestedAt:request?.timestamp??null,
            respondedAt:matching?response!.timestamp:null,requestCount:requests.length,responseCount:responses.length,
            requestCountInWallWindow:requests.filter(e=>time(e.timestamp)>from&&time(e.timestamp)<=to).length,
            admissionToRunStartWallMs:claim&&start?elapsed(claim.enqueued_at,start.timestamp):null,
            admissionToCompletionWallMs:claim?elapsed(claim.enqueued_at,claim.completed_at):null,
            providerStageElapsedWallMs:matching?elapsed(request!.timestamp,response!.timestamp):null,providerActiveServiceWallMs:null,
            inputTokens:usage('inputTokens'),outputTokens:usage('outputTokens'),costMicros:usage('costMicros'),
            evidenceDigests:events.map(e=>digest(e)),status:matching?'audit-response-observed':'inconclusive'}];
    });
    const unmatchedAdmissions=queue?.filter(q=>actors.includes(q.agent_id)&&time(q.enqueued_at)>from&&time(q.enqueued_at)<=to
        &&!runs.some(r=>r.runId===q.request_id)).map(q=>({runId:q.request_id,agentId:q.agent_id,enqueuedAt:q.enqueued_at,queueStatusAtSourceHead:q.status}))??[];
    const total=(key:'inputTokens'|'outputTokens'|'costMicros')=>({observedSubtotal:String(runs.reduce((n,r)=>n+BigInt(r[key]??0),0n)),
        allSelectedRecordedRunsKnown:runs.length>0&&!unmatchedAdmissions.length&&runs.every(r=>r[key]!==null),
        total:runs.length>0&&!unmatchedAdmissions.length&&runs.every(r=>r[key]!==null)?String(runs.reduce((n,r)=>n+BigInt(r[key]!),0n)):null});
    return{wallWindow:window,runs,unmatchedAdmissions,observedModelRequestEvents:runs.reduce((n,r)=>n+r.requestCountInWallWindow,0),
        usage:{inputTokens:total('inputTokens'),outputTokens:total('outputTokens'),costMicros:total('costMicros')},
        completeWorldAuditCoverage:false,queueSource:queue===null?'unavailable':'available',
        limitations:['Audit JSONL has no externally anchored completeness proof; missing runs/tail cannot be inferred.',
            'Admission includes queue overhead; provider stage includes retry/backoff. Active service is unknown.',
            'Usage is provider-audit-reported, not independently billed usage. No wall-to-simulation conversion.']};
}
