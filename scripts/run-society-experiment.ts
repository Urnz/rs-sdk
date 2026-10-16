import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {validateLongExperimentPlan,LongExperimentStore,prepareLongExperiment,startLongExperiment,stepLongExperiment,stopLongExperiment,
    nativeLongExperimentDependencies,longExperimentJournalPath,readLongExperimentReport,reportLongExperiment,
    readLongExperimentComparison,LONG_COMPARISON_CAPABILITIES} from '../society-experiments/index.js';
const {values}=parseArgs({options:{command:{type:'string',default:'report'},plan:{type:'string'},id:{type:'string'},reason:{type:'string'},
    control:{type:'string'},treatment:{type:'string'},axis:{type:'string',default:'diminishing-xp'},
    run:{type:'boolean',default:false},'poll-ms':{type:'string',default:'30000'}}});
const deps=nativeLongExperimentDependencies();
const plan=values.plan?validateLongExperimentPlan(JSON.parse(readFileSync(values.plan,'utf8'))):null,id=values.id??plan?.sessionId;
if(!id && !['compare','capabilities'].includes(values.command!))throw new Error('Provide --plan or --id');
if(values.command==='capabilities')console.log(JSON.stringify(LONG_COMPARISON_CAPABILITIES,null,2));
else if(values.command==='compare')console.log(JSON.stringify(readLongExperimentComparison({schemaVersion:1,axis:values.axis,
    controlSessionId:values.control,treatmentSessionId:values.treatment}),null,2));
else if(values.command==='prepare'){
    if(!plan)throw new Error('Prepare requires --plan');console.log(JSON.stringify((await prepareLongExperiment(plan,deps)).plan,null,2));
}else if(values.command==='report'){
    if(!id)throw new Error('Report requires --id');console.log(JSON.stringify(readLongExperimentReport(id),null,2));
}
else if(['start','step','stop'].includes(values.command!)){
    if(!id)throw new Error('Provide --plan or --id');
    const poll=Number(values['poll-ms']);if(!Number.isSafeInteger(poll)||poll<1000||poll>60000)throw new Error('Poll must be 1000-60000 ms');
    if(values.run&&values.command==='stop')throw new Error('Stop is a single explicit operation');
    const store=new LongExperimentStore(longExperimentJournalPath);
    try{
        let state=values.command==='start'?(plan?await startLongExperiment(plan,store,deps):(()=>{throw new Error('Start requires --plan');})())
            :values.command==='stop'?stopLongExperiment(id,store,deps,values.reason??''):await stepLongExperiment(id,store,deps);
        while(values.run&&state.status==='running'){
            await new Promise(resolve=>setTimeout(resolve,poll));state=await stepLongExperiment(id,store,deps);
            console.error(JSON.stringify({sessionId:id,status:state.status,sequence:state.sequence,waves:state.settled.length}));
        }
        console.log(JSON.stringify(reportLongExperiment(state),null,2));if(state.status==='failed')process.exitCode=1;
    }finally{store.close();}
}else throw new Error('Commands: prepare, start, step, stop, report, compare, capabilities');
