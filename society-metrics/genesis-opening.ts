import { readStableOutcomeStore,readNativeFounderDeaths,type NativeFounderBaseline,type NativePopulationSelection } from './population-outcomes.js';
import { SocietyIntegrityStore,saveValueSnapshot } from '../society-integrity/store.js';
import { validateWorldGenesisResult } from '../world-genesis/result.js';
import { validateGenesisAssetAllocation } from '../world-genesis/provenance.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { simulationClockProfileDigest } from '../simulation-clock/profile.js';
import { SIMULATION_CLOCK_STORE_SCHEMA_VERSION } from '../simulation-clock/types.js';
import { parsePlayerSaveBytes } from '../server/gateway/admin/save-reader.js';
import { AgentStateStore } from '../agent-state/store.js';
import { NeedsStore } from '../needs/store.js';
import { populationNeedsBinding } from '../needs/population-binding.js';
import { loadSocietyMinimumContract } from '../society-minimum/contract.js';
import type { EvaluationScope } from './evaluation.js';

/** Explicit backend-selected post-apply snapshot, at genesis time, not the evaluation opening or current live files. */
export interface NativeGenesisOpeningPaths {clockPath:string;checkpointPath:string;agentPath:string;healthPath:string;needsPath:string;
    businessPath:string;treasuryPath:string;propertyPath:string}
type Options={workspace:string;worldId:string;agentPath:string;population:NativePopulationSelection};
function check(v:unknown):asserts v {if(!v)throw Error('Native genesis opening source binding differs');}
function array(v:any):any[]{check(Array.isArray(v)&&v.length<=10000);return v;}
function unique(v:any[],key:(a:any)=>string){check(new Set(v.map(key)).size===v.length);return v;}
function counts(items:any[],equipment=false){const values=new Map<string,number>();
    for(const a of items){check(Number.isSafeInteger(a.id)&&a.id>=0&&Number.isSafeInteger(a.count)&&a.count>0);
        if(equipment)check(Number.isSafeInteger(a.slot)&&a.slot>=0&&a.slot<14);
        const key=equipment?`${a.slot}:${a.id}`:String(a.id);values.set(key,(values.get(key)??0)+a.count);check(Number.isSafeInteger(values.get(key)));}
    return [...values].sort(([a],[b])=>a.localeCompare(b));}
function save(v:any){check(v&&Number.isSafeInteger(v.coins)&&v.coins>=0&&v.position);
    const skills=unique(array(v.skills),s=>s.name).map(s=>{check(typeof s.name==='string'&&Number.isSafeInteger(s.experience)&&s.experience>=0);return{name:s.name,experience:s.experience};}).sort((a,b)=>a.name.localeCompare(b.name));
    check(['x','z','level'].every(k=>Number.isSafeInteger(v.position[k])));
    return{coins:v.coins,skills,position:v.position,inventory:counts(array(v.inventory)),bank:counts(array(v.bank)),equipment:counts(array(v.equipment),true)};}

/** Existing application/rollback/receipts + integrity bootstrap + frozen native stores. No mutation, producer or uploaded certificate. */
export function readNativeGenesisOpening(scope:EvaluationScope,options:Options,baseline:NativeFounderBaseline){
    const p=options.population,paths=p.opening;check(paths);
    const application=readStableOutcomeStore(options,p.genesisPath,db=>{
        const row=db.query('SELECT * FROM world_genesis_application WHERE result_id=?').get(p.genesisResultId) as any;
        check(row?.status==='applied'&&row.result_digest===p.genesisResultDigest&&row.receipt_json&&row.completed_at_audit);
        const result=validateWorldGenesisResult(JSON.parse(row.result_json)),token=JSON.parse(row.rollback_json) as {schemaVersion:number;players:any[];properties:any[];businesses:any[];treasuryAllocationIds:any[];businessStockAllocationIds:any[];populationMembers:any[]},
            receipt=JSON.parse(row.receipt_json) as {schemaVersion:number;players:any[];properties:any[];businesses:any[];treasuries:any[];businessStock:any[];populationMembers:any[]};
        check(result.resultDigest===baseline.genesisResultDigest&&result.resultId===baseline.genesisResultId&&token?.schemaVersion===2&&receipt?.schemaVersion===2);
        for(const name of ['players','properties','businesses','treasuries','businessStock','populationMembers'] as const)array(receipt[name]);
        for(const name of ['players','properties','businesses','treasuryAllocationIds','businessStockAllocationIds','populationMembers'] as const)array(token[name]);
        return{result,token,receipt};
    });
    const {result,token,receipt}=application,assets=array((result.output as any).assets).map(validateGenesisAssetAllocation);
    const ids=baseline.founders.map(f=>f.agentId).sort(),names=baseline.founders.map(f=>f.playerUsername);
    check(digest(unique(token.populationMembers,m=>m.agentId).map(m=>m.agentId).sort())===digest(ids)
        &&digest(unique(receipt.populationMembers,m=>m.agentId).map(m=>m.agentId).sort())===digest(ids));
    const playerNames=[...new Set([...names,...assets.filter(a=>(a.kind==='currency'||a.kind==='item')&&a.owner.kind==='player').map(a=>a.owner.id)])].sort();
    check(digest(unique(token.players,a=>a.username).map(a=>a.username).sort())===digest(playerNames));
    const anchor=readStableOutcomeStore(options,p.integrityPath,db=>{
        const store=new SocietyIntegrityStore(p.integrityPath,true);
        try{const report=store.report(result.resultId);check(report.run.status==='observing'&&digest(report.run.result)===digest(result)
            &&report.run.genesisAppliedAtSimulationTime===baseline.genesisAppliedAtSimulationTime);
            const events=report.events as any[];check(events.some(e=>e.eventId==='bootstrap-complete'&&e.status==='committed'));
            for(const a of assets.filter(a=>a.kind==='currency'||a.kind==='item'))check(events.some(e=>e.eventId===`genesis:${a.allocationId}`&&e.status==='committed'&&digest(e.asset)===digest(a)));
            const permits=db.query('SELECT operation_id,mutation_digest,consumed FROM integrity_permit WHERE run_id=?').all(result.resultId) as {operation_id:string;mutation_digest:string;consumed:number}[];
            const expected=[...receipt.players.map(r=>`offline-save:${r.commandId}`),...receipt.treasuries.map(r=>`treasury-genesis:${r.allocationId}`),
                ...assets.filter(a=>a.kind==='item'&&a.owner.kind==='business').map(a=>`business-stock-genesis:${a.allocationId}`)].sort();
            check(new Set(expected).size===expected.length&&expected.every(id=>permits.some(a=>a.operation_id===id&&a.consumed===1))
                &&permits.every(a=>expected.includes(a.operation_id)||events.some(e=>e.eventId===`internal-transfer:${a.operation_id}`)));
            return{events,permits,journalDigest:digest(report)};
        }finally{store.close();}
    });
    const opening=(actor:string)=>{
        const snapshot=anchor.events.find(e=>e.eventId===`opening:${actor}:snapshot`),values=anchor.events.filter(e=>e.kind==='genesis-opening-value'&&e.actor===actor);
        check(snapshot?.status==='committed'&&snapshot.simulationTime===baseline.genesisAppliedAtSimulationTime&&snapshot.valueCount===values.length
            &&values.every(e=>e.status==='committed'&&e.simulationTime===snapshot.simulationTime));
        const raw=values.map(e=>({key:e.eventId.slice(`opening:${actor}:`.length),value:e.value}));check(snapshot.valuesDigest===digest(raw));return raw;
    };
    const clock=readStableOutcomeStore(options,paths.clockPath,db=>{
        check((db.query('PRAGMA user_version').get() as any).user_version===SIMULATION_CLOCK_STORE_SCHEMA_VERSION);
        const row=db.query('SELECT * FROM simulation_clock WHERE clock_id=?').get(scope.clockId) as any;
        check(row?.status==='paused'&&row.last_simulation_ms===Date.parse(baseline.genesisAppliedAtSimulationTime)&&row.profile_digest===scope.clockProfileDigest
            &&simulationClockProfileDigest(JSON.parse(row.profile_json))===row.profile_digest);return{revision:row.revision};
    });
    const mismatches:string[]=[],match=(v:unknown,reason:string)=>{if(!v&&!mismatches.includes(reason))mismatches.push(reason);},
        sourceDigests=[application.sourceSnapshotDigest,anchor.sourceSnapshotDigest,clock.sourceSnapshotDigest];
    function observe<T>(path:string,read:Parameters<typeof readStableOutcomeStore<T>>[2]){
        const count=mismatches.length;
        try{const value=readStableOutcomeStore(options,path,read);sourceDigests.push(value.sourceSnapshotDigest);return value;}
        catch(error){mismatches.splice(count);throw error;}
    }
    let completeOpeningSources=false;
    try{
    observe(paths.checkpointPath,db=>{
        const rows=db.query('SELECT owner,save FROM accounts').all() as {owner:string;save:Uint8Array}[];
        const edited=token.players.filter(a=>assets.some(v=>(v.kind==='currency'||v.kind==='item')&&v.owner.kind==='player'&&v.owner.id===a.username));
        check(digest(unique(receipt.players,r=>r.username).map(r=>r.username).sort())===digest(edited.map(a=>a.username).sort()));
        for(const entry of token.players){const before=entry.before;save(before);const values:any[]=[];
            if(before.coins>0)values.push({key:'currency',value:{kind:'currency',amountGp:before.coins}});
            for(const c of ['inventory','bank','equipment'])for(const [i,item] of array(before[c]).entries())values.push({key:`${c}:${i}`,value:{kind:'item',container:c,...item}});
            check(digest(opening(`player:${entry.username}`))===digest(values));
            const expected=structuredClone(before),allocations=assets.filter(a=>(a.kind==='currency'||a.kind==='item')&&a.owner.kind==='player'&&a.owner.id===entry.username);
            for(const a of allocations)if(a.kind==='currency')expected.coins+=a.amountGp;else if(a.kind==='item')expected[a.container].push({id:a.itemId,count:a.count,...(a.container==='equipment'?{slot:a.slot}:{})});
            if(allocations.length){const r=receipt.players.find(r=>r.username===entry.username);check(r&&typeof r.commandId==='string'&&typeof r.backupId==='string'&&r.backupId&&typeof r.afterSavedAt==='string');
                const merge=(items:any[])=>counts(items).map(([id,count])=>({id:Number(id),count})).sort((a,b)=>a.id-b.id);
                const after={...expected,inventory:merge(expected.inventory),bank:merge(expected.bank),equipment:[...expected.equipment].sort((a,b)=>a.slot-b.slot)};
                const permit=anchor.permits.find(a=>a.operation_id===`offline-save:${r.commandId}`);
                check(permit?.mutation_digest===digest({source:'engine.offline-save',operationId:`offline-save:${r.commandId}`,actor:`player:${entry.username}`,
                    payload:{before:saveValueSnapshot(before),after:saveValueSnapshot(after)}}));
            }
            const row=rows.find(r=>r.owner===entry.username);check(row);const actual=parsePlayerSaveBytes(row.save,'1970-01-01T00:00:00.000Z',true,true);check(actual.valid);
            // Editor summaries keep currency separate. The canonical save stores it in inventory/bank.
            const withoutCoins=(items:any[])=>items.filter(a=>a.id!==995).map(a=>({id:a.id,count:a.count,slot:a.slot}));
            const normalized={...actual,inventory:withoutCoins(actual.inventory),bank:withoutCoins(actual.bank),equipment:actual.equipment.map(a=>({id:a.id,count:a.count,slot:a.slot}))};
            match(digest(save(normalized))===digest(save(expected))&&actual.currentHitpoints!>0,'player-opening-state');
        }
        return{playerCount:token.players.length};
    });
    // Original native identity at the opening, not just the current agent projection.
    const deaths=readNativeFounderDeaths(scope,{...options,agentPath:paths.agentPath,population:{...p,healthPath:paths.healthPath}},baseline);
    sourceDigests.push(deaths.agentSnapshotDigest,deaths.healthSnapshotDigest);
    match(deaths.deaths.every(d=>d.atSimulationTime>baseline.genesisAppliedAtSimulationTime),'terminal-opening-founder');
    const members=observe(paths.agentPath,()=>{const store=new AgentStateStore(paths.agentPath,undefined,true);
        try{return{members:ids.map(id=>store.getPopulationMember(id)!)};}finally{store.close();}});
    for(const member of members.members)match(digest(receipt.populationMembers.find(m=>m.agentId===member.agentId))===digest(member),'population-opening-state');
    const contract=loadSocietyMinimumContract(p.configDirectory);observe(paths.needsPath,db=>{
        const store=new NeedsStore(db,contract.dependencies.needs,contract.dependencies.dynamics,{readonly:true});
        for(const member of members.members){const state=store.get(populationNeedsBinding(options.worldId,member));check(state);
            match(state.revision===1&&state.admission.kind==='genesis'&&state.admission.evidenceId===result.resultId&&state.admission.evidenceDigest===result.resultDigest
                &&state.state.observedAtSimulationTime===baseline.genesisAppliedAtSimulationTime&&!state.terminal,'needs-opening-state');}
        return{count:ids.length};
    });
    const institutions=new Map<string,{kind:string;id:string;gp:number;items:any[]}>();
    const institution=(kind:string,id:string)=>{const key=`${kind}:${id}`;if(!institutions.has(key))institutions.set(key,{kind,id,gp:0,items:[]});return institutions.get(key)!;};
    for(const a of assets){if(a.kind==='business')institution('business',a.businessId).gp+=a.openingCapitalGp;
        else if((a.kind==='currency'||a.kind==='item')&&a.owner.kind!=='player'){
            check(a.owner.kind==='business'||a.owner.kind==='faction');const n=institution(a.owner.kind,a.owner.id);
            if(a.kind==='currency')n.gp+=a.amountGp;else{check(a.owner.kind==='business'&&a.container==='business-stock');n.items.push({id:a.itemId,count:a.count});}}
    }
    observe(paths.treasuryPath,db=>{
        const credits=assets.flatMap(a=>a.kind==='currency'&&(a.owner.kind==='business'||a.owner.kind==='faction')
            ?[{id:a.allocationId,kind:a.owner.kind,actor:a.owner.id,gp:a.amountGp}]
            :a.kind==='business'&&a.openingCapitalGp>0?[{id:`${a.allocationId}:capital`,kind:'business',actor:a.businessId,gp:a.openingCapitalGp}]:[]);
        check(digest(unique(receipt.treasuries,r=>r.allocationId).map(r=>r.allocationId).sort())===digest(credits.map(a=>a.id).sort()));
        for(const c of credits){const row=db.query('SELECT * FROM institution_treasury_genesis WHERE allocation_id=?').get(c.id) as any,
            r=receipt.treasuries.find(r=>r.allocationId===c.id),permit=anchor.permits.find(a=>a.operation_id===`treasury-genesis:${c.id}`);
            check(r.kind===c.kind&&r.actorId===c.actor&&r.amountGp===c.gp&&r.status==='active'
                &&permit?.mutation_digest===digest({source:'gateway.treasury-genesis',operationId:`treasury-genesis:${c.id}`,actor:`${c.kind}:${c.actor}`,payload:{allocationId:c.id,amountGp:c.gp}}));
            match(row?.status==='active'&&row.actor_kind===c.kind&&row.actor_id===c.actor&&row.amount_gp===c.gp,'treasury-genesis-receipt');
        }
        for(const [actor,n] of institutions){const snapshots=anchor.events.filter(e=>e.eventId===`opening:${actor}:snapshot`);
            const previous=snapshots.length?opening(actor):[];check(snapshots.length||assets.some(a=>a.kind==='business'&&a.businessId===n.id));
            for(const {value:v} of previous)if(v.kind==='currency')n.gp+=v.amountGp;else{check(v.kind==='item'&&v.container==='business-stock');n.items.push({id:v.itemId,count:v.count});}
            const row=db.query('SELECT * FROM institution_treasury WHERE actor_kind=? AND actor_id=?').get(n.kind,n.id) as any;
            match((row?.balance_gp??0)===n.gp&&(row?.reserved_gp??0)===0,'treasury-opening-state');
        }return{count:institutions.size};
    });
    observe(paths.businessPath,db=>{
        check(digest(unique(receipt.businesses,r=>r.allocationId).map(r=>r.allocationId).sort())===digest(assets.filter(a=>a.kind==='business').map(a=>a.allocationId).sort()));
        for(const a of assets.filter(a=>a.kind==='business')){const row=db.query('SELECT * FROM business WHERE business_id=?').get(a.businessId) as any,
            r=receipt.businesses.find(r=>r.allocationId===a.allocationId),property=assets.find(v=>v.kind==='property'&&v.owner.kind==='business'&&v.owner.id===a.businessId);
            check(r?.businessId===a.businessId&&r.ownerAgentId===a.owner.id&&r.status==='active');
            const genesis=db.query('SELECT * FROM business_genesis_creation WHERE allocation_id=?').get(a.allocationId) as any;
            match(genesis?.status==='active'&&genesis.business_id===a.businessId&&genesis.owner_agent_id===a.owner.id&&genesis.property_id===r.propertyId,'business-genesis-receipt');
            match(row?.status==='active'&&row.owner_agent_id===a.owner.id&&row.property_id===(property?.kind==='property'?property.propertyId:null),'business-opening-state');}
        const stock=assets.filter(a=>a.kind==='item'&&a.owner.kind==='business');check(receipt.businessStock.length===stock.length);
        for(const a of stock){check(a.kind==='item');const row=db.query('SELECT * FROM business_genesis_inventory WHERE allocation_id=?').get(a.allocationId) as any,
            permit=anchor.permits.find(p=>p.operation_id===`business-stock-genesis:${a.allocationId}`);
            check(receipt.businessStock.some(r=>r.businessId===a.owner.id&&r.itemId===a.itemId&&r.count>=a.count)
                &&permit?.mutation_digest===digest({source:'gateway.business-stock-genesis',operationId:`business-stock-genesis:${a.allocationId}`,actor:`business:${a.owner.id}`,
                    payload:{allocationId:a.allocationId,itemId:a.itemId,count:a.count}}));
            match(row?.status==='active'&&row.business_id===a.owner.id&&row.item_id===a.itemId&&row.count===a.count,'business-stock-genesis-receipt');
        }
        for(const n of institutions.values())if(n.kind==='business'){
            const rows=db.query('SELECT item_id,count FROM business_inventory WHERE business_id=?').all(n.id) as {item_id:number;count:number}[];
            match(digest(counts(rows.filter(r=>r.count>0).map(r=>({id:r.item_id,count:r.count}))))===digest(counts(n.items)),'business-stock-opening-state');
        }return{count:receipt.businesses.length};
    });
    observe(paths.propertyPath,db=>{
        const allocated=assets.filter(a=>a.kind==='property');check(digest(unique(receipt.properties,r=>r.allocationId).map(r=>r.allocationId).sort())===digest(allocated.map(a=>a.allocationId).sort())
            &&digest(unique(token.properties,r=>r.allocationId).map(r=>r.allocationId).sort())===digest(allocated.map(a=>a.allocationId).sort()));
        for(const a of allocated){const r=receipt.properties.find(r=>r.allocationId===a.allocationId),t=token.properties.find(t=>t.allocationId===a.allocationId);
            check(r&&t&&r.propertyId===a.propertyId&&t.propertyId===a.propertyId&&digest(r.owner)===digest(a.owner)&&r.beforeVersion===t.beforeVersion&&r.version===t.beforeVersion+1);
            const row=db.query('SELECT * FROM property_state WHERE property_id=?').get(a.propertyId) as any;
            const genesis=db.query('SELECT * FROM property_genesis_assignment WHERE allocation_id=?').get(a.allocationId) as any;
            match(genesis?.property_id===a.propertyId&&genesis.owner_kind===a.owner.kind&&genesis.owner_id===a.owner.id
                &&genesis.before_version===r.beforeVersion&&genesis.version===r.version,'property-genesis-receipt');
            match(row?.status==='owned'&&row.owner_kind===a.owner.kind&&row.owner_id===a.owner.id&&row.version===r.version,'property-opening-state');
        }return{count:allocated.length};
    });completeOpeningSources=true;
    }catch(error){if(!mismatches.length)throw error; /* A verified earlier source violation survives a different missing/corrupt source. */ }
    return{scope,worldId:options.worldId,clockId:scope.clockId,clockProfileDigest:scope.clockProfileDigest,genesisResultId:result.resultId,genesisResultDigest:result.resultDigest,
        at:baseline.genesisAppliedAtSimulationTime,founderAgentIds:ids,verdict:mismatches.length?'fail' as const:'pass' as const,mismatches,completeOpeningSources,sourceDigests,
        meaning:'Verified declared applied genesis against the explicit post-apply native opening; separate from complete run coverage, lineage or survival.'};
}
