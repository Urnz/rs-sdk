import {object,hash,time,digest} from '../external-trade/policy.js';
import {check} from '../external-trade/source.js';
import {xpCohort,validateXpStateSnapshot,type XpStateSnapshot} from './xp-state.js';
export interface XpExecutionArmRequest {experimentId:string;definitionDigest:string;cohort:string[];expectedCohortDigest:string;expectedPolicyDigest:string}
interface PolicyMod {enabled:boolean;version:string;dataSchemaVersion:number;config:Record<string,boolean|number|string>}
const policyMod=(mod:PolicyMod)=>({enabled:mod.enabled,version:mod.version,dataSchemaVersion:mod.dataSchemaVersion,config:mod.config});
export const xpExecutionPolicyDigest=(mod:PolicyMod,calibration:PolicyMod|null=null)=>
    digest({diminishing:policyMod(mod),calibration:calibration?policyMod(calibration):null});
export function validateXpExecutionArm(raw:unknown):XpExecutionArmRequest{
    const v=object(raw,['experimentId','definitionDigest','cohort','expectedCohortDigest','expectedPolicyDigest']);
    check(typeof v.experimentId==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.experimentId),'Invalid XP experiment identity');
    return {experimentId:v.experimentId,definitionDigest:hash(v.definitionDigest),cohort:xpCohort(v.cohort),
        expectedCohortDigest:hash(v.expectedCohortDigest),expectedPolicyDigest:hash(v.expectedPolicyDigest)};
}
export interface XpExecutionBinding {request:XpExecutionArmRequest;snapshot:XpStateSnapshot;policyDigest:string}
export interface XpExecutionEvent {
    kind:'armed'|'pending'|'observed'|'rejected'|'sealed';at:string;player?:string;
    before?:XpStateSnapshot;after?:XpStateSnapshot;policyDigest?:string;
    skill?:string;context?:{script:string;targetKind:'loc'|'npc'|'obj'|'none';targetId:number|null;x:number;z:number;level:number};
    inputXp?:number;outputXp?:number;error?:string;
}
export interface XpExecutionEntry {sequence:number;payload:XpExecutionEvent;previousHash:string;hash:string}
export const xpExecutionEntryHash=(id:string,entry:Omit<XpExecutionEntry,'hash'>)=>digest({experimentId:id,...entry});
export function buildXpExecutionReport(binding:XpExecutionBinding,entries:XpExecutionEntry[],sequence:number,headHash:string){
    object(binding,['request','snapshot','policyDigest']);const request=validateXpExecutionArm(binding.request);
    const baseline=validateXpStateSnapshot(binding.snapshot,request.cohort);hash(binding.policyDigest);
    check(baseline.cohortDigest===request.expectedCohortDigest && binding.policyDigest===request.expectedPolicyDigest,'XP execution arm binding differs');
    check(entries.length>0 && entries.length<=2+request.cohort.length*2 && entries.length===sequence,'XP execution tail differs');
    let head=digest(binding),sealed=false,last=baseline.observedAt;
    const members=request.cohort.map(username=>({username,status:'unobserved' as 'unobserved'|'pending'|'observed'|'rejected',
        pending:null as XpExecutionEvent|null,observation:null as XpExecutionEvent|null}));
    for(const [index,entry] of entries.entries()){
        object(entry,['sequence','payload','previousHash','hash']);
        const {hash:actual,...body}=entry,event=entry.payload;time(event.at);
        const fields=event.kind==='armed'||event.kind==='sealed'?['kind','at']:event.kind==='pending'
            ?['kind','at','player','before','policyDigest','skill','context','inputXp']:event.kind==='observed'?['kind','at','player','after','outputXp']:['kind','at','player','error'];
        object(event,fields);
        check(entry.sequence===index+1 && entry.previousHash===head && actual===xpExecutionEntryHash(request.experimentId,body)
            && Date.parse(event.at)>=Date.parse(last) && !sealed,'XP execution chain differs');
        if(index===0)check(event.kind==='armed' && event.at===baseline.observedAt,'XP execution lacks native arm');
        else if(event.kind==='sealed')sealed=true;
        else{
            const member=members.find(row=>row.username===event.player);check(member,'XP execution player differs');
            if(event.kind==='pending'){
                check(member.status==='unobserved' && event.before && event.policyDigest===binding.policyDigest,'Duplicate or unbound first XP calculation');
                const before=validateXpStateSnapshot(event.before,[member.username],baseline.configurationDigest);
                check(before.observedAt===event.at,'XP input observation time differs');
                check(digest(before.players[member.username])===digest(baseline.players[member.username]),'First XP input state differs');
                check(typeof event.skill==='string' && event.skill.length>0 && event.skill.length<=80 && event.context
                    && Number.isFinite(event.inputXp) && event.inputXp!>=0 && event.inputXp!<=Number.MAX_SAFE_INTEGER,'Invalid XP calculation input');
                const context=object(event.context,['script','targetKind','targetId','x','z','level']);
                check(typeof context.script==='string' && context.script.length<=512 && ['loc','npc','obj','none'].includes(context.targetKind)
                    && (context.targetId===null || Number.isSafeInteger(context.targetId) && context.targetId>=0 && context.targetId<=65535)
                    && [context.x,context.z].every(value=>Number.isSafeInteger(value)&&value>=0&&value<=16383)
                    && Number.isSafeInteger(context.level)&&context.level>=0&&context.level<=3,'Invalid native XP context');
                member.status='pending';member.pending=event;
            }else if(event.kind==='observed'){
                check(member.status==='pending' && event.after && Number.isFinite(event.outputXp) && event.outputXp!>=0 && event.outputXp!<=Number.MAX_SAFE_INTEGER,'Unbound XP calculation outcome');
                check(validateXpStateSnapshot(event.after,[member.username],baseline.configurationDigest).observedAt===event.at,'XP outcome observation time differs');
                member.status='observed';member.observation=event;
            }else{
                check(event.kind==='rejected' && ['unobserved','pending'].includes(member.status) && typeof event.error==='string' && event.error.length>0 && event.error.length<=1000,'Invalid XP execution transition');
                member.status='rejected';member.observation=event;
            }
        }
        last=event.at;head=actual;
    }
    check(head===headHash,'XP execution head differs');
    const report={schemaVersion:1 as const,artifactKind:'native-xp-first-calculation' as const,binding,entries,sequence,headHash,
        sealed,members,complete:sealed && members.every(row=>row.status==='observed'),
        attestsPlayerStatCommit:false as const,engineRandomStreamSeeded:false as const};
    return {...report,digest:digest(report)};
}
export type XpExecutionReport=ReturnType<typeof buildXpExecutionReport>;
export function validateXpExecutionReport(raw:unknown):XpExecutionReport{
    const v=object(raw,['schemaVersion','artifactKind','binding','entries','sequence','headHash','sealed','members','complete',
        'attestsPlayerStatCommit','engineRandomStreamSeeded','digest']);
    check(v.schemaVersion===1 && v.artifactKind==='native-xp-first-calculation' && Array.isArray(v.entries),'Unsupported XP execution report');
    const result=buildXpExecutionReport(v.binding,v.entries,v.sequence,v.headHash);
    check(result.digest===v.digest && digest(result)===digest(v),'XP execution report digest differs');return result;
}
export interface XpExecutionPort {arm(request:XpExecutionArmRequest):Promise<XpExecutionReport>;seal(id:string):Promise<XpExecutionReport>}
