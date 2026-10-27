import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { playerSaveStore } from '../engine/market/MarketStore.js';
import { managedContext } from '../../../control-plane/instance-context.js';
import { nativeToolDigest } from '../../../../item-lifecycle/native-tool.js';
import { NativeMortalityCoverageStore } from '../../../../population-lifecycle/native-coverage.js';
import { recordNativeMortalityPass } from '../../../../population-lifecycle/native-observer.js';
import { nativePopulationMortalityPass } from './PopulationDeathRuntime.js';
const sessionId=randomUUID();
/** Observation follows the completed population pass; failures create gaps and never change gameplay restriction state. */
export function tickNativeMortalityCoverage(engineTick:number){
    try{const market=playerSaveStore();if(!market||!NativeMortalityCoverageStore.present(market.db))return;
        const p=nativePopulationMortalityPass(engineTick),root=fileURLToPath(new URL('../../../../',import.meta.url));
        recordNativeMortalityPass(market.db,managedContext()?.id??`local:${nativeToolDigest(root)}`,sessionId,p.clock,p.members,p.source,
            p.agePolicyDigest,p.mortalityPolicyDigest,p.survivalSelectionDigest);
    }catch{console.error('[NativeMortalityCoverage] source unavailable; no current-tick witness');}
}
