import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const PACKAGE_IDS=['22.1','22.2','22.3','22.4','22.5','22.6','22.7'] as const;
const PROCEDURES=['pickpocket','lockpick-door','container-theft','property-burglary'] as const;
const ID=/^[a-z0-9][a-z0-9._:-]{1,127}$/i;
export interface Phase22AcceptanceFixture{schemaVersion:1;fixtureId:string;
    actors:{thiefUsername:string;playerWitnessUsername:string;agentWitnessUsername:string};
    packages:Array<{id:typeof PACKAGE_IDS[number];claim:string;tests:string[]}>;
    live:{procedures:string[];recognition:string[];requiresEngineAndGatewayRestartReplay:true;requiresExplicitReport:true};
    operations:{workers:string[];switches:string[];policies:string[];sources:string[]};failureInjection:string[]}
export interface Phase22EvidenceFile{path:string;sha256:string;bytes:number}
export interface Phase22EvidenceBundle{schemaVersion:1;bundleId:string;fixtureId:string;fixtureDigest:string;
    packageCoverage:Array<{id:string;claim:string;tests:string[]}>;focusedVerification:{command:string;exitCode:0;log:Phase22EvidenceFile};
    live:{sourceBundleId:string;procedures:string[];recognition:string[];engineAndGatewayRestartReplay:true;
        explicitReportEvidence:true;files:Phase22EvidenceFile[]};operations:Phase22AcceptanceFixture['operations'];
    failureInjection:string[];createdAt:string;bundleDigest:string}
function hash(value:string|Uint8Array){return createHash('sha256').update(value).digest('hex')}
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]))}
function assertStrings(value:unknown,name:string,minimum=1):asserts value is string[]{if(!Array.isArray(value)||value.length<minimum
    ||value.some(entry=>typeof entry!=='string'||!entry.trim()))throw new Error(`${name} is invalid`)}
export function validatePhase22AcceptanceFixture(value:unknown):Phase22AcceptanceFixture{
    if(!value||typeof value!=='object')throw new Error('Phase 22 acceptance fixture is invalid');const fixture=value as Phase22AcceptanceFixture;
    if(fixture.schemaVersion!==1||!ID.test(fixture.fixtureId)||!fixture.actors||!fixture.live||!fixture.operations
        ||!Array.isArray(fixture.packages)||fixture.packages.length!==PACKAGE_IDS.length)
        throw new Error('Phase 22 acceptance fixture is invalid');
    const ids=fixture.packages.map(entry=>entry.id);if(JSON.stringify(ids)!==JSON.stringify(PACKAGE_IDS))
        throw new Error('Phase 22 package coverage must be exact and ordered');
    for(const entry of fixture.packages){if(!entry.claim?.trim())throw new Error(`${entry.id} acceptance claim is missing`);
        assertStrings(entry.tests,`${entry.id} tests`);if(new Set(entry.tests).size!==entry.tests.length
            ||entry.tests.some(path=>!path.endsWith('.test.ts')||path.includes('..')))throw new Error(`${entry.id} tests are invalid`)}
    assertStrings(fixture.live.procedures,'Live procedures');assertStrings(fixture.live.recognition,'Live recognition');
    if(JSON.stringify(fixture.live.procedures)!==JSON.stringify(PROCEDURES)
        ||JSON.stringify(fixture.live.recognition)!==JSON.stringify(['player-only','agent'])
        ||fixture.live.requiresEngineAndGatewayRestartReplay!==true||fixture.live.requiresExplicitReport!==true)
        throw new Error('Phase 22 live acceptance is incomplete');
    for(const [name,entries] of Object.entries(fixture.operations))assertStrings(entries,`Operations ${name}`);
    assertStrings(fixture.failureInjection,'Failure injection',5);
    for(const value of Object.values(fixture.actors))if(typeof value!=='string'||!ID.test(value))throw new Error('Fixture actor is invalid');
    return structuredClone(fixture)}
export function loadPhase22AcceptanceFixture(path:string):Phase22AcceptanceFixture{
    return validatePhase22AcceptanceFixture(JSON.parse(readFileSync(path,'utf8')))}
async function evidenceFile(path:string,root:string):Promise<Phase22EvidenceFile>{const absolute=resolve(path),bytes=new Uint8Array(await Bun.file(absolute).arrayBuffer());
    return{path:resolve(root)===absolute?basename(absolute):absolute.startsWith(`${resolve(root)}\\`)?absolute.slice(resolve(root).length+1).replaceAll('\\','/'):absolute,
        sha256:hash(bytes),bytes:bytes.byteLength}}
async function json(path:string){if(!await Bun.file(path).exists())throw new Error(`Required live evidence is missing: ${basename(path)}`);
    return await Bun.file(path).json() as Record<string,unknown>}
export function assertPhase22CompletionSeed(path:string,expectedBundleId:string){
    const required=['acceptance.json','agents.sqlite','procedures.sqlite','cases.sqlite','witness.sqlite'];
    for(const name of required)if(!existsSync(join(path,name)))
        throw new Error(`Phase 22 completion requires an accepted pickpocket seed bundle; missing ${name}`);
    let acceptance:Record<string,unknown>;try{acceptance=JSON.parse(readFileSync(join(path,'acceptance.json'),'utf8')) as Record<string,unknown>}
    catch{throw new Error('Phase 22 completion seed acceptance.json is invalid')}
    if(acceptance.schemaVersion!==1||acceptance.bundleId!==expectedBundleId||acceptance.passed!==true
        ||acceptance.restartVerified!==true)throw new Error('Phase 22 completion requires an accepted, restart-verified pickpocket seed bundle');
}
export async function inspectPhase22LiveBundle(path:string,expectedBundleId?:string){const completion=await json(join(path,'completion-live.json'));
    const bundleId=String(completion.bundleId??'');if(completion.passed!==true||!ID.test(bundleId)
        ||expectedBundleId!==undefined&&bundleId!==expectedBundleId
        ||JSON.stringify(completion.actualProcedures)!==JSON.stringify(PROCEDURES)
        ||JSON.stringify(completion.recognition)!==JSON.stringify(['player-only','agent'])
        ||completion.engineAndGatewayRestartReplay!==true)throw new Error('Live completion evidence is incomplete');
    assertPhase22CompletionSeed(path,bundleId);
    const required=['completion-live.json','acceptance.json','recognition-yjlhy3vpb.json','recognition-zugnsbd3a.json',
        'lockpick-door-acceptance.json','container-theft-acceptance.json','property-burglary-acceptance.json',
        'container-theft-restart.json','property-burglary-restart.json'];
    let explicitReportEvidence=false;for(const name of required){const value=await json(join(path,name));if(value.passed!==true)
        throw new Error(`Live evidence did not pass: ${name}`);if(name.endsWith('-acceptance.json')
            &&JSON.stringify(value).includes('reportId'))explicitReportEvidence=true}
    if(!explicitReportEvidence)throw new Error('Live evidence has no explicit report receipt');
    return{bundleId,procedures:[...PROCEDURES],recognition:['player-only','agent'],engineAndGatewayRestartReplay:true as const,
        explicitReportEvidence:true as const,files:await Promise.all(required.map(name=>evidenceFile(join(path,name),path)))}}
export async function buildPhase22EvidenceBundle(input:{bundleId:string;fixturePath:string;liveBundlePath:string;
    focusedCommand:string;focusedExitCode:number;focusedLogPath:string;createdAt?:string}):Promise<Phase22EvidenceBundle>{
    if(!ID.test(input.bundleId)||input.focusedExitCode!==0)throw new Error('Focused Phase 22 verification did not pass');
    const fixture=loadPhase22AcceptanceFixture(input.fixturePath),fixtureBytes=new Uint8Array(await Bun.file(input.fixturePath).arrayBuffer()),
        live=await inspectPhase22LiveBundle(input.liveBundlePath),focusedLog=await evidenceFile(input.focusedLogPath,resolve(input.fixturePath,'..','..','..'));
    const facts={schemaVersion:1 as const,bundleId:input.bundleId,fixtureId:fixture.fixtureId,fixtureDigest:hash(fixtureBytes),
        packageCoverage:fixture.packages.map(({id,claim,tests})=>({id,claim,tests})),focusedVerification:{command:input.focusedCommand,
            exitCode:0 as const,log:focusedLog},live:{sourceBundleId:live.bundleId,procedures:live.procedures,recognition:live.recognition,
            engineAndGatewayRestartReplay:live.engineAndGatewayRestartReplay,explicitReportEvidence:live.explicitReportEvidence,files:live.files},
        operations:fixture.operations,failureInjection:fixture.failureInjection,
        createdAt:new Date(input.createdAt??new Date().toISOString()).toISOString()};
    return{...facts,bundleDigest:hash(JSON.stringify(canonical(facts)))}}
export function verifyPhase22EvidenceBundle(bundle:Phase22EvidenceBundle):boolean{const{bundleDigest,...facts}=bundle;
    return PACKAGE_IDS.every((id,index)=>bundle.packageCoverage[index]?.id===id)&&bundle.focusedVerification.exitCode===0
        &&bundle.live.engineAndGatewayRestartReplay&&bundle.live.explicitReportEvidence
        &&bundle.live.files.every(file=>/^[0-9a-f]{64}$/.test(file.sha256)&&file.bytes>0)
        &&bundleDigest===hash(JSON.stringify(canonical(facts)))}
