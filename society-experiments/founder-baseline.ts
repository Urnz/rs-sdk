import {inspectPackedFounderBeds} from './packed-housing-sites.js';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {validateIntegrationFixture,integrationGenesis,operationalSkillDigest,type IntegrationFixture} from '../society-integration/fixture.js';
import {resolveAdminSkill} from '../server/gateway/admin/skill-catalog.js';
import {nativeHousingCatalogs} from '../housing/native-rent.js';
import {withIntegrationSites} from '../society-integration/native-sites.js';
import {nativeToolCatalog,nativeToolCycles} from '../item-lifecycle/native-tool.js';
import {nativeRepairPolicy,TOOL_WORK_SKILLS} from '../production-workflow/native-tool-work-policy.js';
import {loadSocietyMinimumContract} from '../society-minimum/contract.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import {buildWorldGenesisConfiguration,buildWorldGenesisResult,businessGenesisInventoryDigest,loadWorldGenesisProfileCatalog,type GenesisAssetAllocation} from '../world-genesis/index.js';

/** Readonly, source-bound specification. It cannot install assets, publish procedures,
 * select a world, enroll actors or authorize an experiment. A missing physical site
 * or reviewed procedure remains a named blocker rather than a fabricated grant.
 */
export async function inspectCommonFounderBaseline(root:string,input:IntegrationFixture){
    const fixture=validateIntegrationFixture(input),contract=loadSocietyMinimumContract(join(root,'config')),
        minerId=fixture.kitchen.courierAgentId,workshopId='si-c07-workshop',propertyId='varrock.east-workshop',
        tool=nativeToolCatalog.items.find(i=>i.lifecycleTypeId==='bronze-pickaxe')!,cycle=nativeToolCycles.cycles.find(c=>c.lifecycleTypeId===tool.lifecycleTypeId)!,
        afterRepairAndReuse=nativeRepairPolicy.restoredDurability-tool.wearPerUse,
        openingCapacity=afterRepairAndReuse*cycle.outputQuantityPerAction;
    if(afterRepairAndReuse<=0||tool.maxDurability<afterRepairAndReuse)throw Error('Native repair cannot support the proposed same-instance cycle');
    const references=[...fixture.skills.map(s=>({id:s.id,version:s.version,draftVersion:null as string|null})),
        {id:'mining.varrock-east.copper-to-bank',version:'1.0.0',draftVersion:null},
        {id:'procedure.mining.gather-tin',version:'1.0.0',draftVersion:'0.1.0'},
        {...TOOL_WORK_SKILLS.smelt,draftVersion:'0.1.0'},
        {...TOOL_WORK_SKILLS.repair,draftVersion:'0.1.0'}];
    const procedures=await Promise.all(references.map(async ref=>{
        let reviewed:{checksum:string;definitionDigest:string}|null=null;
        try{const s=await resolveAdminSkill(`${ref.id}@${ref.version}`,{catalogRoot:join(root,'agent-skills/catalog'),localRoot:join(root,'.local/agent-skills')});
            const pinned=fixture.skills.find(p=>p.id===ref.id);
            if(s.definition.status==='verified'&&s.definition.sharing.visibility==='shared'&&(!pinned||operationalSkillDigest(s.definition)===pinned.definitionDigest))
                reviewed={checksum:s.checksum,definitionDigest:operationalSkillDigest(s.definition)};
        }catch{/* Missing reviewed evidence never becomes a trusted caller-supplied pin. */}
        const sourceVersion=reviewed?ref.version:ref.draftVersion;
        const path=sourceVersion?`agent-skills/catalog/${ref.id}@${sourceVersion}.skill.json`:null;
        let candidateDefinitionDigest:string|null=null;
        if(path)try{candidateDefinitionDigest=operationalSkillDigest(JSON.parse(readFileSync(join(root,path),'utf8')));}catch{/* Exact missing draft is also visible. */}
        return{...ref,reviewed,sourcePath:path,candidateDefinitionDigest,status:reviewed?'verified' as const:'unverified' as const};
    }));
    const founders=fixture.avatars.map(a=>({...a,personalSkills:{...a.personalSkills,Mining:1,Smithing:1},
        capabilities:[...new Set([...a.capabilities,...a.agentId===minerId?['mining','smelting','tool-maintenance']:[]])],
        tools:[...a.tools,...a.agentId===minerId?[{itemId:tool.itemId,count:1},{itemId:2347,count:1}]:[]],
        requiredKnownSkills:[...new Set([...a.knownSkills,...a.agentId===minerId?references.slice(fixture.skills.length).map(s=>`${s.id}@${s.version}`):[]])]}));
    const original=integrationGenesis(root,fixture),assets:GenesisAssetAllocation[]=structuredClone((original.output as unknown as {assets:GenesisAssetAllocation[]}).assets);
    for(const [index,item] of [{itemId:tool.itemId,count:1},{itemId:2347,count:1}].entries())assets.push({allocationId:`c07-tool-${index}`,kind:'item',owner:{kind:'player',id:minerId},container:'inventory',...item,slot:null});
    assets.push({allocationId:'c07-workshop',kind:'business',owner:{kind:'player',id:fixture.kitchen.ownerAgentId},businessId:workshopId,openingCapitalGp:0,
        openingInventoryDigest:businessGenesisInventoryDigest(assets,workshopId)},
        {allocationId:'c07-workshop-title',kind:'property',owner:{kind:'business',id:workshopId},propertyId});
    const genesis=buildWorldGenesisResult(buildWorldGenesisConfiguration({seed:fixture.seed,profile:loadWorldGenesisProfileCatalog(join(root,'config/world-genesis-profiles.json')).profiles.find(p=>p.profileId===original.profile.profileId)!,worldBuild:fixture.worldBuild,
        simulationClock:original.simulationClock,parameters:{fixtureDigest:fixture.digest,commonFounderBaselineVersion:1}}),
        {assets,populationMembers:fixture.avatars.map(a=>({agentId:a.agentId,playerUsername:a.username}))},'2026-10-30T00:00:00.000Z');
    let packedSites:ReturnType<typeof inspectPackedFounderBeds>|null=null;try{packedSites=inspectPackedFounderBeds(root);}catch{/* Missing or corrupt packed content is never a physical site proof. */}
    const housing=withIntegrationSites(root,fixture,effective=>{
        const catalogs=nativeHousingCatalogs(effective),unit=catalogs.units.units.find(u=>u.housingUnitId===catalogs.native.housingUnitId)!;
        return{propertyId:fixture.housing.propertyId,ownerAgentId:fixture.housing.landlordAgentId,unitId:unit.housingUnitId,
            currentBedSlots:catalogs.native.beds,currentCapacity:unit.capacity,requiredPaidTenantSlots:founders.length-1,requiredOwnerFreeSlots:1,
            requiredCapacity:founders.length,missingConfiguredSlots:Math.max(0,founders.length-unit.capacity),
            missingPhysicalSlots:Math.max(0,founders.length-(packedSites?.proposedBeds.length??unit.capacity)),packedSiteProposal:packedSites,
            catalogsDigest:digest(catalogs),proposedAdditionalCoordinates:packedSites?.proposedBeds??null,
            meaning:'Every founder requires simultaneous capacity-backed legal access. Existing two packed beds cannot silently become four rights.'};
    });
    if(!fixture.survival)throw Error('Common founder candidate requires the explicit day-survival fixture');
    const openingPortions=founders.reduce((n,a)=>n+a.cookedReserve,fixture.kitchen.cookedOpening),simulationDays=
        (contract.policy.window.warmupSimulationMilliseconds+contract.policy.window.evaluationSimulationMilliseconds)/86400000,
        nominalPortions=simulationDays*founders.length,closingReserve=founders.length,finiteCeiling=openingPortions+fixture.protocol.nativeHarvest+fixture.kitchen.rawOpening;
    const blockers=[...procedures.filter(p=>p.status!=='verified').map(p=>({id:`procedure:${p.id}`,reason:`Reviewed shared ${p.version} is absent; ${p.draftVersion??'no'} draft cannot grant runtime access.`})),
        ...housing.missingPhysicalSlots?[{id:'physical-housing-capacity',reason:`${housing.currentCapacity} actual slots; ${housing.requiredCapacity} required for three paid tenants plus the owner's free slot. A real pinned site/content decision is required.`}]:[]];
    const body={schemaVersion:1,protocol:'si-c07-common-founder-baseline-v1',fixtureDigest:fixture.digest,contractDigest:contract.digest,
        status:blockers.length?'no-go' as const:'definition-ready' as const,definitionComplete:blockers.length===0,
        installationImplemented:true,selectedWorldId:null,baselineDigest:null,liveRunStarted:false,liveStartAuthorized:false,
        providerRequestsAuthorized:0,providerCostMicrosAuthorized:0,founders,procedures,genesis,
        resourceDelta:{nativeFoodHarvest:0,bootstrapFood:0,playerGp:0,institutionGp:0,newItems:[{owner:minerId,itemId:tool.itemId,count:1},{owner:minerId,itemId:2347,count:1}],
            newBusiness:{businessId:workshopId,treasuryGp:0,propertyId},postGenesisRefill:false},
        grants:[{grantId:'si-c07-workshop-surface',businessId:workshopId,propertyId,facilityId:'varrock.east-workshop.forge',capabilityId:'work-surface',
            workerAgentId:minerId,roleDefinitionId:'business.worker.v1',requiredSkill:TOOL_WORK_SKILLS.repair,validFrom:fixture.clock.initialSimulationTime,validUntil:null}],
        toolPlan:{ownerAgentId:minerId,itemId:tool.itemId,initialDurability:tool.maxDurability,initialServiceCapacity:tool.maxDurability*cycle.outputQuantityPerAction,
            warmupRequiredSuccessfulUses:(tool.maxDurability-afterRepairAndReuse)/tool.wearPerUse,evaluationOpeningMaximumDurability:afterRepairAndReuse,
            proposedEvaluationOpeningCapacity:openingCapacity,evaluationWearActions:afterRepairAndReuse/tool.wearPerUse,
            repairInput:[{itemId:436,quantity:1},{itemId:438,quantity:1}],smeltOutput:{itemId:2349,quantity:1},repairRestoresDurability:nativeRepairPolicy.restoredDurability,
            requiredReuseActions:1,closingCapacityAfterOneCycle:openingCapacity,
            conditions:['Warmup uses must be actual prospective source-bound native actions, never a manual durability assignment.',
                'Opening capacity is measured after the original warmup, never assumed from this plan.',
                'Exact copper/tin lots must remain held through smelting and repair; bank copies cannot donate ancestry.',
                'No virgin-tool retention credit from a50-capacity repair; ratio/native travel/work validation remains separate.']},
        housing,supplyEnvelope:{nativeHarvest:fixture.protocol.nativeHarvest,openingPortions,finiteCeiling,nominalPortions,closingReserve,
            optimisticNoBurnHeadroom:finiteCeiling-nominalPortions-closingReserve,measured:false},blockers,
        limitations:['Specification only. The separate new-stage installer can apply the proposed four packed slots, verified knowledge and genesis; this readonly report does not install or select a world.',
            'No frozen source selection, ratio validation, SI-A14, provider approval or actual minimum PASS follows from this candidate.']};
    return{...body,digest:digest(body)};
}
