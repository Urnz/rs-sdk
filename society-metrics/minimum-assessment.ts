import type { SocietyMinimumContract } from '../society-minimum/contract.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { assessSocietyMinimum,type MinimumCell,type MinimumFrame,type MinimumSubject } from '../society-minimum/assessment.js';
import { minimumSourceMap } from '../society-minimum/source-map.js';
import type { reportNativeOutcomes } from './native-outcomes.js';
import { validateEvaluationScope,type EvaluationScope } from './evaluation.js';

/** Internal projection from the existing verified native readers; never an uploaded observation endpoint. */
export function projectNativeMinimumAssessment(contract:SocietyMinimumContract,scope:EvaluationScope,
    outcomes:ReturnType<typeof reportNativeOutcomes>|null,binding?:MinimumFrame){
    let nativeScopeMatches=false;
    try{nativeScopeMatches=!!outcomes&&digest(validateEvaluationScope(outcomes.scope))===digest(validateEvaluationScope(scope));}catch{ /* No foreign or malformed source can donate evidence. */ }
    const sourceMap=minimumSourceMap(contract),cells:MinimumCell[]=[],work=nativeScopeMatches?outcomes?.sources.work:undefined,tool=nativeScopeMatches?outcomes?.sources.toolDemand:undefined;
    const diagnosticFailure=tool?.status==='available'&&tool.value.minimumVerdict==='fail';
    const lower=(requirementId:string,subject:MinimumSubject,value:number,sourceDigest:string)=>{
        if(value>0)cells.push({requirementId,subject,opportunity:'positive',lower:{numerator:String(value),denominator:'1'},evidenceDigests:[sourceDigest]});
    };
    let assessment:ReturnType<typeof assessSocietyMinimum>|null=null,bindingStatus:'unbound'|'bound'|'invalid'='unbound';
    if(binding)try{
        if(!nativeScopeMatches||binding.worldId!==outcomes?.worldId||binding.clockId!==scope.clockId||binding.clockProfileDigest!==scope.clockProfileDigest
            ||binding.fromSimulationTime!==scope.fromSimulationTime||binding.toSimulationTime!==scope.toSimulationTime
            ||digest([...binding.founderAgentIds].sort())!==digest([...scope.actorAgentIds].sort()))throw Error('Minimum native scope differs');
        // Validate original warmup/window and the full quantifier inventory before mapping any receipt.
        assessSocietyMinimum(contract,binding,[],[]);bindingStatus='bound';
        if(work?.status==='available'){
            const rows=work.value.rows,from=Date.parse(scope.fromSimulationTime),bucketMs=contract.policy.window.bucketSimulationMilliseconds;
            const bucket=(at:string)=>Math.ceil((Date.parse(at)-from)/bucketMs)-1; // Events use (start,end].
            for(let index=0;index<contract.policy.window.evaluationSimulationMilliseconds/bucketMs;index++)
                lower('productive-participants',{bucket:index},new Set(rows.filter(r=>bucket(r.simulationTime)===index).map(r=>r.workerAgentId)).size,work.digest);
            const stages=new Set<string>();for(const row of rows){
                if(row.stage==='food-gather')stages.add('food-gathering');
                if(row.stage==='food-cook')stages.add('food-processing');
                if(row.stage==='repair'&&row.serviceCapacityAfter!==null&&row.serviceCapacityAfter>0)stages.add('tool-maintenance');
            }
            lower('productive-stage-kinds',{},contract.policy.labor.requiredStageKinds.filter(s=>stages.has(s)).length,work.digest);
            if(contract.policy.tools.cycleIds.includes('bronze-pickaxe-mining'))lower('tool-maintenance-cycles',{cycleId:'bronze-pickaxe-mining'},
                rows.filter(r=>r.stage==='repair'&&r.serviceCapacityAfter!==null&&r.serviceCapacityAfter>0).length,work.digest);
        }
        if(tool?.status==='available'&&tool.value.standingRequests){const standing=tool.value.standingRequests;
            if(contract.policy.tools.cycleIds.includes(standing.cycleId)&&standing.longestConfirmedUnusableSimulationMs!==null)
                lower('tool-unusable-demand-time',{cycleId:standing.cycleId},standing.longestConfirmedUnusableSimulationMs,tool.digest);
        }
        assessment=assessSocietyMinimum(contract,binding,cells,[]);
    }catch{bindingStatus='invalid';assessment=null;}
    // No gate is synthesized from configuration or partial ledger presence. Native PASS is unavailable until their adapters exist.
    const body={protocol:'native-society-minimum-assessment-v1',scope,contractDigest:contract.digest,bindingStatus,
        nativeScopeStatus:!outcomes?'unavailable':nativeScopeMatches?'matched':'mismatch',
        requirements:sourceMap.requirements.map(r=>({...r,verdict:assessment?.requirements.find(v=>v.requirementId===r.requirementId)?.verdict??'inconclusive'})),
        integrity:sourceMap.integrity.map(g=>({...g,verdict:'inconclusive' as const})),assessment,
        diagnosticViolations:diagnosticFailure?[{requirementId:'tool-unusable-demand-time',sourceDigest:tool!.status==='available'?tool!.digest:null,
            scope,meaning:'Verified scoped lower-bound violation; full run binding and other gates remain separate.'}]:[],
        verdict:diagnosticFailure||assessment?.verdict==='fail'?'fail':'inconclusive',qualifiesMinimum:false,
        sources:{work:work?.status==='available'?{status:'available',digest:work.digest}:{status:work?.status??'unavailable'},
            toolDemand:tool?.status==='available'?{status:'available',digest:tool.digest}:{status:tool?.status??'unavailable'}},
        limitations:['Missing native scope, denominators or integrity proofs never become zero or PASS.',
            'Partial count/duration certificates use one-sided bounds; observed failure survives unrelated missing sources.',
            'Population, needs/food/housing/capacity histories and all eight integrity adapters remain incomplete.']};
    return{...body,digest:digest(body)};
}
