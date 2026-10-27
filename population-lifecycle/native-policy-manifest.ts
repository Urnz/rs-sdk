import { readFileSync,lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { nativeToolDigest as digest } from '../item-lifecycle/native-tool.js';
import { lifecycleAttemptKinds } from './native-attempts.js';

export const lifecycleRoutes=[
    {kind:'load',path:'server/engine/src/engine/entity/PlayerLoading.ts',entry:'PlayerLoading.load'},
    {kind:'login-guard',path:'server/engine/src/mods/NativeLifecycleAttempts.ts',entry:'observeNativePopulationLogin'},
    {kind:'world-admission',path:'server/engine/src/engine/World.ts',entry:'World.processLogins/admission'},
    {kind:'world-reconnect',path:'server/engine/src/engine/World.ts',entry:'World.processLogins/reconnect'},
    {kind:'world-eviction',path:'server/engine/src/engine/World.ts',entry:'World.cycle/terminal-guard'},
    {kind:'respawn-script',path:'server/engine/src/engine/entity/Player.ts',entry:'Player.runScript'},
    {kind:'terminal-script-abort',path:'server/engine/src/engine/script/ScriptRunner.ts',entry:'ScriptRunner.execute + Player.runScript'}
] as const;
export const lifecycleSourcePaths=[...new Set([...lifecycleRoutes.map(r=>r.path),
    'population-lifecycle/native-policy-manifest.ts','population-lifecycle/native-policy.ts','population-lifecycle/native-attempts.ts',
    'population-lifecycle/native-watermarks.ts','population-lifecycle/native-coverage.ts','population-lifecycle/native-observer.ts',
    'population-lifecycle/age.ts','population-lifecycle/mortality.ts','population-lifecycle/death.ts','population-lifecycle/starvation.ts',
    'server/engine/src/mods/PopulationDeathRuntime.ts','server/engine/src/mods/NativeMortalityCoverageRuntime.ts',
    'server/engine/src/mods/PlayerHealthEvidenceStore.ts','server/engine/src/mods/WorldMods.ts','simulation-clock/store.ts',
    'simulation-clock/profile.ts','simulation-clock/config.ts','needs/survival.ts'])].sort();
export const lifecyclePolicyPaths=['config/population-age-policy.json','config/population-mortality-policy.json',
    'config/population-world-profile-bindings.json','config/population-lifecycle-policies.json','config/simulation-clock.json',
    'config/society-minimum-policy.json','config/survival-rules.json','config/world-mods.json',
    'config/survival-profile.json','server/engine/data/config/world.json','.local/admin/world-mod-state.json','.local/admin/world-director.json'].sort();
const optional=new Set(['config/survival-profile.json','server/engine/data/config/world.json','.local/admin/world-mod-state.json','.local/admin/world-director.json']);
export interface LifecycleFilePin {path:string;sha256:string|null;bytes:number|null}
function files(root:string,paths:readonly string[],allowAbsent=false):LifecycleFilePin[]{return paths.map(path=>{
    try{const full=join(root,path),stat=lstatSync(full);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('Invalid lifecycle pin source');
        const bytes=readFileSync(full);return{path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
    catch(error){if(allowAbsent&&optional.has(path)&&(error as NodeJS.ErrnoException).code==='ENOENT')return{path,sha256:null,bytes:null};throw error;}
});}
export function lifecycleRouteManifest(root:string){return{schemaVersion:1,routes:[...lifecycleRoutes],sources:files(root,lifecycleSourcePaths),
    coverage:'declared-lifecycle-routes',completeRuntimeDependencyUniverse:false};}
export type LifecycleRouteManifest=ReturnType<typeof lifecycleRouteManifest>;
export const lifecyclePolicyFiles=(root:string)=>files(root,lifecyclePolicyPaths,true);
export function validateLifecycleManifest(m:LifecycleRouteManifest){
    if(!m||m.schemaVersion!==1||digest(m.routes)!==digest([...lifecycleRoutes])||m.routes.map(r=>r.kind).join(',')!==lifecycleAttemptKinds.join(',')
        ||m.coverage!=='declared-lifecycle-routes'||m.completeRuntimeDependencyUniverse!==false)throw Error('Lifecycle route manifest differs');
    validateLifecycleFiles(m.sources,lifecycleSourcePaths,false);
}
export function validateLifecycleFiles(values:LifecycleFilePin[],paths:readonly string[],allowAbsent=true){
    if(!Array.isArray(values)||values.map(f=>f.path).join(',')!==paths.join(','))throw Error('Lifecycle file inventory differs');
    for(const f of values)if(!(allowAbsent&&optional.has(f.path)&&f.sha256===null&&f.bytes===null)
        &&!(typeof f.sha256==='string'&&/^[a-f0-9]{64}$/.test(f.sha256)&&Number.isSafeInteger(f.bytes)&&Number(f.bytes)>=0&&Number(f.bytes)<=8*1024*1024))throw Error('Invalid lifecycle file pin');
}
