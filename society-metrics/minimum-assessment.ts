import type { SocietyMinimumContract } from '../society-minimum/contract.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { assessSocietyMinimum,type MinimumCell,type MinimumFrame,type MinimumSubject,type MinimumGate } from '../society-minimum/assessment.js';
import { minimumSourceMap } from '../society-minimum/source-map.js';
import type { reportNativeOutcomes } from './native-outcomes.js';
import { validateEvaluationScope,type EvaluationScope } from './evaluation.js';
import type { reportNativeIntegration } from './integration-report.js';
import { needsExposureCells } from './needs-exposure.js';
import { foodMinimumCells,type FoodActorContext } from './food-minimum.js';
import { housingExposureCells } from './housing-minimum.js';
import { toolCapacityCells } from './tool-capacity.js';
import { minimumSourceInventory } from '../society-minimum/source-inventory.js';

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
    const actorSource=nativeScopeMatches&&outcomes?.sources.agent?.status==='available'?outcomes.sources.agent:null;
    const original=(a:FoodActorContext)=>{
        if(!populationCompatible||population?.status!=='available'||!actorSource||!a.binding)return false;
        const p=population.value,actor=actorSource.value.actors.find(n=>n.agentId===a.binding!.actorId);
        return a.binding.lifecycleId===actor?.lifecycleId&&a.binding.playerId===actor.username
            &&a.binding.playerId===p.founders.find(f=>f.agentId===a.binding!.actorId)?.playerUsername
            &&a.binding.worldProfileDigest===p.worldProfile.digest&&a.binding.lifecyclePolicyDigest===p.lifecyclePolicy.digest
            &&a.admission?.kind==='genesis'&&a.admission.evidenceId===p.genesisResultId&&a.admission.evidenceDigest===p.genesisResultDigest
            &&a.initializedAt===p.genesisAppliedAtSimulationTime;
    };
    let needsCells:MinimumCell[]=[],needsStatus='unavailable';
    if(integration)try{
        const exposure=integration.needsExposure;
        if(!nativeScopeMatches||digest(validateEvaluationScope(integration.scope))!==digest(validateEvaluationScope(scope))
            ||digest(validateEvaluationScope(exposure.scope))!==digest(validateEvaluationScope(scope))||integration.worldId!==outcomes?.worldId
            ||exposure.worldId!==outcomes?.worldId||exposure.policyDigest!==contract.dependencies.needs.digest
            ||exposure.dynamicsDigest!==contract.dependencies.dynamics.digest)throw Error('Native physiology scope/policy differs');
        needsStatus='unbound';
        if(populationCompatible&&population?.status==='available'&&outcomes?.sources.agent.status==='available'){
            const p=population.value,actorDigest=outcomes.sources.agent.digest;
            const actors=exposure.actors.filter(original);
            needsCells=needsExposureCells(contract,{...exposure,actors}).map(c=>({...c,
                evidenceDigests:[...new Set([...c.evidenceDigests,population.digest,actorDigest])]}));needsStatus='available';
        }
    }catch{needsStatus='invalid';needsCells=[];}
    let foodStatus='unavailable',foodCells:MinimumCell[]=[],foodBoundaryTimes:string[]=[],foodViolations:ReturnType<typeof foodMinimumCells>['violations']=[];
    if(integration)try{
        const food=integration.minimumFood;
        if(!nativeScopeMatches||digest(validateEvaluationScope(integration.scope))!==digest(validateEvaluationScope(scope))
            ||digest(validateEvaluationScope(food.scope))!==digest(validateEvaluationScope(scope))||integration.worldId!==outcomes?.worldId||food.worldId!==outcomes?.worldId
            ||food.catalogDigest!==contract.dependencies.food.catalogDigest||food.policyDigest!==contract.dependencies.needs.digest
            ||food.dynamicsDigest!==contract.dependencies.dynamics.digest)throw Error('Native food scope/policy differs');
        foodStatus='unbound';
        if(populationCompatible&&population?.status==='available'&&actorSource){
            const p=population.value,natives=actorSource.value.actors,result=foodMinimumCells(contract,food,original,producer=>{
                const actor=natives.find(a=>a.agentId===producer.actorAgentId);
                return actor?.lifecycleId===producer.lifecycleId&&actor.username===producer.username&&producer.at>=p.genesisAppliedAtSimulationTime;
            });
            foodCells=result.cells.map(c=>({...c,evidenceDigests:[...new Set([...c.evidenceDigests,population.digest,actorSource.digest])]}));
            foodBoundaryTimes=result.boundaryTimes;foodViolations=result.violations;foodStatus='available';
        }
    }catch{foodStatus='invalid';foodCells=[];foodBoundaryTimes=[];foodViolations=[];}
    let housingStatus='unavailable',housingCells:MinimumCell[]=[],housingBoundaryTimes:string[]=[];
    if(integration)try{
        const housing=integration.minimumHousing;
        if(!nativeScopeMatches||digest(validateEvaluationScope(integration.scope))!==digest(validateEvaluationScope(scope))
            ||digest(validateEvaluationScope(housing.scope))!==digest(validateEvaluationScope(scope))||integration.worldId!==outcomes?.worldId
            ||housing.worldId!==outcomes?.worldId||housing.contractDigest!==contract.digest)throw Error('Native housing scope/policy differs');
        housingStatus='unbound';
        if(populationCompatible&&population?.status==='available'&&actorSource){
            housingCells=housingExposureCells(contract,housing,original,id=>deaths?.status==='available'
                ?deaths.value.deaths.filter(d=>d.agentId===id).map(d=>d.atSimulationTime).sort()[0]??null:null)
                .map(c=>({...c,evidenceDigests:[...new Set([...c.evidenceDigests,population.digest,actorSource.digest,
                    ...(deaths?.status==='available'?[deaths.digest]:[])])]}));
            housingBoundaryTimes=housing.boundaryTimes;housingStatus='available';
        }
    }catch{housingStatus='invalid';housingCells=[];housingBoundaryTimes=[];}
    let capacityStatus='unavailable',capacityCells:MinimumCell[]=[],capacityBoundaryTimes:string[]=[];
    if(integration?.minimumToolCapacity?.sourceDigest)try{
        const capacity=integration.minimumToolCapacity;
        if(!nativeScopeMatches||digest(validateEvaluationScope(integration.scope))!==digest(validateEvaluationScope(scope))
            ||digest(validateEvaluationScope(capacity.scope))!==digest(validateEvaluationScope(scope))||integration.worldId!==outcomes?.worldId
            ||capacity.worldId!==outcomes?.worldId)throw Error('Native tool capacity scope differs');
        capacityStatus='unbound';
        if(populationCompatible&&population?.status==='available'&&actorSource){
            capacityCells=toolCapacityCells(contract,capacity,original).map(c=>({...c,evidenceDigests:[...new Set([...c.evidenceDigests,population.digest,actorSource.digest])]}));
            capacityBoundaryTimes=capacity.boundaries.filter(b=>b.source.status==='available').map(b=>b.at);capacityStatus='available';
        }
    }catch{capacityStatus='invalid';capacityCells=[];capacityBoundaryTimes=[];}
    const boundaryTimes=[...new Set([...foodBoundaryTimes,...housingBoundaryTimes,...capacityBoundaryTimes])];
    if(binding&&boundaryTimes.length){const times=[...new Set([...(binding.boundaries?.times??[scope.fromSimulationTime,scope.toSimulationTime]),...boundaryTimes])].sort();
        if(!binding.boundaries||times.length!==binding.boundaries.times.length)binding={...binding,boundaries:{times,complete:false,
            sourceDigest:digest({prior:binding.boundaries?.sourceDigest??null,food:integration!.minimumFood.digest,housing:integration!.minimumHousing?.digest??null,
                capacity:integration!.minimumToolCapacity?.digest??null})}};
    }
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
                fromSimulationTime:scope.fromSimulationTime,toSimulationTime:new Date(to).toISOString(),
                boundaries:{times:[...new Set([scope.fromSimulationTime,...boundaryTimes,new Date(to).toISOString()])].sort(),complete:false,sourceDigest:digest(boundaryTimes)}};
            for(const row of assessSocietyMinimum(contract,planned,[...needsCells,...foodCells,...housingCells,...capacityCells],[]).requirements.filter(r=>r.verdict==='fail'))
                diagnosticViolations.push({requirementId:row.requirementId,sourceDigest:row.requirementId.startsWith('hunger-')||row.requirementId.startsWith('fatigue-')
                    ?integration?.needsExposure.digest??null:row.requirementId==='legal-housing-access-time'?integration?.minimumHousing.digest??null
                    :row.requirementId==='tool-service-capacity-retention'?integration?.minimumToolCapacity.digest??null:integration?.minimumFood.digest??null,scope,
                    meaning:'Verified native time/food/housing/tool evidence already violates an original minimum bound; unobserved time and other gates remain separate.'});
            for(const violation of foodViolations)diagnosticViolations.push({requirementId:violation.requirementId,sourceDigest:integration!.minimumFood.digest,scope,
                meaning:'A verified positive bootstrap/import relief violates100% internal supply even if other native applications are pending.'});
        }
    }
    const lifecycle=nativeScopeMatches?outcomes?.sources.lifecycleAttempts:undefined;
    const lifecycleWatermarks=nativeScopeMatches?outcomes?.sources.lifecycleWatermarks:undefined;
    const lifecycleIntegrityViolations=[...lifecycle?.status==='available'&&lifecycle.value.worldId===outcomes?.worldId&&digest(lifecycle.value.scope)===digest(scope)
        ?lifecycle.value.violations.map(v=>({gateId:'finite-lifecycle-no-respawn',sourceDigest:lifecycle.digest,scope,attemptId:v.attemptId,meaning:v.reason})):[],
        ...lifecycleWatermarks?.status==='available'&&lifecycleWatermarks.value.worldId===outcomes?.worldId&&digest(lifecycleWatermarks.value.scope)===digest(scope)
            ?lifecycleWatermarks.value.violations.map(v=>({gateId:'finite-lifecycle-no-respawn',sourceDigest:lifecycleWatermarks.digest,scope,
                attemptId:`census:${v.sampleSequence}:${v.actorId}`,meaning:v.reason})):[]];
    const lifecyclePolicy=nativeScopeMatches?outcomes?.sources.lifecyclePolicy:undefined;
    const policyMutations=nativeScopeMatches?outcomes?.sources.policyMutations:undefined;
    const policyIntegrityViolations=[...lifecyclePolicy?.status==='available'&&lifecyclePolicy.value.worldId===outcomes?.worldId&&digest(lifecyclePolicy.value.scope)===digest(scope)
        ?lifecyclePolicy.value.violations.map(v=>({gateId:'unchanged-clock-and-world-policy',sourceDigest:lifecyclePolicy.digest,scope,sampleSequence:v.sampleSequence,meaning:v.reason})):[],
        ...policyMutations?.status==='available'&&policyMutations.value.worldId===outcomes?.worldId&&digest(policyMutations.value.scope)===digest(scope)
            ?policyMutations.value.violations.map(v=>({gateId:'unchanged-clock-and-world-policy',sourceDigest:policyMutations.digest,scope,attemptId:v.attemptId,meaning:v.reason})):[]];
    const integrityFailures=[...lifecycleIntegrityViolations.length?[{gateId:'finite-lifecycle-no-respawn',verdict:'fail' as const,
        evidenceDigests:[...new Set(lifecycleIntegrityViolations.map(v=>v.sourceDigest))]}]:[],
        ...policyIntegrityViolations.length?[{gateId:'unchanged-clock-and-world-policy',verdict:'fail' as const,
            evidenceDigests:[...new Set(policyIntegrityViolations.map(v=>v.sourceDigest))]}]:[]];
    const diagnosticFailure=diagnosticViolations.length>0||lifecycleIntegrityViolations.length>0||policyIntegrityViolations.length>0;
    const lower=(requirementId:string,subject:MinimumSubject,value:number,sourceDigest:string)=>{
        if(value>0)cells.push({requirementId,subject,opportunity:'positive',lower:{numerator:String(value),denominator:'1'},evidenceDigests:[sourceDigest]});
    };
    let assessment:ReturnType<typeof assessSocietyMinimum>|null=null,bindingStatus:'unbound'|'bound'|'invalid'='unbound';
    if(binding)try{
        const integrityEvidence:MinimumGate[]=[...integrityFailures];
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
                // These readers already verify the applied full cohort, immutable membership and native finite-avatar identity.
                // The roster certificate includes dead/offline founders; it does not certify survival or absence of respawn.
                const roster=deaths.value.founderBindings,hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
                if(roster.length===count&&new Set(roster.map(a=>a.actorId)).size===count&&new Set(roster.map(a=>a.username)).size===count
                    &&p.founders.every(f=>roster.some(a=>a.actorId===f.agentId&&a.username===f.playerUsername&&hex(a.lifecycleId)&&hex(a.membershipDigest)))
                    &&[p.genesisSnapshotDigest,p.anchorSnapshotDigest,p.anchorDigest,deaths.value.agentSnapshotDigest,deaths.value.healthSnapshotDigest].every(hex))
                    integrityEvidence.push({gateId:'frozen-founder-roster',verdict:'pass',evidenceDigests:[population.digest,deaths.digest]});
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
            // A repair alone is labor; only the separate prospective material/cycle proof earns cycle credit.
        }
        const maintenance=nativeScopeMatches?outcomes?.sources.toolMaintenance:undefined;
        if(maintenance?.status==='available'&&maintenance.value.contractDigest===contract.digest&&maintenance.value.worldId===outcomes?.worldId
            &&digest(maintenance.value.scope)===digest(scope)&&populationCompatible&&population?.status==='available'){
            for(const cycleId of contract.policy.tools.cycleIds){const cycles=maintenance.value.candidates.filter(c=>c.cycleId===cycleId&&c.qualifiesMinimum
                &&c.mechanicalCycleComplete&&c.inputOrigin==='internal'&&c.materialConsumption==='verified'
                &&c.originFromSimulationTime!==null&&c.originFromSimulationTime>=population.value.genesisAppliedAtSimulationTime
                &&scope.actorAgentIds.includes(c.actorAgentId)&&c.at>scope.fromSimulationTime&&c.at<=scope.toSimulationTime);
                if(cycles.length)lower('tool-maintenance-cycles',{cycleId},new Set(cycles.map(c=>c.operationId)).size,maintenance.digest);
            }
        }
        if(tool?.status==='available'&&tool.value.standingRequests){const standing=tool.value.standingRequests;
            if(contract.policy.tools.cycleIds.includes(standing.cycleId)&&standing.longestConfirmedUnusableSimulationMs!==null)
                lower('tool-unusable-demand-time',{cycleId:standing.cycleId},standing.longestConfirmedUnusableSimulationMs,tool.digest);
        }
        if(tool?.status==='available'&&populationCompatible&&population?.status==='available'){const coverage=tool.value.cohortCoverage;
            if('executorCoverage' in coverage&&coverage.completeDemandCoverage&&coverage.maximumSimulationGapMs<=contract.policy.window.maximumTraceGapSimulationMilliseconds
                &&coverage.maximumWallGapMs<=5000&&coverage.executorCoverage.positiveOpportunity&&coverage.executorCoverage.longestOutstandingUpperSimulationMs!==null
                &&contract.policy.tools.cycleIds.includes(tool.value.cycleId)){
                const upper={numerator:String(coverage.executorCoverage.longestOutstandingUpperSimulationMs),denominator:'1'},
                    known=cells.find(c=>c.requirementId==='tool-unusable-demand-time'&&c.subject.cycleId===tool.value.cycleId);
                // A conflicting upper certificate cannot erase an independently verified lower-bound failure.
                if(known){if(!known.lower||BigInt(known.lower.numerator)<=BigInt(upper.numerator)*BigInt(known.lower.denominator)){
                    known.upper=upper;known.evidenceDigests=[...new Set([...known.evidenceDigests,population.digest])];}}
                else cells.push({requirementId:'tool-unusable-demand-time',subject:{cycleId:tool.value.cycleId},opportunity:'positive',upper,evidenceDigests:[tool.digest,population.digest]});
            }
        }
        assessment=assessSocietyMinimum(contract,binding,[...cells,...needsCells,...foodCells,...housingCells,...capacityCells],integrityEvidence);
    }catch{bindingStatus='invalid';assessment=null;}
    // Roster PASS uses the verified original identities. Configuration/ledger presence cannot certify the remaining gates or the full run.
    const body={protocol:'native-society-minimum-assessment-v1',scope,contractDigest:contract.digest,bindingStatus,
        nativeScopeStatus:!outcomes?'unavailable':nativeScopeMatches?'matched':'mismatch',
        requirements:sourceMap.requirements.map(r=>({...r,verdict:assessment?.requirements.find(v=>v.requirementId===r.requirementId)?.verdict??'inconclusive'})),
        integrity:sourceMap.integrity.map(g=>({...g,verdict:integrityFailures.some(f=>f.gateId===g.gateId)?'fail' as const
            :assessment?.integrity.find(a=>a.gateId===g.gateId)?.verdict??'inconclusive'})),assessment,
        diagnosticViolations,lifecycleIntegrityViolations,policyIntegrityViolations,requiredSourceInventory:minimumSourceInventory(contract),
        verdict:diagnosticFailure||assessment?.verdict==='fail'?'fail':'inconclusive',qualifiesMinimum:false,
        sources:{work:work?.status==='available'?{status:'available',digest:work.digest}:{status:work?.status??'unavailable'},
            toolMaintenance:nativeScopeMatches&&outcomes?.sources.toolMaintenance?.status==='available'
                ?{status:'available',digest:outcomes.sources.toolMaintenance.digest}:{status:nativeScopeMatches?outcomes?.sources.toolMaintenance?.status??'unavailable':'unavailable'},
            needsExposure:{status:needsStatus,...(needsStatus==='available'?{digest:integration!.needsExposure.digest}:{})},
            foodMinimum:{status:foodStatus,...(foodStatus==='available'?{digest:integration!.minimumFood.digest}:{})},
            housingAccess:{status:housingStatus,...(housingStatus==='available'?{digest:integration!.minimumHousing.digest}:{})},
            toolCapacity:{status:capacityStatus,...(capacityStatus==='available'?{digest:integration!.minimumToolCapacity.digest}:{})},
            populationBaseline:population?.status==='available'?{status:'available',digest:population.digest}:{status:population?.status??'unavailable'},
            populationDeaths:deaths?.status==='available'?{status:'available',digest:deaths.digest}:{status:deaths?.status??'unavailable'},
            mortalityCoverage:nativeScopeMatches&&outcomes?.sources.mortalityCoverage?.status==='available'
                ?{status:'available',digest:outcomes.sources.mortalityCoverage.digest,completeMortalityTickCoverage:outcomes.sources.mortalityCoverage.value.completeMortalityTickCoverage,
                    completeLifecycleEnforcement:false}:{status:nativeScopeMatches?outcomes?.sources.mortalityCoverage?.status??'unavailable':'unavailable'},
            lifecycleAttempts:lifecycle?.status==='available'?{status:'available',digest:lifecycle.digest}:{status:lifecycle?.status??'unavailable'},
            lifecyclePolicy:lifecyclePolicy?.status==='available'?{status:'available',digest:lifecyclePolicy.digest,
                completePinnedPolicyObservations:lifecyclePolicy.value.completePinnedPolicyObservations,completeWorldPolicyEnforcement:false}
                :{status:lifecyclePolicy?.status??'unavailable'},
            policyMutations:policyMutations?.status==='available'?{status:'available',digest:policyMutations.digest,completeWorldPolicyEnforcement:false}:{status:policyMutations?.status??'unavailable'},
            lifecycleWatermarks:lifecycleWatermarks?.status==='available'?{status:'available',digest:lifecycleWatermarks.digest,
                completePostGuardCensusCoverage:lifecycleWatermarks.value.completePostGuardCensusCoverage,completeLifecycleEnforcement:false}
                :{status:lifecycleWatermarks?.status??'unavailable'},
            toolDemand:tool?.status==='available'?{status:'available',digest:tool.digest}:{status:tool?.status??'unavailable'}},
        limitations:['Missing native scope, denominators or integrity proofs never become zero or PASS.',
            'Partial count/duration certificates use one-sided bounds; observed failure survives unrelated missing sources.',
            'Founder deaths bound survival from above; absent deaths or wall heartbeat do not establish continuous mortality coverage.',
            'Complete needs/food/housing/capacity histories and seven positive native integrity gate paths remain incomplete.']};
    return{...body,digest:digest(body)};
}
