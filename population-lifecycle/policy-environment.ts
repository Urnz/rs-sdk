import { nativeToolDigest as digest } from '../item-lifecycle/native-tool.js';

export const policyMutationProducers=[
    {id:'mod-configure',path:'server/gateway/admin/world-mods.ts',entry:'performWorldModUpdate',effect:'configuration'},
    {id:'mod-restore',path:'server/gateway/admin/world-mods.ts',entry:'restoreWorldModBackup',effect:'configuration'},
    {id:'mod-hot-reload',path:'server/engine/src/mods/WorldMods.ts',entry:'reloadHotWorldMods',effect:'configuration'},
    {id:'director-configure',path:'server/gateway/admin/world-director-runtime.ts',entry:'updateWorldDirectorConfig',effect:'configuration'},
    {id:'director-event-accept',path:'server/engine/src/mods/WorldDirectorEventStore.ts',entry:'WorldDirectorEventStore.accept',effect:'signal'}
] as const;
export type PolicyMutationProducer=typeof policyMutationProducers[number]['id'];
export interface PolicyEnvironmentPin {schemaVersion:1;files:Array<{path:string;size:number;sha256:string;role:'source'|'config'|'packed'}>;
    bunVersion:string;platform:string;inputRegistry:Array<{key:string;role:'engine'|'gateway'}>;producers:typeof policyMutationProducers;
    coverage:'archive-observed-files-and-declared-inputs';completeRuntimeDependencyUniverse:false}
const inputRegistry:PolicyEnvironmentPin['inputRegistry']=[
    {key:'PLAYER_CHECKPOINT_DATABASE',role:'engine'},{key:'GE_DATABASE',role:'engine'},{key:'GE_ENABLED',role:'engine'},
    {key:'CONTROL_PLANE_SERVER_ID',role:'engine'},{key:'MANAGED_WORKSPACE',role:'engine'},
    {key:'CONTROL_PLANE_SERVER_ID',role:'gateway'},{key:'MANAGED_WORKSPACE',role:'gateway'}
];
const localConfig=new Set(['.local/admin/world-mod-state.json','.local/admin/world-director.json']);
/** Consume the existing offline inventory; no second filesystem traversal or environment/secret dump. */
export function pinPolicyEnvironment(inventory:{files:Array<{path:string;size:number;sha256:string}>;sourceFiles:string[]},runtime:{bunVersion:string;platform:string}):PolicyEnvironmentPin {
    const source=new Set(inventory.sourceFiles),files:PolicyEnvironmentPin['files']=inventory.files.flatMap(f=>{
        const role=f.path.startsWith('server/engine/data/pack/')?'packed' as const
            :f.path.startsWith('config/')||f.path.startsWith('server/engine/data/config/')||localConfig.has(f.path)?'config' as const
                :source.has(f.path)?'source' as const:null;return role?[{...f,role}]:[];
    }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    const pin:PolicyEnvironmentPin={schemaVersion:1,files,...runtime,inputRegistry,producers:policyMutationProducers,
        coverage:'archive-observed-files-and-declared-inputs',completeRuntimeDependencyUniverse:false};validatePolicyEnvironment(pin);return pin;
}
export function validatePolicyEnvironment(pin:PolicyEnvironmentPin){
    if(!pin||pin.schemaVersion!==1||pin.coverage!=='archive-observed-files-and-declared-inputs'||pin.completeRuntimeDependencyUniverse!==false
        ||digest(pin.producers)!==digest(policyMutationProducers)||digest(pin.inputRegistry)!==digest(inputRegistry)
        ||typeof pin.bunVersion!=='string'||!pin.bunVersion||pin.bunVersion.length>128||typeof pin.platform!=='string'||!pin.platform||pin.platform.length>128
        ||!Array.isArray(pin.files)||!pin.files.length||pin.files.length>100000||new Set(pin.files.map(f=>f.path.toLowerCase())).size!==pin.files.length
        ||pin.files.map(f=>f.path).join('\n')!==pin.files.map(f=>f.path).sort().join('\n'))throw Error('Invalid policy environment inventory');
    for(const f of pin.files)if(typeof f.path!=='string'||f.path.length>500||/[\\:\x00-\x1f]/.test(f.path)||f.path.split('/').some(p=>!p||p==='.'||p==='..'
        ||/^(?:\.env(?:\..*)?|bot\.env|secrets|node_modules|\.git)$/i.test(p))||!['source','config','packed'].includes(f.role)
        ||!Number.isSafeInteger(f.size)||f.size<0||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('Invalid policy environment file');
    if(!pin.files.some(f=>f.path==='package.json'&&f.role==='source')||!pin.files.some(f=>f.role==='packed')
        ||policyMutationProducers.some(p=>!pin.files.some(f=>f.path===p.path&&f.role==='source')))throw Error('Policy producer/packed inventory incomplete');
}
