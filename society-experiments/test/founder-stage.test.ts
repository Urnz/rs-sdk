import {beforeAll,expect,test} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {commonFounderStageFixture} from '../founder-stage.js';
import {fixtureDefinitionDigest,loadIntegrationFixture,integrationGenesis,validateIntegrationFixture,integrationWorldId,type IntegrationFixture} from '../../society-integration/fixture.js';
import {preflightIntegrationDefinition} from '../../society-integration/bootstrap.js';
import {stageIntegrationSites,withIntegrationSites} from '../../society-integration/native-sites.js';
import {nativeHousingCatalogs} from '../../housing/native-rent.js';
import {integrationRuntimeConfig} from '../../society-integration/runtime-config.js';
import {bootstrapIntegrationStage,bootstrapFoodTrialStage} from '../../society-integration/bootstrap.js';
import {createFounderStageWorkspace} from '../../society-integration/archive.js';
const root=resolve(import.meta.dir,'../..'),path=join(root,'config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json'),
    source=loadIntegrationFixture(path),original=readFileSync(path);
let fixture:IntegrationFixture;
beforeAll(async()=>{fixture=await commonFounderStageFixture(root,source);});

test('fresh founder definition preserves original cohort, food, money, clock and geography, with one audited genesis',()=>{
    expect(fixture.version).toBe('1.4.0');expect(fixture.founderBaseline?.sourceFixtureDigest).toBe(source.digest);
    expect(integrationWorldId(fixture)).not.toBe(integrationWorldId(source));expect(readFileSync(path)).toEqual(original);
    expect(fixture.clock).toEqual(source.clock);expect(fixture.protocol).toEqual(source.protocol);expect(fixture.kitchen).toEqual(source.kitchen);
    for(const old of source.avatars){const a=fixture.avatars.find(a=>a.agentId===old.agentId)!;
        expect([a.username,a.position,a.coinsGp,a.cookedReserve,a.personalSkills.Fishing,a.personalSkills.Cooking])
            .toEqual([old.username,old.position,old.coinsGp,old.cookedReserve,old.personalSkills.Fishing,old.personalSkills.Cooking]);}
    const miner=fixture.avatars.find(a=>a.agentId===source.kitchen.courierAgentId)!;
    expect(miner.tools).toEqual([{itemId:1265,count:1},{itemId:2347,count:1}]);
    expect(miner.personalSkills).toMatchObject({Mining:1,Smithing:1});expect(fixture.skills).toHaveLength(9);
    const genesis=integrationGenesis(root,fixture),assets=(genesis.output as any).assets;
    expect(assets.filter((a:any)=>a.kind==='currency').reduce((n:number,a:any)=>n+a.amountGp,0)).toBe(2800);
    expect(assets.filter((a:any)=>a.kind==='business').reduce((n:number,a:any)=>n+a.openingCapitalGp,0)).toBe(1000);
    expect(assets.filter((a:any)=>a.kind==='item'&&a.itemId===379).reduce((n:number,a:any)=>n+a.count,0)).toBe(4);
    expect(assets.some((a:any)=>a.kind==='item'&&[436,438,2349].includes(a.itemId))).toBeFalse();
    expect(assets.find((a:any)=>a.allocationId==='c07-workshop-title')).toMatchObject({owner:{kind:'business',id:'si-c07-workshop'},propertyId:'varrock.east-workshop'});
    expect(integrationGenesis(root,fixture)).toEqual(genesis);
});

test('canonical preflight resolves all nine real published pins; missing or stale utility skill cannot install',async()=>{
    const r=await preflightIntegrationDefinition(root,fixture);expect(r.errors).toEqual([]);expect(r.verifiedSkills).toHaveLength(9);
    const stale=structuredClone(fixture);stale.skills.find(s=>s.id==='procedure.mining.gather-tin')!.definitionDigest='a'.repeat(64);
    stale.digest=fixtureDefinitionDigest(stale);await expect(preflightIntegrationDefinition(root,stale)).rejects.toThrow('Pinned skill content differs');
    const changed=structuredClone(source);changed.avatars[0]!.coinsGp++;changed.digest=fixtureDefinitionDigest(changed);
    await expect(commonFounderStageFixture(root,changed)).rejects.toThrow('unchanged original');
});

test('four physical bed mappings require exact packed binding; old two-slot configuration stays unchanged',()=>{
    const before=readFileSync(join(root,'config/native-housing.json'));
    withIntegrationSites(root,fixture,effective=>{
        const c=nativeHousingCatalogs(effective);expect(c.units.units.find(u=>u.housingUnitId===c.native.housingUnitId)?.capacity).toBe(4);
        expect(c.native.beds).toEqual(fixture.founderBaseline!.beds);expect(new Set(c.native.beds.map(b=>`${b.x},${b.z},${b.level}`)).size).toBe(4);
        expect(()=>stageIntegrationSites(effective,fixture)).toThrow('fresh unpublished');
    });expect(readFileSync(join(root,'config/native-housing.json'))).toEqual(before);
    const bad=structuredClone(fixture);bad.founderBaseline!.beds[0]!.x++;bad.digest=fixtureDefinitionDigest(bad);
    expect(()=>withIntegrationSites(root,bad,()=>null)).toThrow('source or anchors changed');
});

test('same-owner four-slot setup still has no automatic provider/autonomy authority or fictitious lease',()=>{
    const config=integrationRuntimeConfig(fixture,JSON.parse(readFileSync(join(root,'config/llm-runtime.json'),'utf8')));
    expect(config).toMatchObject({enabled:false,automaticReplanning:false,autonomousExecution:{enabled:false},skillBuilder:{enabled:false},dailyBudget:{maxCostMicros:0}});
    expect(fixture.housing.maximumConcurrentTenants).toBe(3);
    const downgrade={...fixture,version:'1.3.0' as const};downgrade.digest=fixtureDefinitionDigest(downgrade);
    expect(()=>validateIntegrationFixture(downgrade)).toThrow('new exact versioned');
});

test('installer cannot adopt an existing world or use a forged stage capability',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'si-founder-stage-'));
    try{
        await expect(createFounderStageWorkspace({sourceRoot:root,output:join(directory,'must-not-create'),fixture:source,
            assertOffline:()=>{throw Error('Must reject the definition before probing any world');}})).rejects.toThrow('exact founder definition');
        await expect(bootstrapFoodTrialStage(directory,fixture,{} as any)).rejects.toThrow('never a draft trial');
        await expect(bootstrapIntegrationStage(directory,fixture,{} as any)).rejects.toThrow('isolated staging');
        writeFileSync(join(directory,'.integration-stage.json'),JSON.stringify({fixtureDigest:source.digest}));
        await expect(bootstrapIntegrationStage(directory,fixture,{} as any)).rejects.toThrow('isolated staging');
        writeFileSync(join(directory,'.integration-stage.json'),JSON.stringify({fixtureDigest:fixture.digest}));
        mkdirSync(join(directory,'.local/agent-state'),{recursive:true});writeFileSync(join(directory,'.local/agent-state/agents.sqlite'),'existing');
        await expect(bootstrapIntegrationStage(directory,fixture,{} as any)).rejects.toThrow('cannot be adopted or reset');
    }finally{rmSync(directory,{recursive:true,force:true});}
});
