import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,lstatSync} from 'node:fs';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import {SocietyIntegrityStore,SOCIETY_INTEGRITY_SOURCES} from './store.js';

/** The existing eight instrumented producer families; source pin includes their native dispatch and internal-payment caller. */
export const administrativeValueSourcePaths=[
    'society-integrity/store.ts','society-integrity/runtime.ts','society-integrity/coverage.ts',
    'server/engine/src/engine/World.ts','server/engine/src/engine/entity/PlayerLoading.ts',
    'server/engine/src/mods/SocietyIntegrity.ts','server/engine/src/mods/NativePlayerReward.ts','server/engine/src/mods/PlayerRewardStore.ts',
    'server/engine/src/mods/IntegrationFixtureNative.ts','server/engine/src/network/game/client/handler/ClientCheatHandler.ts',
    'server/gateway/admin/institution-treasury.ts','server/gateway/admin/business-manager.ts','server/gateway/admin/society-integrity.ts'
] as const;
export const administrativeValueRegistryDigest=digest({sources:SOCIETY_INTEGRITY_SOURCES,paths:administrativeValueSourcePaths});
export interface AdministrativeValueCursor {runId:string;resultDigest:string;clockId:string;clockProfileDigest:string;
    genesisAppliedAtSimulationTime:string;head:{sequence:number;hash:string};stateDigest:string;registryDigest:string;runStatus:string}
export function integrityCoverageCursor(snapshot:ReturnType<SocietyIntegrityStore['coverageSnapshot']>):AdministrativeValueCursor{
    const {report,head,stateDigest}=snapshot,r=report.run;return{runId:r.runId,resultDigest:r.resultDigest,clockId:r.result.simulationClock.clockId,
        clockProfileDigest:r.result.simulationClock.profileDigest,genesisAppliedAtSimulationTime:r.genesisAppliedAtSimulationTime,
        head,stateDigest,registryDigest:administrativeValueRegistryDigest,runStatus:r.status};
}
/** Actual engine witness. Absent/invalid history remains null, never a clean zero. Does not initialize or backfill a journal. */
export function readAdministrativeValueCursor(root:string):AdministrativeValueCursor|null{
    // The native wrapper deliberately bypasses engine writes from another cwd. Such a process cannot attest this coverage.
    const moduleRoot=fileURLToPath(new URL('../',import.meta.url));
    if(resolve(root).toLowerCase()!==resolve(moduleRoot).toLowerCase()||resolve(process.cwd()).toLowerCase()!==resolve(root,'server/engine').toLowerCase())return null;
    const path=join(root,'.local/simulation/society-integrity.sqlite');if(!existsSync(path))return null;
    const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024*1024)throw Error('Invalid integrity coverage source');
    const store=new SocietyIntegrityStore(path,true);try{const runs=store.active();if(runs.length!==1)throw Error('Integrity coverage requires one original active run');
        return integrityCoverageCursor(store.coverageSnapshot(runs[0]!.runId));}finally{store.close();}
}
export function validateAdministrativeValueCursor(c:AdministrativeValueCursor){
    const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
    if(!c||typeof c.runId!=='string'||!c.runId||c.runId.length>256||!hex(c.resultDigest)||typeof c.clockId!=='string'||!c.clockId||!hex(c.clockProfileDigest)
        ||!Number.isFinite(Date.parse(c.genesisAppliedAtSimulationTime))||new Date(c.genesisAppliedAtSimulationTime).toISOString()!==c.genesisAppliedAtSimulationTime
        ||!Number.isSafeInteger(c.head?.sequence)||c.head.sequence<0||!hex(c.head.hash)||!hex(c.stateDigest)||!hex(c.registryDigest)
        ||!['bootstrapping','observing','reset'].includes(c.runStatus))throw Error('Invalid administrative value cursor');
}
