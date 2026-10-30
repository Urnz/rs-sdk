import {parseArgs} from 'node:util';
import {founderTrialSource,prepareFounderProcedureTrials} from '../society-experiments/founder-procedure-trials.js';
import {reviewSkillTrial,readSkillTrialReview} from '../agent-skills/trial-review.js';
const {values,positionals}=parseArgs({allowPositionals:true,strict:true,options:{root:{type:'string'},username:{type:'string'},'business-id':{type:'string'},trial:{type:'string'}}});
if(!values.root)throw Error('Usage: society-founder-trials.ts prepare|review|inspect --root DISPOSABLE_TRIAL_WORKSPACE');
const source=founderTrialSource(values.root),command=positionals[0];
if(command==='prepare'){
    if(!values.username||!values['business-id'])throw Error('Prepare requires --username and --business-id');
    console.log(JSON.stringify(await prepareFounderProcedureTrials(source.workspace,values.username,values['business-id']),null,2));
}else if(command==='review'||command==='inspect'){
    if(!values.trial)throw Error('Review/inspect requires --trial UUID');
    const options={workspace:source.workspace,trialId:values.trial,selected:source},result=command==='review'?await reviewSkillTrial(options):await readSkillTrialReview(options);
    console.log(JSON.stringify({protocol:'si-c07-founder-procedure-review-v1',worldId:source.worldId,...result,publicationExecuted:false,providerCalls:0},null,2));
    process.exitCode=result.report.passed?0:2;
}else throw Error('Commands: prepare, review, inspect. Publishing remains the separate human-approved admin action.');
