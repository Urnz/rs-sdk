import type { SocietyMinimumContract } from '../society-minimum/contract.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { assessSocietyMinimum,type MinimumCell,type MinimumFrame,type MinimumSubject } from '../society-minimum/assessment.js';
import { minimumSourceMap } from '../society-minimum/source-map.js';
import type { reportNativeOutcomes } from './native-outcomes.js';
import { validateEvaluationScope,type EvaluationScope } from './evaluation.js';
import type { reportNativeIntegration } from './integration-report.js';
import { needsExposureCells } from './needs-exposure.js';

/** Internal projection from the existing verified native readers; never an uploaded observation endpoint. */
export function projectNativeMinimumAssessment(contract:SocietyMinimumContract,scope:EvaluationScope,
    outcomes:ReturnType<typeof reportNativeOutcomes>|null,binding?:MinimumFrame,integration?:ReturnType<typeof reportNativeIntegration>|null){
    let nativeScopeMatches=false;
    try{nativeScopeMatches=!!outcomes&&digest(validateEvaluationScope(outcomes.scope))===digest(validateEvaluationScope(scope));}catch{ /* No foreign or malformed source can donate evidence. */ }
    const sourceMap=minimumSourceMap(contract),cells:MinimumCell[]=[],work=nativeScopeMatches?outcomes?.sources.work:undefined,tool=nativeScopeMatches?outcomes?.sources.toolDemand:undefined;
    const population=nativeScopeMatches?outcomes?.sources.populationBaseline:undefined,deaths=nativeScopeMatches?outcomes?.sources.populationDeaths:undefined;
    if(!binding&&population?.status==='available')binding={contractDigest:contract.digest,worldId:population.value.worldId,
        clockId:population.value.clockId,clockProfileDigest:population.value.clockProfileDigest,
        founderAgentIds:population.value.founders.map(f=>f.agentId),genesisAppliedAtSimulationTime:population.value.genesisAppliedAtSimulationTime,
        fromSimulationTime:scope.fromSimulationTime,toSimulationTime:scope.toSimulationTime};
    const diagnosticViolations:Array<{requirementId:string;sourceDigest:string|null;scope:EvaluationScope;meaning:string}>=
        tool?.status==='available'&&tool.value.minimumVerdict==='fail'?[{requirementId:'tool-unusable-demand-time',sourceDigest:tool.digest,scope,
            meaning:'Verified scoped lower-bound violation; full run binding and other gates remain separate.'}]:[];
    const populationCompatible=population?.status==='available'&&population.value.worldId===outcomes?.worldId
        &&population.value.clockId===scope.clockId&&population.value.clockProfileDigest===scope.clockProfileDigest
        &&contract.dependencies.worlds.some(w=>w.profile.digest===population.value.worldProfile.digest&&w.lifecyclePolicy.digest===population.value.lifecyclePolicy.digest);
    let needsCells:MinimumCell[]=[],needsStatus='unavailable';
    if(integration)try{
        const exposure=integration.needsExposure;
        if(!nativeScopeMatches||digest(validateEvaluationScope(integration.scope))!==digest(validateEvaluationScope(scope))
            ||digest(validateEvaluationScope(exposure.scope))!==digest(validateEvaluationScope(scope))||integration.worldId!==outcomes?.worldId
            ||exposure.worldId!==outcomes?.worldId||exposure.policyDigest!==contract.dependencies.needs.digest
            ||exposure.dynamicsDigest!==contract.dependencies.dynamics.digest)throw Error('Native physiology scope/policy differs');
        needsStatus='unbound';
        if(populationCompatible&&population?.status==='available'&&outcomes?.sources.agent.status==='available'){
            const p=population.value,nativeActors=outcomes.sources.agent.value.actors,actorDigest=outcomes.sources.agent.digest;
            const actors=exposure.actors.filter(a=>a.binding&&a.binding.lifecycleId===nativeActors.find(n=>n.agentId===a.actorAgentId)?.lifecycleId
                &&a.binding.playerId===nativeActors.find(n=>n.agentId===a.actorAgentId)?.username
                &&a.binding.playerId===p.founders.find(f=>f.agentId===a.actorAgentId)?.playerUsername
                &&a.binding.worldProfileDigest===p.worldProfile.digest&&a.binding.lifecyclePolicyDigest===p.lifecyclePolicy.digest
                &&a.admission?.kind==='genesis'&&a.admission.evidenceId===p.genesisResultId&&a.admission.evidenceDigest===p.genesisResultDigest
                &&a.initializedAt===p.genesisAppliedAtSimulationTime);
            needsCells=needsExposureCells(contract,{...exposure,actors}).map(c=>({...c,
                evidenceDigests:[...new Set([...c.evidenceDigests,population.digest,actorDigest])]}));needsStatus='available';
        }
    }catch{needsStatus='invalid';needsCells=[];}
    if(populationCompatible&&population?.status==='available'){
        const p=population.value,from=Date.parse(p.genesisAppliedAtSimulationTime)+contract.policy.window.warmupSimulationMilliseconds,
            to=from+contract.policy.window.evaluationSimulationMilliseconds;
        if(Date.parse(scope.fromSimulationTime)===from&&Date.parse(scope.toSimulationTime)<=to){
            const count=p.founders.length,ids:string[]=[];
            if(count<contract.policy.population.minimumFounders)ids.push('founders-at-start');
            if(deaths?.status==='available'){
                const remaining=count-new Set(deaths.value.deaths.filter(d=>Date.parse(d.atSimulationTime)<=Date.parse(scope.toSimulationTime)).map(d=>d.agentId)).size;
                if(remaining<contract.policy.population.minimumLivingFounders)ids.push('minimum-living-founders');
                if(remaining*10000<count*contract.policy.population.minimumFounderSurvivalBasisPoints)ids.push('founder-survival');
            }
            for(const requirementId of ids)diagnosticViolations.push({requirementId,sourceDigest:digest({baseline:population.digest,
                deaths:deaths?.status==='available'?deaths.digest:null}),scope,
                meaning:'Original-cohort count or terminal-death upper bound already violates the minimum; complete evaluation and integrity coverage remain separate.'});
            const planned:MinimumFrame={contractDigest:contract.digest,worldId:p.worldId,clockId:p.clockId,clockProfileDigest:p.clockProfileDigest,
                founderAgentIds:p.founders.map(f=>f.agentId),genesisAppliedAtSimulationTime:p.genesisAppliedAtSimulationTime,
                fromSimulationTime:scope.fromSimulationTime,toSimulationTime:new Date(to).toISOString()};
            for(const row of assessSocietyMinimum(contract,planned,needsCells,[]).requirements.filter(r=>r.verdict==='fail'))
                diagnosticViolations.push({requirementId:row.requirementId,sourceDigest:integration?.needsExposure.digest??null,scope,
                    meaning:'Verified physiology time already violates an original minimum bound; unobserved time and other gates remain separate.'});
        }
    }
    const diagnosticFailure=diagnosticViolations.length>0;
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
        if(population?.status==='available'){
            const p=population.value;
            if(!populationCompatible||p.worldId!==binding.worldId||p.genesisAppliedAtSimulationTime!==binding.genesisAppliedAtSimulationTime
                ||digest(p.founders.map(f=>f.agentId).sort())!==digest([...binding.founderAgentIds].sort()))throw Error('Native population frame differs');
            const count=p.founders.length;
            cells.push({requirementId:'founders-at-start',subject:{boundary:scope.fromSimulationTime},opportunity:'positive',
                lower:{numerator:String(count),denominator:'1'},upper:{numerator:String(count),denominator:'1'},evidenceDigests:[population.digest]});
            if(deaths?.status==='available'){
                const deadAt=(at:string)=>new Set(deaths.value.deaths.filter(d=>Date.parse(d.atSimulationTime)<=Date.parse(at)).map(d=>d.agentId)).size;
                const upper=(requirementId:string,boundary:string,numerator:number,denominator=1)=>cells.push({requirementId,subject:{boundary},opportunity:'positive',
                    upper:{numerator:String(numerator),denominator:String(denominator)},evidenceDigests:[population.digest,deaths.digest]});
                for(const boundary of binding.boundaries?.times??[scope.fromSimulationTime,scope.toSimulationTime])
                    upper('minimum-living-founders',boundary,count-deadAt(boundary));
                upper('founder-survival',scope.toSimulationTime,(count-deadAt(scope.toSimulationTime))*10000,count);
            }
        }
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
        assessment=assessSocietyMinimum(contract,binding,[...cells,...needsCells],[]);
    }catch{bindingStatus='invalid';assessment=null;}
    // No gate is synthesized from configuration or partial ledger presence. Native PASS is unavailable until their adapters exist.
    const body={protocol:'native-society-minimum-assessment-v1',scope,contractDigest:contract.digest,bindingStatus,
        nativeScopeStatus:!outcomes?'unavailable':nativeScopeMatches?'matched':'mismatch',
        requirements:sourceMap.requirements.map(r=>({...r,verdict:assessment?.requirements.find(v=>v.requirementId===r.requirementId)?.verdict??'inconclusive'})),
        integrity:sourceMap.integrity.map(g=>({...g,verdict:'inconclusive' as const})),assessment,
        diagnosticViolations,
        verdict:diagnosticFailure||assessment?.verdict==='fail'?'fail':'inconclusive',qualifiesMinimum:false,
        sources:{work:work?.status==='available'?{status:'available',digest:work.digest}:{status:work?.status??'unavailable'},
            needsExposure:{status:needsStatus,...(needsStatus==='available'?{digest:integration!.needsExposure.digest}:{})},
            populationBaseline:population?.status==='available'?{status:'available',digest:population.digest}:{status:population?.status??'unavailable'},
            populationDeaths:deaths?.status==='available'?{status:'available',digest:deaths.digest}:{status:deaths?.status??'unavailable'},
            toolDemand:tool?.status==='available'?{status:'available',digest:tool.digest}:{status:tool?.status??'unavailable'}},
        limitations:['Missing native scope, denominators or integrity proofs never become zero or PASS.',
            'Partial count/duration certificates use one-sided bounds; observed failure survives unrelated missing sources.',
            'Founder deaths bound survival from above; absent deaths or wall heartbeat do not establish continuous mortality coverage.',
            'Needs/food/housing/capacity histories and all eight integrity adapters remain incomplete.']};
    return{...body,digest:digest(body)};
}
