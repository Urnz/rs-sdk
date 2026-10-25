import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadSocietyMinimumContract } from '../society-minimum/contract.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { compileSurvivalProfile } from '../needs/survival.js';
import { validateIntegrationFixture,type IntegrationFixture } from '../society-integration/fixture.js';
import { preflightIntegrationDefinition } from '../society-integration/bootstrap.js';
const APPROVED_MINIMUM_SOURCE_SHA256='596720f42dd059b713ce0d075b08b9655d25413fdf7b31a8db1a86f3afa6754a';
const sourceHash=(root:string,path:string)=>createHash('sha256').update(readFileSync(join(root,path),'utf8').replace(/\r\n?/g,'\n')).digest('hex');

/** Readonly candidate preparation. This is neither an execution plan nor an authorization token. */
export async function inspectMinimumRunPreparation(root:string,fixture:IntegrationFixture){
    validateIntegrationFixture(fixture);
    const contract=loadSocietyMinimumContract(join(root,'config')),p=contract.policy;
    const survival=fixture.survival?compileSurvivalProfile(JSON.parse(readFileSync(join(root,'config/survival-rules.json'),'utf8')),fixture.survival.mode,fixture.seed):null;
    const definition=await preflightIntegrationDefinition(root,fixture);
    const rate=fixture.clock.profile.rate,simulationMs=p.window.warmupSimulationMilliseconds+p.window.evaluationSimulationMilliseconds;
    const nominalWallMs=Number((BigInt(simulationMs)*BigInt(rate.wallMilliseconds)+BigInt(rate.simulationMilliseconds)-1n)/BigInt(rate.simulationMilliseconds));
    const maximumSampleWallMs=Math.floor(p.window.maximumTraceGapSimulationMilliseconds*rate.wallMilliseconds/rate.simulationMilliseconds);
    const openingPortions=fixture.avatars.reduce((n,a)=>n+a.cookedReserve,fixture.kitchen.cookedOpening);
    const capacity=fixture.protocol.nativeHarvest+fixture.kitchen.rawOpening+openingPortions;
    // Finite provisioning arithmetic is an optimistic no-burn ceiling, not physiological or endogenous-supply proof.
    const nominalPortions=survival?Math.ceil(simulationMs/survival.rules.gameDaySimulationMilliseconds)*fixture.avatars.length:null;
    const closingReserve=survival?Math.ceil(p.food.minimumReserveSimulationMilliseconds/survival.rules.gameDaySimulationMilliseconds)*fixture.avatars.length:null;
    const headroom=nominalPortions===null||closingReserve===null?null:capacity-nominalPortions-closingReserve;
    const toolSkills=fixture.skills.filter(s=>/smelt|repair|mining/.test(s.id));
    const readerCoverage=contract.requirements.map(r=>({requirementId:r.requirementId,comparison:r.comparison,threshold:r.threshold,scope:r.scope,
        status:['internal-food-relief-share','tool-maintenance-cycles','tool-unusable-demand-time','productive-participants','productive-stage-kinds','inter-actor-final-use-chains'].includes(r.requirementId)?'partial-native-reader':'not-aggregated-for-minimum',
        assessedValue:null,verdict:'inconclusive'}));
    const gates=[
        {id:'unchanged-minimum',status:sourceHash(root,'config/society-minimum-policy.json')===APPROVED_MINIMUM_SOURCE_SHA256?'passed':'blocked',
            reason:'Exact original minimum source is pinned; any threshold/window/reference edit requires review, not automatic acceptance.'},
        {id:'verified-procedures',status:definition.executableSkillsReady?'passed':'blocked',reason:definition.errors.join('; ')||'Exact existing fixture procedures are verified.'},
        {id:'finite-food-envelope',status:'unverified',
            reason:`No-burn provisioning headroom ${headroom??'unknown'} portions after nominal demand and closing reserve; actual burn, origin, reserve and demand require native evidence.`},
        {id:'tool-chain-baseline',status:toolSkills.length?'unverified':'blocked',reason:'Existing food/travel fixture does not bind an approved native Mining→smelt→repair→reuse chain to its founders and initial service capacity.'},
        {id:'minimum-assessor',status:'blocked',reason:'A proven native tool-demand violation can now surface FAIL;17 scoped rules and8 integrity gates still need the complete source-backed assessment bridge.'},
        {id:'tool-unusable-demand-coverage',status:'blocked',reason:'Exact executor→SDK→typed native dispatch and selected-cohort raw Mining rejection are implemented. Complete high-level request denominators and a selected C07 watermark are still unproven; an empty queue or idle/offline cannot establish zero demand.'},
        {id:'legal-housing-exposure',status:'unverified',reason:'Two tenant slots and current rent/sleep receipts do not attest95% legal housing access for every founder; full ownership/access history is required.'},
        {id:'clock-ratio',status:rate.simulationMilliseconds===rate.wallMilliseconds?'unverified':'blocked',reason:'Accelerated needs exposure must be validated against actual content ticks, work credit, travel, harvest and meal timing before reuse.'},
        {id:'selected-baseline',status:'unverified',reason:'No active world selected, frozen founder roster or exact expanded baseline/result pin prepared for C07.'},
        {id:'native-regression',status:'unverified',reason:'Exact SI-A14 regression belongs after the cheap NO-GO blockers are resolved, before an approved long run.'},
        {id:'run-approval-and-budget',status:'unapproved',reason:'No new long-run/provider authority; B06 permission is scoped to its earlier trial.'}
    ];
    const sourcePaths=['society-minimum/contract.ts','config/society-minimum-policy.json','config/survival-rules.json','needs/survival.ts',
        'society-metrics/integration-report.ts','society-metrics/evaluation-report.ts','society-metrics/outcome-work.ts',
        'server/engine/src/mods/NativeMiningTool.ts','item-lifecycle/native-mining-demand.ts','society-metrics/tool-demand.ts',
        'society-metrics/native-outcomes.ts','society-experiments/benchmark-report.ts','society-experiments/expanded-baseline.ts',
        'item-lifecycle/native-mining-intent.ts','server/engine/src/mods/NativeMiningIntent.ts','server/engine/src/mods/NativeMiningIntentRuntime.ts',
        'server/engine/src/engine/World.ts','society-metrics/tool-demand-intervals.ts',
        'item-lifecycle/native-mining-coverage.ts','society-metrics/tool-demand-coverage.ts','server/engine/src/mods/NativeMiningCoverage.ts',
        'server/engine/src/mods/PopulationDeathRuntime.ts',
        'sdk/mining-demand.ts','sdk/index.ts','sdk/types.ts','agent-skills/mining-admission.ts','agent-skills/mining-demand-source.ts',
        'sdk/mining-interaction.ts','sdk/actions.ts','agent-skills/mining-interaction-source.ts','item-lifecycle/native-mining-dispatch.ts',
        'server/engine/src/mods/NativeMiningInteraction.ts','server/engine/src/engine/script/ScriptState.ts','server/gateway/admin/native-mining-interaction.ts',
        'agent-skills/mining-gather.ts','agent-skills/executor.ts','agent-skills/run.ts','agent-skills/types.ts','agent-skills/rs-sdk-runtime.ts',
        'server/gateway/admin/native-mining-demand.ts','server/gateway/gateway.ts','server/engine/src/web/pages/internal-admin.ts',
        'society-experiments/minimum-preflight.ts',...fixture.skills.map(s=>`agent-skills/catalog/${s.id}@${s.version}.skill.json`)];
    const sources=sourcePaths.map(path=>({path,sha256:sourceHash(root,path)}));
    const body={protocol:'si-c07-minimum-run-preparation-v1',scope:'readonly-definition-and-capability-preflight',status:'no-go',
        liveRunStarted:false,liveStartAuthorized:false,readyForRunApproval:false,minimumVerdict:'inconclusive',
        fixtureId:fixture.fixtureId,fixtureDigest:fixture.digest,fixtureVersion:fixture.version,
        contractDigest:contract.digest,requirementsDigest:digest(contract.requirements),requiredIntegrityGates:p.integrityGates,
        candidate:{warmupSimulationMs:p.window.warmupSimulationMilliseconds,evaluationSimulationMs:p.window.evaluationSimulationMilliseconds,
            bucketSimulationMs:p.window.bucketSimulationMilliseconds,rate,nominalWallMs,maximumSampleWallMs,
            proposedSampleWallMs:Math.min(5000,maximumSampleWallMs),proposedExecutionWallCeilingMs:nominalWallMs+600000,
            clockRatioValidationRequired:true,proposedBaselineCaptureWallCeilingMs:1200000,proposedResultCaptureWallCeilingMs:1200000,
            proposedResultRestoreWallCeilingMs:1500000,
            providerRequestsAuthorized:0,providerCostMicrosAuthorized:0,selectedWorldId:null,baselineDigest:null,
            stopConditions:['Source/profile/contract drift','Native source gap or absent required denominator','Clock-rate validation failure',
                'Native uncertainty, unauthorized value or external import','Timeout, cost/request cap, authority expiry or operator stop',
                'Founder death or proven original minimum violation; retain FAIL evidence, do not lower thresholds']},
        supplyEnvelope:{maximumFinitePortions:capacity,nominalEightDayPortions:nominalPortions,nominalClosingReserve:closingReserve,
            optimisticNoBurnHeadroom:headroom,notAnAssessment:true},readerCoverage,gates,sources,
        nextActions:['Complete the native minimum assessment and missing demand/access history before requesting a run.',
            'Prepare a complete native-tool/food/housing founder baseline with unchanged acceptance thresholds.',
            'Validate the chosen clock ratio; bind all authoritative sources through the expanded baseline.',
            'Run SI-A14 and present a concrete eligible run/model/budget/stop plan for separate approval.']};
    return{...body,digest:digest(body)};
}
