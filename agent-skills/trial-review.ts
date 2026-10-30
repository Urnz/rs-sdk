import {readdir,readFile,stat,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {SkillLibrary} from './library.js';
import {SkillRegistry} from './registry.js';
import {FileSkillStore} from './store.js';
import {SkillTrialStore} from './trials.js';
import {FileSkillVerificationJournal,verifyAndPromoteSkill,type SkillVerificationReport} from './verifier.js';
import {matchesFoodTrialParameters} from './food-trials.js';
import type {SkillRunResult} from './types.js';
import {nativeToolDigest as hash} from '../item-lifecycle/native-tool.js';
import {assertNativeFoodDomainPath} from '../food-loop/native-source.js';
import {populationNeedsOptions} from '../server/gateway/admin/needs-runtime.js';
import {verifyFoodSkillRunSources} from '../server/gateway/admin/native-food-skills.js';
import {verifyToolSkillRunSources} from '../server/gateway/admin/native-tool-skills.js';
import {verifyMiningSkillRunSources} from '../server/gateway/admin/native-mining-skill-evidence.js';
import {buildSkillPublicationApproval} from '../server/gateway/admin/skill-publication-approval.js';

export interface SkillTrialReviewOptions {
    workspace:string;
    trialId:string;
    /** Trusted caller's selected source, never taken from posted run data. */
    selected?:{worldId:string;checkpointPath:string;businessPath?:string};
}
async function localJson(o:SkillTrialReviewOptions,path:string){
    assertNativeFoodDomainPath({workspace:o.workspace,worldId:o.selected?.worldId??populationNeedsOptions(o.workspace).worldId,checkpointPath:path});
    const rel=relative(await realpath(o.workspace),await realpath(path));
    if(!rel||rel.startsWith('..')||isAbsolute(rel)||(await stat(path)).size>1048576)throw Error('Trial review source path or size differs');
    return JSON.parse(await readFile(path,'utf8'));
}
async function context(o:SkillTrialReviewOptions){
    const root=join(o.workspace,'.local/agent-skills'),trials=new SkillTrialStore(join(root,'trials.json'));
    // Validate the physical trial document before its normal store reader opens it.
    await localJson(o,join(root,'trials.json'));
    const trial=await trials.get(o.trialId);if(!trial)throw Error('Skill trial not found');
    const library=new SkillLibrary(new SkillRegistry(),new FileSkillStore(root));
    await library.loadReviewedCatalog(join(o.workspace,'agent-skills/catalog'));await library.loadAgentDrafts('admin-trial-runner');
    const registered=library.registry.get(trial.draft,'admin-trial-runner');
    if(!registered||registered.definition.status!=='draft'||registered.definition.sharing.visibility!=='shared'
        ||registered.definition.provenance.authorKind!=='agent')throw Error('Trial requires its exact shared agent draft');
    return{root,trials,trial,library,registered};
}
async function evidence(o:SkillTrialReviewOptions,c:Awaited<ReturnType<typeof context>>,exactIds?:string[]){
    const directory=join(c.root,'runs'),files=(await readdir(directory).catch((error:NodeJS.ErrnoException)=>{
        if(error.code==='ENOENT')return[];throw error;
    })).filter(f=>/^[a-f0-9-]{36}\.json$/i.test(f)).sort();
    if(files.length>2000)throw Error('Trial evidence inventory exceeds 2000 runs; select an isolated trial workspace');
    const runs:SkillRunResult[]=[];
    for(const file of files){
        if(exactIds&&!exactIds.includes(file.slice(0,-5)))continue;
        const run=await localJson(o,join(directory,file)) as SkillRunResult;
        if(run.runId!==file.slice(0,-5))throw Error('Trial run filename/identity differs');
        if(run.username?.toLowerCase()!==c.trial.testBotUsername||run.skill?.id!==c.trial.draft.id||run.skill.version!==c.trial.draft.version)continue;
        const started=run.events?.[0]?.timestamp;
        if(run.status!=='completed'||typeof started!=='string'||!Number.isFinite(Date.parse(started))||started<c.trial.createdAt
            ||!matchesFoodTrialParameters(c.registered.definition,run.parameters,c.trial.parameters))continue;
        // All native trial kinds retain the canonical executor admission, not just Mining.
        const admission=await localJson(o,join(directory,`${run.runId}.admission.json`));
        if(admission.schemaVersion!==1||admission.runId!==run.runId||admission.username!==run.username
            ||hash(admission.skill)!==hash(run.skill)||admission.checksum!==c.registered.checksum
            ||hash(admission.parameters)!==hash(run.parameters)
            ||admission.parametersDigest!==hash(Object.entries(run.parameters!).sort(([a],[b])=>a.localeCompare(b))))
            throw Error('Trial executor admission/checksum differs');
        for(const event of run.events.filter(e=>e.type==='step.succeeded'&&e.operation?.startsWith('tool-'))){
            const receipt=event.data?.receipt as {intent?:{skill?:{checksum?:string}}}|undefined;
            if(receipt?.intent?.skill?.checksum!==c.registered.checksum)throw Error('Native tool effect belongs to a different draft checksum');
        }
        runs.push(run);
    }
    if(runs.length>20)throw Error('Trial evidence exceeds 20 runs');
    runs.sort((a,b)=>a.events[0]!.timestamp.localeCompare(b.events[0]!.timestamp)||a.runId.localeCompare(b.runId));
    if(exactIds&&(runs.length!==exactIds.length||runs.some(r=>!exactIds.includes(r.runId))))throw Error('Reviewed trial evidence changed or is missing');
    return runs;
}
function verify(o:SkillTrialReviewOptions,c:Awaited<ReturnType<typeof context>>,runs:SkillRunResult[],now?:string){
    const report=verifyAndPromoteSkill(c.registered.definition,runs,{targetVersion:c.trial.targetVersion,parameters:c.trial.parameters,now,
        resolveDefinition:ref=>c.library.registry.get(ref,'admin-trial-runner')?.definition??null,
        verifyFoodEvidence:run=>verifyFoodSkillRunSources(o.workspace,run,o.selected?{...o.selected,businessPath:o.selected.businessPath??join(o.workspace,'.local/economy/businesses.sqlite')}:undefined),
        verifyToolEvidence:run=>verifyToolSkillRunSources(o.workspace,run,o.selected),
        verifyMiningEvidence:run=>verifyMiningSkillRunSources(o.workspace,run,o.selected)});
    report.checks.push({id:'persisted-evidence-binding',passed:true,message:`persisted-native-trial-review-v1:${hash({
        worldId:o.selected?.worldId??populationNeedsOptions(o.workspace).worldId,draftChecksum:c.registered.checksum,
        runs:runs.map(run=>({runId:run.runId,digest:hash(run)}))})}`});
    return report;
}
/** Normal persisted review path. Produces a reviewable version; never saves a verified skill. */
export async function reviewSkillTrial(o:SkillTrialReviewOptions){
    const c=await context(o);
    if(!['running','verification-failed','verification-passed'].includes(c.trial.status))throw Error('Skill trial is not reviewable');
    const runs=await evidence(o,c),report=verify(o,c,runs);
    await new FileSkillVerificationJournal(join(c.root,'verifications')).save(report);
    const trial=await c.trials.transition(c.trial.trialId,c.trial.revision,report.passed?'verification-passed':'verification-failed',{
        runIds:report.evidenceRunIds,verificationReportId:report.id,verificationChecks:report.checks});
    return{trial,report,approval:report.passed?buildSkillPublicationApproval(trial,report):null};
}
/** Reopen the exact reviewed runs and native sources immediately before publication/export. Readonly. */
export async function readSkillTrialReview(o:SkillTrialReviewOptions){
    const c=await context(o),trial=c.trial;
    if(trial.status!=='verification-passed'||!trial.verificationReportId)throw Error('Skill trial has no passed review');
    if(!/^[a-f0-9-]{36}$/i.test(trial.verificationReportId))throw Error('Invalid trial review identity');
    const report=await localJson(o,join(c.root,'verifications',`${trial.verificationReportId}.json`)) as SkillVerificationReport;
    const runs=await evidence(o,c,report.evidenceRunIds),current=verify(o,c,runs,report.createdAt);
    // Re-evaluate the complete procedure and all current gates, including reports created before a new gate existed.
    if(hash({...current,id:''})!==hash({...report,id:''}))throw Error('Trial review or canonical native sources changed; review again');
    return{trial,report,approval:buildSkillPublicationApproval(trial,report)};
}
