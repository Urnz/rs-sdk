import {expect,test} from 'bun:test';
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {inspectCommonFounderBaseline} from '../founder-baseline.js';
import {loadIntegrationFixture} from '../../society-integration/fixture.js';
import {validateWorldGenesisResult} from '../../world-genesis/result.js';
import {societyMinimumDigest as digest} from '../../society-minimum/policy.js';
import {validateSkillDefinition} from '../../agent-skills/validation.js';
const root=resolve(import.meta.dir,'../..'),fixture=loadIntegrationFixture(join(root,'config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json'));

test('common baseline composes the same four founders and a real genesis allocation without increasing food, money or harvest',async()=>{
    const before=structuredClone(fixture),r=await inspectCommonFounderBaseline(root,fixture);
    expect(fixture).toEqual(before);expect(r.founders.map(a=>a.agentId)).toEqual(fixture.avatars.map(a=>a.agentId));
    expect(r.resourceDelta).toMatchObject({nativeFoodHarvest:0,bootstrapFood:0,playerGp:0,institutionGp:0,postGenesisRefill:false});
    expect(r.supplyEnvelope).toMatchObject({nativeHarvest:32,openingPortions:4,finiteCeiling:36,nominalPortions:32,closingReserve:4,optimisticNoBurnHeadroom:0,measured:false});
    expect(validateWorldGenesisResult(r.genesis)).toEqual(r.genesis);
    expect(r.founders.find(a=>a.agentId===fixture.kitchen.courierAgentId)).toMatchObject({personalSkills:{Mining:1,Smithing:1}});
    expect(r.grants[0]).toMatchObject({workerAgentId:fixture.kitchen.courierAgentId,businessId:'si-c07-workshop',capabilityId:'work-surface'});
});

test('a virgin100 tool is not certified by a50 repair: warmup51 genuine uses, exact49 evaluation opening, repair and reuse need actual future evidence',async()=>{
    const r=await inspectCommonFounderBaseline(root,fixture);
    expect(r.toolPlan).toMatchObject({initialDurability:100,initialServiceCapacity:100,warmupRequiredSuccessfulUses:51,
        evaluationOpeningMaximumDurability:49,proposedEvaluationOpeningCapacity:49,evaluationWearActions:49,repairRestoresDurability:50,requiredReuseActions:1,closingCapacityAfterOneCycle:49});
    expect(r.toolPlan.conditions.some(s=>s.includes('never a manual durability'))).toBeTrue();
    expect(r.toolPlan.repairInput).toEqual([{itemId:436,quantity:1},{itemId:438,quantity:1}]);
    expect(r.selectedWorldId).toBeNull();expect(r.baselineDigest).toBeNull();
});

test('four existing packed anchors are proposed explicitly; two configured slots never become four installed entitlements',async()=>{
    const r=await inspectCommonFounderBaseline(root,fixture);
    expect(r.housing).toMatchObject({currentCapacity:2,requiredPaidTenantSlots:3,requiredOwnerFreeSlots:1,requiredCapacity:4,missingConfiguredSlots:2,missingPhysicalSlots:0});
    expect(r.housing.currentBedSlots).toHaveLength(2);expect(r.housing.packedSiteProposal?.proposedBeds).toHaveLength(4);
    expect(r.housing.packedSiteProposal?.sources.every(s=>/^[a-f0-9]{64}$/.test(s.sha256))).toBeTrue();
    expect(r.blockers.some(b=>b.id==='physical-housing-capacity')).toBeFalse();
    expect(r.definitionComplete).toBeFalse();expect(r.installationImplemented).toBeFalse();
});

test('draft procedures never become verified pins or actual access grants and the new tin procedure stays bounded',async()=>{
    const r=await inspectCommonFounderBaseline(root,fixture),unverified=r.procedures.filter(p=>p.status==='unverified');
    expect(unverified.map(p=>p.id).sort()).toEqual(['procedure.metallurgy.smelt-bronze','procedure.mining.gather-tin','procedure.tools.repair-bronze-pickaxe']);
    expect(unverified.every(p=>p.reviewed===null&&p.draftVersion==='0.1.0'&&p.candidateDefinitionDigest!==null)).toBeTrue();
    const draft=validateSkillDefinition(JSON.parse(readFileSync(join(root,'agent-skills/catalog/procedure.mining.gather-tin@0.1.0.skill.json'),'utf8')));
    expect(draft.status).toBe('draft');expect(draft.limits.maxOperations).toBe(2);
    expect(draft.steps.filter(s=>s.kind==='operation').map(s=>s.operation)).toEqual(['walk-to','gather-loc']);
});

test('candidate generation is deterministic, digest bound, readonly and does not select a world or authorize a provider',async()=>{
    const fpath=join(root,'config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json'),before=readFileSync(fpath),stageExisted=existsSync(join(root,'.local/society-c07-common-baseline')),
        r=await inspectCommonFounderBaseline(root,fixture),again=await inspectCommonFounderBaseline(root,fixture),{digest:hash,...body}=r;
    expect(again).toEqual(r);expect(digest(body)).toBe(hash);expect(readFileSync(fpath)).toEqual(before);
    expect(r).toMatchObject({status:'no-go',liveRunStarted:false,liveStartAuthorized:false,providerRequestsAuthorized:0,providerCostMicrosAuthorized:0});
    expect(existsSync(join(root,'.local/society-c07-common-baseline'))).toBe(stageExisted);
});

test('foreign or reduced founder definitions cannot be silently rebound into the original baseline',async()=>{
    const changed=structuredClone(fixture);changed.avatars.pop();
    await expect(inspectCommonFounderBaseline(root,changed)).rejects.toThrow();
});

test('CLI returns explicit NO-GO without installing or running the candidate',async()=>{
    const child=Bun.spawn([process.execPath,join(root,'scripts/prepare-society-founder-baseline.ts')],{stdout:'pipe',stderr:'pipe'}),
        [output,error,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect(exit,error).toBe(2);const r=JSON.parse(output);expect(r.status).toBe('no-go');expect(r.liveStartAuthorized).toBeFalse();expect(r.blockers).toHaveLength(3);
});
