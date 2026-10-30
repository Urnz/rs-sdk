import {readFileSync,realpathSync,statSync,existsSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import type {SkillRunResult} from '../../../agent-skills/types.js';
import {SkillRegistry} from '../../../agent-skills/registry.js';
import {resolveSkillParameters} from '../../../agent-skills/validation.js';
import {miningTrialAuthorization} from '../../../agent-skills/mining-trials.js';
import {miningDemandId,miningOperationAdmissionPath,readMiningOperationAdmission} from '../../../agent-skills/mining-admission.js';
import {readMiningDemandInvocation,miningOperationSealed,miningRequestDigest} from '../../../agent-skills/mining-demand-source.js';
import {readMiningInteractionSource} from '../../../agent-skills/mining-interaction-source.js';
import {validateMiningDemandRequest} from '../../../sdk/mining-demand.js';
import {NativeMiningDispatchStore} from '../../../item-lifecycle/native-mining-dispatch.js';
import {nativeToolDigest as hash} from '../../../item-lifecycle/native-tool.js';
import {readMiningDemandProof} from './native-mining-demand.js';
import {foodSkillCheckpointPath} from './native-food-skills.js';
import {populationNeedsOptions} from './needs-runtime.js';
import {assertNativeFoodPath,assertNativeFoodDomainPath} from '../../../food-loop/native-source.js';
import {OwnedDatabase} from '../../engine/src/io/OwnedDatabase.js';
import {readNativeToolMaintenance} from '../../../society-metrics/tool-maintenance.js';

const check=(value:unknown)=>{if(!value)throw Error('Native Mining skill evidence differs');};
interface MiningSkillEvidence {demandId:string;nativeActionId:string;receiptDigest:string;dispatchDigest:string;stepAdmissionDigest:string;mechanicalDigest:string}
function json(workspace:string,worldId:string,path:string){
    if(path.startsWith(join(workspace,'.local')))assertNativeFoodDomainPath({workspace,worldId,checkpointPath:path});
    const rel=relative(realpathSync(workspace),realpathSync(path));check(rel&&!rel.startsWith('..')&&!isAbsolute(rel)&&statSync(path).size<=1048576);
    return JSON.parse(readFileSync(path,'utf8'));
}

/** Historical readonly join. A progress/ACK event cannot substitute for the exact
 * executor admission, once-only dispatch, fulfilled intent and audited native use.
 * No source path or selected world is read from the submitted run. */
export function readMiningSkillRunEvidence(workspace:string,run:SkillRunResult,selected?:{worldId:string;checkpointPath:string}){
    check(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(run.runId)&&/^[a-z0-9]{1,12}$/.test(run.username??'')&&run.parameters&&run.events.length<=10000);
    const defaults=selected?null:populationNeedsOptions(workspace),options=selected??{worldId:defaults!.worldId,checkpointPath:foodSkillCheckpointPath(workspace,defaults!.worldId)};
    assertNativeFoodPath({workspace,...options});check(statSync(options.checkpointPath).size<=256*1024*1024);
    const db=new OwnedDatabase(options.checkpointPath,{readonly:true,strict:true});
    let result:MiningSkillEvidence[]=[];
    try{db.transaction(()=>{
        const dispatches=new NativeMiningDispatchStore(db),events=run.events.filter(e=>e.type==='step.succeeded'&&e.operation==='gather-loc');
        check(events.length>0);const ids=new Set<string>(),parametersDigest=hash(Object.entries(run.parameters!).sort(([a],[b])=>a.localeCompare(b)));
        result=events.map(event=>{
            const posted=event.data?.miningDemand as {request?:unknown;demandId?:string;nativeActionId?:string;receiptDigest?:string;state?:string}|undefined;
            const request=validateMiningDemandRequest(posted?.request as Parameters<typeof validateMiningDemandRequest>[0]),c=request.context;
            check(request.operation==='open'&&event.runId===run.runId&&hash(event.skill)===hash(run.skill)&&c.runId===run.runId
                &&c.stepId===event.stepId&&hash(c.skill)===hash(run.skill)&&c.parametersDigest===parametersDigest
                &&posted?.state==='fulfilled'&&posted.demandId===miningDemandId(request)&&typeof posted.nativeActionId==='string'
                &&!ids.has(posted.nativeActionId));ids.add(posted!.nativeActionId!);
            const dispatch=dispatches.get(posted!.nativeActionId!),owner=dispatch?.owner;
            check(dispatch&&owner&&owner.username===run.username&&owner.worldId===options.worldId
                &&dispatch.demandId===posted!.demandId&&hash(dispatch.request.demand)===hash(request));
            json(workspace,options.worldId,miningOperationAdmissionPath(workspace,request));
            const source=readMiningInteractionSource(workspace,dispatch!.dispatchId),step=readMiningOperationAdmission(workspace,request),
                invocation=readMiningDemandInvocation(workspace,posted!.demandId!,owner!);
            check(source.digest===dispatch!.sourceDigest&&hash(source.owner)===hash(owner)&&hash(source.request)===hash(dispatch!.request)
                &&hash(invocation.request)===hash(request)&&miningOperationSealed(workspace,owner!,request));
            const filename=`${c.skill.id}@${c.skill.version}.skill.json`,paths=[join(workspace,'.local/agent-skills/private',owner!.actorId,filename),
                join(workspace,'.local/agent-skills/shared',filename),join(workspace,'agent-skills/catalog',filename)],path=paths.find(existsSync);
            check(path);const registered=new SkillRegistry().register(json(workspace,options.worldId,path!),{trusted:true}),
                admission=json(workspace,options.worldId,join(workspace,'.local/agent-skills/runs',`${run.runId}.admission.json`));
            check(registered.definition.id===c.skill.id&&registered.definition.version===c.skill.version&&step.checksum===registered.checksum
                &&admission.schemaVersion===1&&admission.runId===run.runId&&admission.username===run.username&&hash(admission.skill)===hash(run.skill)
                &&admission.checksum===registered.checksum&&admission.parametersDigest===parametersDigest
                &&hash(Object.entries(resolveSkillParameters(registered.definition,admission.parameters)).sort(([a],[b])=>a.localeCompare(b)))===parametersDigest);
            const trial=registered.definition.status==='draft'?miningTrialAuthorization(registered.definition):undefined;
            check(trial||registered.definition.status==='verified');
            const canonical=readMiningDemandProof({workspace,...options},owner!,request);
            check(canonical?.phase==='fulfilled'&&canonical.intent.nativeDispatchRequired===true&&canonical.completionEventId===dispatch!.dispatchId
                &&hash(canonical)===posted!.receiptDigest&&canonical.intent.authorityDigest===hash({owner,requestDigest:miningRequestDigest(request),
                    checksum:registered.checksum,stepAdmissionDigest:step.digest,...trial?{trialRunId:c.runId}:{}}));
            // The independent lifecycle audit must agree with the native effect, not just its JSON hash.
            const scope={clockId:owner!.clockId,clockProfileDigest:owner!.clockProfileDigest,actorAgentIds:[owner!.actorId],
                fromSimulationTime:'0001-01-01T00:00:00.000Z',toSimulationTime:'9999-12-31T23:59:59.999Z'};
            const mechanical=readNativeToolMaintenance(db,scope,options.worldId,[{agentId:owner!.actorId,username:owner!.username,lifecycleId:owner!.lifecycleId}],join(workspace,'config'));
            return{demandId:posted!.demandId!,nativeActionId:dispatch!.dispatchId,receiptDigest:hash(canonical),dispatchDigest:hash(dispatch),
                stepAdmissionDigest:step.digest,mechanicalDigest:mechanical.digest};
        });
    }).deferred();return result;}finally{db.close(true);}
}

export function verifyMiningSkillRunSources(workspace:string,run:SkillRunResult,selected?:{worldId:string;checkpointPath:string}){
    try{return readMiningSkillRunEvidence(workspace,run,selected).length>0;}catch{return false;}
}
