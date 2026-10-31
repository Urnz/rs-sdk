import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,relative} from 'node:path';
import {loadIntegrationFixture,integrationWorldId} from '../society-integration/fixture.js';
import {readIntegrationBaseline} from '../society-integration/bootstrap.js';
import {verifyNativeIntegrationSeal} from '../society-integration/baseline.js';
import {readFounderStageReceipt} from './founder-stage.js';
import {nativeHousingCatalogs,readRentJournal,type NativeRentOrder} from '../housing/native-rent.js';
import {readOwnerBedReservations} from '../housing/native-owner.js';
import {OwnedDatabase} from '../server/engine/src/io/OwnedDatabase.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import {managedContext} from '../server/control-plane/instance-context.js';
import type {BotSDK} from '../sdk/index.js';

export const FOUNDER_HOUSING_LIMITS={maximumWallMs:480000,travelMs:360000,bedMs:30000,readinessMs:60000} as const;
export function checkHousing(v:unknown,message:string):asserts v{if(!v)throw Error(message);}
export function founderHousingParentEnvironment(env:Record<string,string|undefined>){
    const values=Object.fromEntries(['CONTROL_PLANE_SERVER_ID','MANAGED_WORKSPACE','ENGINE_ADMIN_URL','GATEWAY_URL','ENGINE_ADMIN_TOKEN'].map(k=>[k,env[k]]));
    checkHousing(managedContext(values)&&values.ENGINE_ADMIN_TOKEN,'Housing parent needs the complete exact managed binding');
    return values;
}
export async function reachableFounderBedApproach(bed:{x:number;z:number;level:number},from:{x:number;z:number;level:number},
    probe:(x:number,z:number)=>Promise<boolean>){
    checkHousing(from.level===bed.level,'Founder must reach the bed floor before its final approach');
    const candidates:{x:number;z:number;level:number}[]=[];
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if(dx||dz)candidates.push({x:bed.x+dx,z:bed.z+dz,level:bed.level});
    candidates.sort((a,b)=>Math.hypot(a.x-from.x,a.z-from.z)-Math.hypot(b.x-from.x,b.z-from.z)||a.x-b.x||a.z-b.z);
    for(const target of candidates){
        if(target.x===from.x&&target.z===from.z||await probe(target.x,target.z))return target;
    }
    throw Error('No completely reachable adjacent founder bed tile');
}
/** A transient crossing of the target is not a stopped native avatar. */
export async function settleFounderBedApproach(sdk:Pick<BotSDK,'sendWalk'|'waitForTicks'|'getState'|'getStateAge'>,
    target:{x:number;z:number;level:number},lifeId:number|undefined){
    const stopped=await sdk.sendWalk(target.x,target.z,true);
    checkHousing(stopped.success,'Final founder stop command was rejected');
    const observed=[];let previous=sdk.getState()?.tick??-1;
    for(let i=0;i<3;i++){
        await sdk.waitForTicks(1);const state=sdk.getState(),p=state?.player;
        checkHousing(state&&p&&state.tick>previous&&sdk.getStateAge()<5000&&!p.isDead&&p.hp>0&&p.lifeId===lifeId
            &&p.level===target.level&&p.worldX===target.x&&p.worldZ===target.z,'Founder did not remain stopped at its exact bed approach');
        previous=state.tick;observed.push({tick:state.tick,x:p.worldX,z:p.worldZ,level:p.level});
    }
    return observed;
}
export function founderHousingAssignments(fixture:ReturnType<typeof loadIntegrationFixture>){
    checkHousing(fixture.founderBaseline&&fixture.avatars.length===4,'Housing trial requires the common four-founder definition');
    const beds=fixture.founderBaseline.beds,owner=fixture.housing.landlordAgentId;
    checkHousing(beds.length===4&&new Set(beds.map(b=>`${b.x},${b.z},${b.level}`)).size===4,'Housing trial requires four distinct physical beds');
    let paid=1;return fixture.avatars.map(a=>({agentId:a.agentId,username:a.username,kind:a.agentId===owner?'owner' as const:'paid' as const,
        bed:beds[a.agentId===owner?0:paid++]!,opening:a.position,openingGp:a.coinsGp,
        expectedFareGp:a.position.x>=2700&&a.position.x<3000&&a.position.z>=2900&&a.position.z<3200?30:0}));
}
export function inspectFreshFounderHousing(workspace:string,repository:string){
    const root=resolve(workspace),repo=resolve(repository);
    checkHousing(root!==repo&&relative(repo,root).replaceAll('\\','/').startsWith('backups/'),'Housing trial requires its own backups workspace');
    const fixture=loadIntegrationFixture(join(root,'config/fixtures/society-lobster-four-v1.json'));
    checkHousing(fixture.version==='1.4.0'&&fixture.founderBaseline,'Housing trial requires a fresh common founder stage');
    const receipt=readIntegrationBaseline(root,fixture),seal=verifyNativeIntegrationSeal(root,fixture),setup=readFounderStageReceipt(root),
        source=JSON.parse(readFileSync(join(root,'.local/simulation/integration-source.json'),'utf8'));
    checkHousing(source.sourceProfile==='packed-founder-stage-v1'&&source.finalBaselineEligible===false&&source.digest===digest(source.files),
        'Housing trial source profile/manifest differs');
    for(const path of ['housing/native-owner.ts','scripts/run-founder-housing.ts','scripts/founder-housing-client.ts','society-experiments/founder-housing-result.ts'])
        checkHousing(source.files.some((f:{path:string})=>f.path===path),'Housing stage predates its exact runner/owner source');
    for(const f of source.files)checkHousing(createHash('sha256').update(readFileSync(join(root,f.path))).digest('hex')===f.sha256,`Housing source drift: ${f.path}`);
    const config=JSON.parse(readFileSync(join(root,'config/llm-runtime.json'),'utf8'));
    checkHousing(!config.enabled&&!config.automaticReplanning&&!config.autonomousExecution.enabled&&!config.skillBuilder.enabled&&config.dailyBudget.maxCostMicros===0,
        'Housing trial requires provider/autonomy/builder off');
    checkHousing(receipt.worldId===integrationWorldId(fixture)&&setup.worldId===receipt.worldId&&setup.fixtureDigest===fixture.digest,'Housing source identities differ');
    for(const p of ['.local/simulation/founder-housing-live.json','.local/simulation/founder-housing-bed-diagnostic.json','.local/agent-skills/runs'])checkHousing(!existsSync(join(root,p)),`Earlier housing/run state must be reconciled: ${p}`);
    const db=new OwnedDatabase(join(root,'.local/economy/housing.sqlite'),{readonly:true,strict:true});try{
        checkHousing(readRentJournal<NativeRentOrder>(db,'housing_native').length===0&&readOwnerBedReservations(db).length===0
            &&(db.query('SELECT COUNT(*) n FROM housing_tenancy').get() as {n:number}).n===0,'Housing trial already has reservations');
    }finally{db.close(true);}
    const catalogs=nativeHousingCatalogs(root),assignments=founderHousingAssignments(fixture);
    checkHousing(digest(catalogs.native.beds)===digest(fixture.founderBaseline!.beds),'Housing stage bed mapping changed');
    return{root,fixture,receipt,sealDigest:seal.digest,setupDigest:setup.digest,sourceManifestDigest:source.digest,inputSourceDigest:source.inputSourceDigest,assignments};
}
