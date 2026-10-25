import World from '../engine/World.js';
import { playerSaveStore } from '../engine/market/MarketStore.js';
import { populationFoodContext,populationFoodTickClock } from './PopulationDeathRuntime.js';
import { NativeMiningIntentTracker } from './NativeMiningIntent.js';
import { NativeMiningIntentStore } from '../../../../item-lifecycle/native-mining-intent.js';

let tracker:NativeMiningIntentTracker|null=null;
/** Observes already admitted requests only. Unbacked SDK/client requests cannot create standing demand here. */
export function tickNativeMiningIntents(){
    if(World.shutdown)return;
    try{
    const market=playerSaveStore();if(!market||!NativeMiningIntentStore.present(market.db))return;
    if(!market.db.query("SELECT 1 FROM native_mining_intent_state WHERE phase='pending' LIMIT 1").get())return;
    if(tracker?.ports.market.db!==market.db)tracker=null;
    tracker??=new NativeMiningIntentTracker({market,identity:populationFoodContext,
        checkpoint:players=>{for(const player of players)World.checkpointPlayers(player);},
        clock:()=>{const c=populationFoodTickClock(World.currentTick);if(!c)throw Error('Native mining intent clock unavailable');return c;},
        authorizeStart:()=>{throw Error('Native standing demand needs a source-backed invocation admission bridge');}});
    try{for(const record of tracker.store.pending())try{
        tracker.observe(record.intent.demandId,World.getPlayerByUsername(record.intent.owner.username)??null);
    }catch{console.error('[NativeMiningIntent] observation unavailable; pending request retained');}}
    catch{console.error('[NativeMiningIntent] source unavailable; no coverage claimed');}
    }catch{console.error('[NativeMiningIntent] source unavailable; no coverage claimed');}
}
