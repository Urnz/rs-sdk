import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPhase22CompletionSeed, buildPhase22EvidenceBundle, inspectPhase22LiveBundle, loadPhase22AcceptanceFixture,
    validatePhase22AcceptanceFixture, verifyPhase22EvidenceBundle } from './phase22-acceptance.js';
import { phase22ItemTotals, reservePhase22ActorInventory } from './phase22-avatar-setup.js';

const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
const fixturePath=join(import.meta.dir,'..','..','config','fixtures','phase22-acceptance-v1.json');
async function live(){const root=mkdtempSync(join(tmpdir(),'phase22-acceptance-'));roots.push(root);mkdirSync(root,{recursive:true});
    const bundleId='live-bundle-1',files:Record<string,unknown>={
        'completion-live.json':{passed:true,bundleId,recognition:['player-only','agent'],engineAndGatewayRestartReplay:true,
            actualProcedures:['pickpocket','lockpick-door','container-theft','property-burglary']},
        'acceptance.json':{schemaVersion:1,bundleId,passed:true,restartVerified:true},
        'recognition-yjlhy3vpb.json':{passed:true},'recognition-zugnsbd3a.json':{passed:true},
        'lockpick-door-acceptance.json':{passed:true},'container-theft-acceptance.json':{passed:true,reportId:'report-1'},
        'property-burglary-acceptance.json':{passed:true,reportId:'report-2'},'container-theft-restart.json':{passed:true},
        'property-burglary-restart.json':{passed:true}};for(const[name,value]of Object.entries(files))await Bun.write(join(root,name),JSON.stringify(value));
    for(const name of ['agents.sqlite','procedures.sqlite','cases.sqlite','witness.sqlite'])await Bun.write(join(root,name),'sqlite-fixture');
    return{root,bundleId}}
describe('Phase 22 exact acceptance bundle',()=>{
    test('reserves actor inventory without losing accumulated gameplay items',()=>{const beforeInventory=[{id:1523,count:1},
        ...Array.from({length:8},()=>({id:1978,count:1})),{id:1351,count:1}],beforeBank=[{id:2309,count:2}];
        const prepared=reservePhase22ActorInventory(beforeInventory,beforeBank);
        expect(prepared.inventory).toEqual([{id:1523,count:1}]);expect(prepared.addedLockpick).toBeFalse();
        expect(phase22ItemTotals(prepared.inventory,prepared.bank)).toEqual(phase22ItemTotals(beforeInventory,beforeBank))});
    test('requires exact package, operations, failure and live coverage',()=>{const fixture=loadPhase22AcceptanceFixture(fixturePath);
        expect(fixture.packages.map(value=>value.id)).toEqual(['22.1','22.2','22.3','22.4','22.5','22.6','22.7']);
        expect(fixture.operations.sources.length).toBeGreaterThan(6);expect(fixture.failureInjection.length).toBeGreaterThanOrEqual(5)});
    test('rejects missing package tests and incomplete live procedures',async()=>{const fixture=loadPhase22AcceptanceFixture(fixturePath);
        expect(()=>validatePhase22AcceptanceFixture({...fixture,packages:fixture.packages.slice(0,6)})).toThrow('invalid');
        expect(()=>validatePhase22AcceptanceFixture({...fixture,live:{...fixture.live,procedures:['pickpocket']}})).toThrow('incomplete');
        const value=await live();await Bun.write(join(value.root,'completion-live.json'),JSON.stringify({passed:true,bundleId:value.bundleId,
            recognition:['player-only','agent'],engineAndGatewayRestartReplay:true,actualProcedures:['pickpocket']}));
        await expect(inspectPhase22LiveBundle(value.root)).rejects.toThrow('incomplete')});
    test('fails closed for a missing source or absent explicit report',async()=>{const value=await live();rmSync(join(value.root,'recognition-zugnsbd3a.json'));
        await expect(inspectPhase22LiveBundle(value.root)).rejects.toThrow('missing');const second=await live();
        await Bun.write(join(second.root,'container-theft-acceptance.json'),JSON.stringify({passed:true}));
        await Bun.write(join(second.root,'property-burglary-acceptance.json'),JSON.stringify({passed:true}));
        await expect(inspectPhase22LiveBundle(second.root)).rejects.toThrow('explicit report')});
    test('rejects a missing or unaccepted completion seed before services start',async()=>{const value=await live();
        rmSync(join(value.root,'procedures.sqlite'));expect(()=>assertPhase22CompletionSeed(value.root,value.bundleId)).toThrow('missing procedures.sqlite');
        const second=await live();await Bun.write(join(second.root,'acceptance.json'),JSON.stringify({schemaVersion:1,
            bundleId:second.bundleId,passed:true,restartVerified:false}));
        expect(()=>assertPhase22CompletionSeed(second.root,second.bundleId)).toThrow('restart-verified')});
    test('hashes every source and detects bundle tampering',async()=>{const value=await live(),log=join(value.root,'focused.log');await Bun.write(log,'73 pass\n0 fail\n');
        const bundle=await buildPhase22EvidenceBundle({bundleId:'phase22-final',fixturePath,liveBundlePath:value.root,
            focusedCommand:'bun test exact-files',focusedExitCode:0,focusedLogPath:log,createdAt:'2030-01-01T00:00:00.000Z'});
        expect(verifyPhase22EvidenceBundle(bundle)).toBeTrue();bundle.live.files[0]!.sha256='0'.repeat(64);
        expect(verifyPhase22EvidenceBundle(bundle)).toBeFalse();await expect(buildPhase22EvidenceBundle({bundleId:'failed',fixturePath,
            liveBundlePath:value.root,focusedCommand:'bun test',focusedExitCode:1,focusedLogPath:log})).rejects.toThrow('did not pass')});
});
