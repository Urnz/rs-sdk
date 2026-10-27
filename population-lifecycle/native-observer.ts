import type { Database } from 'bun:sqlite';
import type { AgentPopulationMember } from '../agent-state/types.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import type { PlayerHealthEvidenceStore } from '../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { NativeMortalityCoverageStore,nativeMortalityActor,mortalityRosterDigest } from './native-coverage.js';

const failedWrites=new WeakSet<Database>();
/** Called only after the native natural/starvation pass completed for every population member, including offline members. */
export function recordNativeMortalityPass(db:Database,worldId:string,sessionId:string,clock:SimulationClockObservation,members:AgentPopulationMember[],
    source:PlayerHealthEvidenceStore,agePolicyDigest:string,mortalityPolicyDigest:string,survivalSelectionDigest:string|null){
    if(!NativeMortalityCoverageStore.present(db))return;
    try{
        const store=new NativeMortalityCoverageStore(db),s=store.selection(),at=Date.parse(clock.simulationTime);
        if(s.worldId!==worldId||at<Date.parse(s.fromSimulationTime)-s.maximumSimulationGapMs||at>Date.parse(s.toSimulationTime)+s.maximumSimulationGapMs)return;
        const deaths=new Map(source.listDeaths().map(d=>[d.agentId,d]));
        const actors=members.map(m=>{const death=deaths.get(m.agentId);return{...nativeMortalityActor(m),
            state:death?'terminal' as const:m.status==='active'&&m.characterLifecycle.status==='active'&&m.lifecyclePolicy.kind==='finite'
                &&typeof m.characterLifecycle.birthAtSimulationTime==='string'?'active' as const:'unavailable' as const,deathEventId:death?.eventId??null};});
        store.append({clock,sessionId,stage:'after-native-mortality',priorWriteFailed:failedWrites.has(db),rosterDigest:mortalityRosterDigest(actors),
            agePolicyDigest,mortalityPolicyDigest,survivalSelectionDigest,healthHeads:source.coverageHeads(),actors});failedWrites.delete(db);
    }catch{failedWrites.add(db);console.error('[NativeMortalityCoverage] completed pass witness unavailable; gap retained');}
}
