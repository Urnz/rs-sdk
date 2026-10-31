import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {OwnedDatabase} from '../server/engine/src/io/OwnedDatabase.js';
import {loadIntegrationFixture,integrationWorldId} from '../society-integration/fixture.js';
import {checkHousing,founderHousingAssignments} from './founder-housing.js';
import {readHousingSleep,ownerSleepBinding} from '../housing/native-sleep.js';
import {NativeRentSource,readNativeRentReceipt} from '../housing/native-rent-source.js';
import {readRentJournal,type NativeRentOrder,type NativeRentReceipt} from '../housing/native-rent.js';
import {readOwnerBedReservations} from '../housing/native-owner.js';
import {parsePlayerSaveBytes} from '../server/gateway/admin/save-reader.js';
import {readNativeTravelFares} from '../server/engine/src/mods/NativeTravelFareStore.js';
import {foodDigest} from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import {playerTimeHistoryDigest} from '../simulation-clock/store.js';
import type {PlayerTimeHistoryEntry,SimulationClockObservation} from '../simulation-clock/types.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';

/** Only existing authority readers and readonly connections. SDK observations never replace native effects. */
export function readFounderHousingResult(root:string){
    const fixture=loadIntegrationFixture(join(root,'config/fixtures/society-lobster-four-v1.json')),assignments=founderHousingAssignments(fixture),
        receipt=JSON.parse(readFileSync(join(root,'.local/simulation/integration-fixture.json'),'utf8')),
        live=JSON.parse(readFileSync(join(root,'.local/simulation/founder-housing-live.json'),'utf8')),
        source=JSON.parse(readFileSync(join(root,'.local/simulation/integration-source.json'),'utf8'));
    checkHousing(live.mode==='four-founder-housing'&&live.status==='completed'&&live.cleanShutdown&&live.fixtureDigest===fixture.digest&&live.worldId===integrationWorldId(fixture)
        &&live.worldId===receipt.worldId&&live.sourceManifestDigest===source.digest&&source.digest===digest(source.files),'Housing live outcome/source binding differs');
    for(const f of source.files)checkHousing(createHash('sha256').update(readFileSync(join(root,f.path))).digest('hex')===f.sha256,`Frozen housing source changed: ${f.path}`);
    const housing={workspace:root,worldId:receipt.worldId,housingPath:join(root,'.local/economy/housing.sqlite'),propertyPath:join(root,'.local/admin/properties.sqlite'),
        checkpointPath:join(root,'server/engine/data/player-checkpoints.sqlite')},clockPath=join(root,'.local/simulation/simulation-clock.sqlite'),
        paths=[housing.housingPath,housing.propertyPath,housing.checkpointPath,clockPath,join(root,'.local/agent-state/agents.sqlite'),
            join(root,'.local/economy/institution-treasury.sqlite')],hashes=()=>paths.flatMap(path=>['','-wal'].flatMap(suffix=>{
                try{const bytes=readFileSync(path+suffix);if(suffix&&bytes.length===0)return[];
                    return[{path:path.slice(root.length+1).replaceAll('\\','/'),suffix,sha256:createHash('sha256').update(bytes).digest('hex')}];}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'&&suffix)return[];throw e;}}));
    const before=hashes(),read=<T>(path:string,fn:(db:OwnedDatabase)=>T)=>{const db=new OwnedDatabase(path,{readonly:true,strict:true});try{return fn(db);}finally{db.close(true);}},
        stamp=read(clockPath,db=>{const s=db.query('SELECT * FROM simulation_clock WHERE clock_id=?1').get(receipt.clockId) as any;
            checkHousing(s?.status==='paused'&&s.profile_digest===receipt.clockProfileDigest,'Closing housing clock must be paused/exact');
            return{clockId:s.clock_id,profileDigest:s.profile_digest,simulationTime:new Date(s.last_simulation_ms).toISOString(),wallTime:new Date(s.last_observed_wall_ms).toISOString(),
                status:'paused' as const,revision:s.revision,engineTick:null} satisfies SimulationClockObservation;});
    const domain=read(housing.housingPath,db=>({orders:readRentJournal<NativeRentOrder>(db,'housing_native'),owners:readOwnerBedReservations(db),
        tenancies:db.query('SELECT * FROM housing_tenancy').all()}));
    checkHousing(domain.orders.length===3&&domain.orders.every(o=>o.phase==='active')&&domain.owners.length===1&&domain.tenancies.length===3,'Expected three paid tenancies and one owner reservation');
    const native=read(housing.checkpointPath,db=>({sleep:readHousingSleep(db),fares:readNativeTravelFares(db),
        rent:readRentJournal<NativeRentReceipt>(db,'native_rent').map(r=>readNativeRentReceipt(db,r.binding)!),
        players:db.query('SELECT owner,save FROM accounts ORDER BY owner').all() as {owner:string;save:Uint8Array}[],
        foodActions:(db.query('SELECT COUNT(*) n FROM native_food_actions').get() as {n:number}).n,
        harvestActions:(db.query('SELECT COUNT(*) n FROM native_food_production_actions').get() as {n:number}).n,
        tools:db.query('SELECT durability,status,owner_actor_id FROM item_instance').all() as any[]}));
    checkHousing(native.sleep.length===4&&native.rent.length===3&&native.rent.every(r=>r.phase==='paid')&&native.fares.length===2&&native.players.length===4,'Closing native sources have unexpected effect counts');
    checkHousing(native.foodActions===0&&native.harvestActions===0&&native.tools.length===1&&native.tools[0].durability===100
        &&native.tools[0].status==='usable'&&native.tools[0].owner_actor_id===fixture.kitchen.courierAgentId,'Unrelated food/harvest/tool effects changed');
    const sourceReader=new NativeRentSource(housing),actors=(()=>{try{return assignments.map(a=>{
        const reservation=live.reservations.find((r:any)=>r.username===a.username),w=native.sleep.find(w=>w.operationId===reservation?.operationId&&w.username===a.username),
            binding=receipt.lifecycles.find((m:any)=>m.agentId===a.agentId)?.binding;
        checkHousing(w&&binding&&w.lifecycleId===binding.lifecycleId&&w.clock.clockId===receipt.clockId&&w.clock.profileDigest===receipt.clockProfileDigest,'Exact native founder sleep absent');
        const authority=a.kind==='owner'?sourceReader.ownerBed(w.operationId,stamp):sourceReader.entitlement(w.operationId,stamp).order.binding,
            i=authority.intent,actor='owner' in i?i.owner:i.tenant;
        checkHousing(authority.digest===w.bindingDigest&&i.bedSlotId===a.bed.bedSlotId&&i.worldId===receipt.worldId&&actor.agentId===a.agentId
            &&actor.username===a.username&&actor.lifecycleId===binding.lifecycleId,'Founder entitlement/world/lifecycle/bed differs');
        if(a.kind==='owner')checkHousing(ownerSleepBinding(w).digest===authority.digest,'Owner native proof differs');else checkHousing(!w.ownerBinding,'Paid sleep must not become owner sleep');
        const history=read(clockPath,db=>{const rows=db.query('SELECT entry_json FROM simulation_player_time_history WHERE clock_id=?1 AND player_id=?2 ORDER BY revision').all(receipt.clockId,a.username) as {entry_json:string}[];
            let previous:PlayerTimeHistoryEntry|null=null;return rows.map(row=>{const h=JSON.parse(row.entry_json) as PlayerTimeHistoryEntry,{digest:hash,...body}=h;
                checkHousing(hash===playerTimeHistoryDigest(body)&&h.previousDigest===(previous?.digest??null)&&h.profileDigest===receipt.clockProfileDigest
                    &&h.state.playerId===a.username&&h.state.clockId===receipt.clockId,'Founder PlayerTime history differs');previous=h;return h;});});
        const mode=history.at(-1)?.state;checkHousing(mode?.rest==='sleeping'&&mode.sleepContext?.access.evidenceId===`housing:${w.id}`
            &&mode.sleepContext.access.sourceDigest===foodDigest(w)&&mode.sleepContext.sleepPlaceId===a.bed.bedSlotId,'Closing founder sleep context differs');
        const row=native.players.find(p=>p.owner===a.username)!;checkHousing(row,'Founder native checkpoint absent');const save=parsePlayerSaveBytes(row.save,stamp.simulationTime,true);
        const gp=a.openingGp+(a.kind==='owner'?1500:-500)-a.expectedFareGp;
        checkHousing(save.valid&&save.coins===gp&&save.position.level===a.bed.level&&Math.max(Math.abs(save.position.x-a.bed.x),Math.abs(save.position.z-a.bed.z))<=1
            &&save.inventory.filter(i=>i.id===379).reduce((n,i)=>n+i.count,0)===1,'Closing native GP/food/physical position differs');
        checkHousing(native.fares.filter(f=>f.username===a.username).reduce((n,f)=>n+f.amountGp,0)===a.expectedFareGp,'Founder native ferry charge differs');
        if(a.kind==='paid'){const route=live.routes.find((r:any)=>r.username===a.username),run=JSON.parse(readFileSync(join(root,'.local/agent-skills/runs',`${route?.runId}.json`),'utf8'));
            checkHousing(run.status==='completed'&&run.username===a.username&&run.skill.id==='procedure.travel.native-sites'&&run.skill.version==='1.0.0'
                &&run.parameters?.site==='housing','Exact completed travel run absent');}
        return{agentId:a.agentId,username:a.username,kind:a.kind,bed:a.bed,operationId:w.operationId,witnessId:w.id,witnessDigest:foodDigest(w),
            lifecycleId:w.lifecycleId,openingGp:a.openingGp,closingGp:save.coins,fareGp:a.expectedFareGp,position:save.position,playerTimeRevision:mode.revision};
    });}finally{sourceReader.close();}})();
    checkHousing(actors.reduce((n,a)=>n+a.closingGp,0)===2740,'Housing actor GP equation differs');
    const treasury=read(join(root,'.local/economy/institution-treasury.sqlite'),db=>db.query("SELECT balance_gp,reserved_gp FROM institution_treasury WHERE actor_kind='business' AND actor_id=?1").get(fixture.kitchen.businessId) as any);
    checkHousing(treasury?.balance_gp===1000&&treasury.reserved_gp===0,'Unrelated kitchen treasury changed');
    const after=hashes();checkHousing(digest(before)===digest(after),'Readonly housing verification changed DB/WAL bytes');
    const body={protocol:'si-c07-founder-housing-result-v1',status:'native-route-rent-sleep-pass',worldId:receipt.worldId,fixtureDigest:fixture.digest,
        sourceManifestDigest:source.digest,openingSealDigest:live.openingSealDigest,openingSetupDigest:live.openingSetupDigest,elapsedMs:live.elapsedMs,
        clock:stamp,actors,nativeFiles:before,readonlyUnchanged:true,sqliteMetadata:'SHM and zero-byte WAL files have no persistent payload and are excluded; DB and every nonempty WAL are hashed.',providerCalls:0,providerCostMicros:0,qualifiesMinimum:false,
        limits:live.limits,scope:'Four actual founder routes/bed arrivals and native payments/owner/sleep only; not M3, ratio or sustained supply.'};
    return{...body,digest:digest(body)};
}
