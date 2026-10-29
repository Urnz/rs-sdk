import type {SocietyMinimumContract} from '../society-minimum/contract.js';
import {minimumAssessmentLayout,type MinimumFrame} from '../society-minimum/assessment.js';
import {assessMinimumSourceCoverage,minimumCoverageBinding,type MinimumSourceCoverageProof} from '../society-minimum/source-coverage.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import type {reportNativeOutcomes} from './native-outcomes.js';
import type {reportNativeIntegration} from './integration-report.js';
import {minimumHistoryDeathsMatch} from './minimum-history.js';

/** Derive facts from existing verified backend readers. No proof or path is accepted from the report query. */
export function projectNativeSourceCoverage(contract:SocietyMinimumContract,frame:MinimumFrame,
    outcomes:ReturnType<typeof reportNativeOutcomes>|null,integration?:ReturnType<typeof reportNativeIntegration>|null){
    let bindingDigest='',frameValid=false;try{minimumAssessmentLayout(contract,frame);bindingDigest=minimumCoverageBinding(frame);frameValid=true;}catch{/* The core redacts invalid frames. */}
    const proofs:MinimumSourceCoverageProof[]=[],actors=Array.isArray(frame.founderAgentIds)?frame.founderAgentIds:[];
    const scopeMatches=(scope:unknown)=>digest(scope)===digest({clockId:frame.clockId,clockProfileDigest:frame.clockProfileDigest,
        fromSimulationTime:frame.fromSimulationTime,toSimulationTime:frame.toSimulationTime,actorAgentIds:[...actors].sort()});
    const native=frameValid&&outcomes&&outcomes.worldId===frame.worldId&&scopeMatches(outcomes.scope)?outcomes:null,
        integrated=native&&integration&&integration.worldId===frame.worldId&&scopeMatches(integration.scope)?integration:null;
    const add=(sourceId:string,sources:Array<{status:string;digest?:string}|null|undefined>,complete:boolean,gaps:string[],head?:unknown,boundaryTimes?:string[])=>{
        const available=sources.filter(s=>s?.status==='available'&&typeof s.digest==='string'),evidenceDigests=[...new Set(available.map(s=>s!.digest!))];
        const status=sources.some(s=>s?.status==='invalid')?'invalid':available.length!==sources.length||!sources.length?'unavailable':complete?'complete':'partial';
        proofs.push({sourceId,bindingDigest,status,actorAgentIds:actors,headDigest:available.length?digest(head??evidenceDigests):null,evidenceDigests,
            intervals:complete?[{from:frame.genesisAppliedAtSimulationTime,to:frame.toSimulationTime}]:[],
            ...(sourceId==='applied-genesis'?{openingAt:frame.genesisAppliedAtSimulationTime}:{}),...(boundaryTimes?{boundaryTimes}:{}),gaps:status==='complete'?[]:gaps});
    };
    const s=native?.sources,p=s?.populationBaseline,d=s?.populationDeaths,o=s?.genesisOpening;
    const original=p?.status==='available'&&d?.status==='available'&&p.value.clockId===frame.clockId&&p.value.clockProfileDigest===frame.clockProfileDigest
        &&p.value.worldId===frame.worldId&&p.value.genesisAppliedAtSimulationTime===frame.genesisAppliedAtSimulationTime
        &&contract.dependencies.worlds.some(w=>w.profile.digest===p.value.worldProfile.digest&&w.lifecyclePolicy.digest===p.value.lifecyclePolicy.digest)
        &&digest(p.value.founders.map(a=>a.agentId).sort())===digest([...actors].sort())
        &&digest(d.value.founderBindings.map(a=>a.actorId).sort())===digest([...actors].sort());
    add('applied-genesis',[p,o],!!original&&o?.status==='available'&&o.value.completeOpeningSources&&scopeMatches(o.value.scope)
        &&o.value.worldId===frame.worldId&&o.value.at===frame.genesisAppliedAtSimulationTime
        &&p?.status==='available'&&o.value.genesisResultId===p.value.genesisResultId&&o.value.genesisResultDigest===p.value.genesisResultDigest,
        ['native-opening-not-verified']);
    add('original-population',[p,d],!!original,['original-cohort-not-bound']);
    const lifecycle=s?.lifecycleEnforcement,fullLifecycle=!!original&&lifecycle?.status==='available'&&lifecycle.value.completeLifecycleEnforcement
        &&scopeMatches(lifecycle.value.scope)&&lifecycle.value.worldId===frame.worldId&&lifecycle.value.fromSimulationTime===frame.genesisAppliedAtSimulationTime
        &&lifecycle.value.toSimulationTime===frame.toSimulationTime;
    add('native-health-deaths',[d,lifecycle],!!fullLifecycle&&lifecycle?.status==='available'&&lifecycle.value.completeNativeHealthCoverage,
        ['native-hp-death-window-unproven'],lifecycle?.status==='available'?lifecycle.value.healthSnapshotDigest:undefined);
    const m=s?.mortalityCoverage;
    add('native-mortality-passes',[m],!!original&&m?.status==='available'&&m.value.completeMortalityTickCoverage
        &&scopeMatches(m.value.scope)&&m.value.worldId===frame.worldId&&!!m.value.sourceHead
        &&m.value.fromSimulationTime===frame.genesisAppliedAtSimulationTime&&m.value.toSimulationTime===frame.toSimulationTime,
        ['native-mortality-window-incomplete'],m?.status==='available'?m.value.sourceHead:undefined);
    add('login-respawn-enforcement',[lifecycle],!!fullLifecycle,['lifecycle-route-coverage-unproven'],lifecycle?.status==='available'?
        {attempt:lifecycle.value.attemptHead,census:lifecycle.value.censusHead}:undefined);
    const policy=s?.worldPolicy;
    add('clock-world-policy',[policy],!!original&&policy?.status==='available'&&policy.value.completeWorldPolicyCoverage
        &&scopeMatches(policy.value.scope)&&policy.value.worldId===frame.worldId&&policy.value.fromSimulationTime===frame.genesisAppliedAtSimulationTime
        &&policy.value.toSimulationTime===frame.toSimulationTime,['complete-policy-writer-history-unproven'],policy?.status==='available'?
        {policy:policy.value.policyHead,mutation:policy.value.mutationHead,runtime:policy.value.runtimeHead}:undefined);
    const i=integrated?.sources;
    const history=integrated?.minimumHistory,h=history&&original&&p?.status==='available'&&d?.status==='available'
        &&history.contractDigest===contract.digest&&history.worldId===frame.worldId&&scopeMatches(history.scope)
        &&history.fromSimulationTime===frame.genesisAppliedAtSimulationTime&&history.toSimulationTime===frame.toSimulationTime
        &&digest(history.fullScope)===digest({...history.scope,fromSimulationTime:frame.genesisAppliedAtSimulationTime})
        &&history.genesisResultId===p.value.genesisResultId&&history.genesisResultDigest===p.value.genesisResultDigest
        &&history.founderDigest===digest(d.value.founderBindings)&&digest(history.founderAgentIds)===digest([...actors].sort())?history:null;
    const lineage=s?.internalLineage,fullLineage=!!original&&lineage?.status==='available'&&scopeMatches(lineage.value.scope)&&lineage.value.worldId===frame.worldId
        &&lineage.value.fromSimulationTime===frame.genesisAppliedAtSimulationTime&&lineage.value.toSimulationTime===frame.toSimulationTime&&p?.status==='available'
        &&lineage.value.genesisResultId===p.value.genesisResultId&&lineage.value.genesisResultDigest===p.value.genesisResultDigest;
    add('physiology-modes',h?[h.sources.needs,h.sources.modes,h.sources.nutrition]:[i?.needs,i?.modes,i?.nutrition],!!h?.completePhysiologyCoverage,['warmup-physiology-denominators-unproven'],h?.exposureDigest);
    add('native-food-lineage',[lineage],!!fullLineage&&lineage?.status==='available'&&lineage.value.completeFoodLineageCoverage,['full-window-food-ancestry-unproven'],lineage?.status==='available'?lineage.value.sourceHead:undefined);
    add('frozen-physical-boundaries',h?[h.sources.foodBoundaries,h.sources.housingAccess,h.sources.toolBoundaries]:[i?.foodBoundaries,i?.housingAccess,i?.toolBoundaries],
        !!h?.completePhysicalBoundaries&&d?.status==='available'&&minimumHistoryDeathsMatch(h,d.value.deaths),['complete-native-boundary-inventory-unproven'],h?.sourceDigest,h?.boundaryTimes);
    add('housing-rights',h?[h.sources.housingAccess]:[i?.housingAccess],!!h?.completeHousingCoverage,['warmup-access-history-unproven'],h?.housingDigest);
    const maintenance=s?.toolMaintenance;
    add('tool-lifecycle-work',[lineage],!!fullLineage&&lineage?.status==='available'&&lineage.value.completeToolLineageCoverage,['full-window-tool-work-coverage-unproven'],lineage?.status==='available'?lineage.value.sourceHead:undefined);
    add('tool-material-custody',[lineage],!!fullLineage&&lineage?.status==='available'&&lineage.value.completeToolLineageCoverage,['complete-material-custody-history-unproven'],lineage?.status==='available'?lineage.value.sourceHead:undefined);
    const demand=s?.minimumDemandHistory;
    add('executor-native-demand',[demand??s?.toolDemand],!!original&&demand?.status==='available'&&demand.value.worldId===frame.worldId
        &&digest(demand.value.scope)===digest({...native!.scope,fromSimulationTime:frame.genesisAppliedAtSimulationTime})
        &&demand.value.cohortCoverage.completeDemandCoverage,['warmup-request-history-unproven'],demand?.status==='available'?demand.value.sourceHead:undefined);
    const custodyFlows=!!fullLineage&&lineage?.status==='available'&&lineage.value.completeFoodLineageCoverage&&lineage.value.completeToolLineageCoverage
        &&s?.administrativeValue?.status==='available'&&s.administrativeValue.value.completeAdministrativeValueCoverage
        &&scopeMatches(s.administrativeValue.value.scope)&&s.administrativeValue.value.fromSimulationTime===frame.genesisAppliedAtSimulationTime
        &&s.administrativeValue.value.toSimulationTime===frame.toSimulationTime&&s.administrativeValue.value.worldId===frame.worldId
        &&p?.status==='available'&&s.administrativeValue.value.genesisResultId===p.value.genesisResultId&&s.administrativeValue.value.genesisResultDigest===p.value.genesisResultDigest
        &&s?.externalValue?.status==='available'&&s.externalValue.value.completeExternalValueCoverage&&scopeMatches(s.externalValue.value.scope)
        &&s.externalValue.value.fromSimulationTime===frame.genesisAppliedAtSimulationTime&&s.externalValue.value.toSimulationTime===frame.toSimulationTime
        &&s.externalValue.value.worldId===frame.worldId&&s.externalValue.value.genesisResultId===p.value.genesisResultId&&s.externalValue.value.genesisResultDigest===p.value.genesisResultDigest;
    add('business-treasury-custody',h?[h.sources.wealthBoundaries,lineage,s?.administrativeValue,s?.externalValue]:[i?.currentAssets,i?.custody],
        !!h?.completeCustodyBoundaries&&custodyFlows&&d?.status==='available'&&minimumHistoryDeathsMatch(h,d.value.deaths),['historical-custody-access-unproven'],h?.sourceDigest);
    const administrative=s?.administrativeValue;
    add('administrative-value-history',[administrative],!!original&&administrative?.status==='available'&&administrative.value.completeAdministrativeValueCoverage
        &&scopeMatches(administrative.value.scope)&&administrative.value.worldId===frame.worldId&&administrative.value.fromSimulationTime===frame.genesisAppliedAtSimulationTime
        &&administrative.value.toSimulationTime===frame.toSimulationTime&&p?.status==='available'&&administrative.value.genesisResultId===p.value.genesisResultId
        &&administrative.value.genesisResultDigest===p.value.genesisResultDigest,['administrative-value-producer-coverage-unproven'],administrative?.status==='available'?
        {head:administrative.value.sourceHead,state:administrative.value.stateDigest}:undefined);
    const external=s?.externalValue;
    add('external-shop-import-history',[external],!!original&&external?.status==='available'&&external.value.completeExternalValueCoverage
        &&scopeMatches(external.value.scope)&&external.value.worldId===frame.worldId&&external.value.fromSimulationTime===frame.genesisAppliedAtSimulationTime
        &&external.value.toSimulationTime===frame.toSimulationTime&&p?.status==='available'&&external.value.genesisResultId===p.value.genesisResultId
        &&external.value.genesisResultDigest===p.value.genesisResultDigest,['external-value-producer-coverage-unproven'],external?.status==='available'?external.value.sourceHeads:undefined);
    const coverage=assessMinimumSourceCoverage(contract,frame,proofs);
    const dependencies:Record<string,string[]>={
        'native-health-deaths':['P2-05','P2-09'],'native-mortality-passes':['P2-05'],'login-respawn-enforcement':['P2-05'],
        'clock-world-policy':['P2-04'],'physiology-modes':['P2-10'],'native-food-lineage':['P2-08','P2-10'],
        'frozen-physical-boundaries':['P2-10'],'housing-rights':['P2-10'],'tool-lifecycle-work':['P2-08'],
        'tool-material-custody':['P2-08'],'executor-native-demand':['P2-10'],'business-treasury-custody':['P2-10'],
        'administrative-value-history':['P2-06'],'external-shop-import-history':['P2-07']};
    const {digest:priorDigest,...body}=coverage;
    const report={...body,remainingImplementationDependencies:coverage.rows.filter(r=>r.status!=='complete'&&dependencies[r.sourceId])
        .map(r=>({sourceId:r.sourceId,closureIds:dependencies[r.sourceId]!})),
        meaning:coverage.meaning+' Native producers which still declare incomplete coverage stay partial; dependency IDs refer to the existing fixed closure list.'};
    return{...report,digest:digest(report)};
}
