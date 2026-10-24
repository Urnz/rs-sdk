import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import World from '../engine/World.js';
import LocType from '../cache/config/LocType.js';
import { ensurePlayerSaveStore,playerSaveStore } from '../engine/market/MarketStore.js';
import { populationFoodContext,populationFoodTickClock } from './PopulationDeathRuntime.js';
import { NativeToolWorkExecutor,type NativeToolWorkCommand } from './NativeToolWork.js';
import { NativeToolWorkStore,type NativeToolWorkRecord } from '../../../../production-workflow/native-tool-work.js';
import { NativeToolWorkAccessSource } from '../../../../production-workflow/native-tool-work-source.js';
import { nativeToolWorkPolicy } from '../../../../production-workflow/native-tool-work-policy.js';
import { assertManagedModuleRoot } from '../../../control-plane/instance-context.js';
import { getSharedPlayerEscrowAuthority } from './SharedPlayerEscrowAuthority.js';
type Response={ok:true;record:NativeToolWorkRecord}|{ok:false;error:string};
const queue:Array<{command:NativeToolWorkCommand;expires:number;resolve(value:Response):void}>=[];
let executor:NativeToolWorkExecutor|null=null;
export function enqueueNativeToolWork(command:NativeToolWorkCommand):Promise<Response>{
    if(!command||Object.keys(command).sort().join(',')!=='businessId,contextDigest,kind,operationId,username'
        ||!['smelt','repair'].includes(command.kind)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(command.operationId)
        ||!/^[a-z0-9]{1,12}$/.test(command.username)||!/^[a-f0-9]{64}$/.test(command.contextDigest)
        ||(command.kind==='smelt'?command.businessId!==null:typeof command.businessId!=='string'||!/^[a-z0-9][a-z0-9._:-]{1,127}$/.test(command.businessId)))
        return Promise.resolve({ok:false,error:'Invalid typed native tool command'});
    if(queue.length>=50)return Promise.resolve({ok:false,error:'Native tool queue full'});
    return new Promise(resolve=>queue.push({command:structuredClone(command),expires:Date.now()+5000,resolve}));
}
function runtime():NativeToolWorkExecutor{
    if(executor)return executor;
    const root=fileURLToPath(new URL('../../../../',import.meta.url));assertManagedModuleRoot(root);
    getSharedPlayerEscrowAuthority();
    const market=ensurePlayerSaveStore(),source=new NativeToolWorkAccessSource({workspace:root,
        agentsPath:join(root,'.local/agent-state/agents.sqlite'),businessPath:join(root,'.local/economy/businesses.sqlite'),
        propertyPath:process.env.PROPERTY_STATE_DB??join(root,'.local/admin/properties.sqlite')});
    return executor=new NativeToolWorkExecutor({market,identity:populationFoodContext,
        checkpoint:players=>{for(const player of players)World.checkpointPlayers(player);},
        clock:()=>{const clock=populationFoodTickClock(World.currentTick);if(!clock)throw new Error('Native tool clock unavailable');return clock;},
        source:kind=>{const s=nativeToolWorkPolicy[kind].source;return World.getLoc(s.x,s.z,s.level,LocType.getId(s.debugName));},
        authorize:(_player,kind,business,clock,owner,command)=>source.authorize(owner,kind,business,clock,command)});
}
export function tickNativeToolWork():void{
    if(World.shutdown)return;
    for(const item of queue.splice(0,10))try{
        if(Date.now()>item.expires)throw new Error('Native tool command expired');
        const player=World.getPlayerByUsername(item.command.username);if(!player)throw new Error('Native tool worker offline');
        item.resolve({ok:true,record:runtime().start(item.command,player)});
    }catch(error){item.resolve({ok:false,error:error instanceof Error?error.message:String(error)});}
    const market=playerSaveStore();
    if(!market||!NativeToolWorkStore.present(market.db))return;
    let records:NativeToolWorkRecord[];
    try{records=runtime().work.list().filter(row=>row.phase!=='completed');}
    catch(error){console.error('[NativeToolWork] source unavailable; work retained:',String(error));return;}
    for(const record of records)try{
        runtime().advance(record.intent.operationId,World.getPlayerByUsername(record.intent.owner.username)??null);
    }catch(error){console.error('[NativeToolWork] pending work retained:',record.intent.operationId,error instanceof Error?error.message:String(error));}
}
