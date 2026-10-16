import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorldGenesisConfiguration, buildWorldGenesisResult, loadWorldGenesisProfileCatalog } from '../../../world-genesis/index.js';
import { SocietyIntegrityStore } from '../../../society-integrity/store.js';
import { authorizeSocietyBootstrap, type IntegrityBoundary } from '../../../society-integrity/runtime.js';
import { previewAdminWorldGenesis, startAdminWorldGenesis, resetAdminWorldGenesis, type WorldGenesisAdminAdapter } from './world-genesis.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';
import { handleAdminRequest } from './routes.js';
import type { BotSupervisor } from './supervisor.js';

const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
function fixture() {
    const directory=mkdtempSync(join(tmpdir(),'gateway-society-integrity-'));directories.push(directory);
    const profile=loadWorldGenesisProfileCatalog(join(import.meta.dir,'../../../config/world-genesis-profiles.json'))
        .profiles.find(value=>value.profileId==='mature-society')!;
    const time='2001-01-01T00:00:00.000Z',profileDigest='b'.repeat(64);
    const result=buildWorldGenesisResult(buildWorldGenesisConfiguration({seed:'gateway-integrity',profile,worldBuild:'local',
        simulationClock:{clockId:'world',profileDigest,initialSimulationTime:time}}),{assets:[
            {allocationId:'forge-money',kind:'currency',owner:{kind:'business',id:'forge'},amountGp:100}]},'2026-10-14T12:00:00.000Z');
    const paths={runDbPath:join(directory,'runs.sqlite'),provenanceDbPath:join(directory,'provenance.sqlite'),integrityDbPath:join(directory,'integrity.sqlite')};
    const boundary:IntegrityBoundary={path:paths.integrityDbPath,observe:()=>({clockId:'world',profileDigest,simulationTime:time,wallTime:'2026-10-14T12:00:00.000Z'})};
    const treasuryPath=join(directory,'treasury.sqlite');
    const adapter:WorldGenesisAdminAdapter={
        preview:async()=>({ok:true,warnings:[],checks:[]}),prepare:async()=>({createdAtSimulationTime:time,rollbackToken:{allocationId:'forge-money'}}),
        apply:async()=>{
            authorizeSocietyBootstrap(result.resultId,{source:'gateway.treasury-genesis',operationId:'treasury-genesis:forge-money',
                actor:'business:forge',payload:{allocationId:'forge-money',amountGp:100}},paths.integrityDbPath);
            const treasury=new InstitutionTreasuryStore(treasuryPath,boundary);
            try {const receipt=treasury.creditGenesis('business','forge','forge-money',100,time);return {allocationId:receipt.allocationId};}finally{treasury.close();}
        },reset:async()=>{
            const treasury=new InstitutionTreasuryStore(treasuryPath,boundary);
            try {treasury.resetGenesis('forge-money',time);return {reset:true};}finally{treasury.close();}
        }
    };
    return {result,paths,adapter,boundary,treasuryPath};
}
describe('society integrity genesis and authenticated reporting',()=>{
    test('preview writes no journal; native genesis credit is separate from later grants and reset preserves its history',async()=>{
        const f=fixture();await previewAdminWorldGenesis(f.result,f.adapter);expect(existsSync(f.paths.integrityDbPath)).toBe(false);
        const applied=await startAdminWorldGenesis(f.result,f.result.resultDigest,f.adapter,f.paths);
        expect(applied.status).toBe('applied');expect(await startAdminWorldGenesis(f.result,f.result.resultDigest,f.adapter,f.paths)).toEqual(applied);
        const source=new SocietyIntegrityStore(f.paths.integrityDbPath,true);
        expect(source.report(f.result.resultId)).toMatchObject({injectionCount:0,cleanRunStatus:'no-detected-injection'});source.close();
        const treasury=new InstitutionTreasuryStore(f.treasuryPath,f.boundary);treasury.creditGenesis('business','forge','later-grant',10);treasury.close();
        const contaminated=new SocietyIntegrityStore(f.paths.integrityDbPath,true);
        expect(contaminated.report(f.result.resultId)).toMatchObject({injectionCount:1,run:{invalidated:true}});contaminated.close();
        await resetAdminWorldGenesis(f.result.resultId,applied.revision,f.result.resultDigest,f.adapter,f.paths);
        const archived=new SocietyIntegrityStore(f.paths.integrityDbPath,true);
        expect(archived.report(f.result.resultId)).toMatchObject({run:{status:'reset',invalidated:true},injectionCount:1});archived.close();
    });
    test('partial bootstrap is unverified and requires recovery rather than treating intended endowments as applied',async()=>{
        const f=fixture();f.adapter.apply=async()=>{throw new Error('incomplete native apply');};
        await expect(startAdminWorldGenesis(f.result,f.result.resultDigest,f.adapter,f.paths)).rejects.toThrow('requires reset');
        const source=new SocietyIntegrityStore(f.paths.integrityDbPath,true);
        expect(source.report(f.result.resultId)).toMatchObject({cleanRunStatus:'unverified',passesObservedInjectionGate:false,run:{status:'bootstrapping'}});
        expect(source.report(f.result.resultId).events.find(event=>event.kind==='genesis-value')!.status).toBe('pending');source.close();
    });
    test('GET requires local admin authorization and reports absent history without creating a database',async()=>{
        const f=fixture();const context={gatewayBots:()=>new Map(),supervisor:{} as BotSupervisor,worldGenesisPaths:f.paths};
        const url=`http://localhost:7780/api/admin/world-genesis/${f.result.resultId}/integrity`;
        const denied=new Request(url);expect((await handleAdminRequest(denied,new URL(url),context))?.status).toBe(401);
        const request=new Request(url,{headers:{'X-Admin-Request':'rs-sdk-admin'}});
        const absent=await handleAdminRequest(request,new URL(url),context);expect(absent?.status).toBe(200);
        expect(await absent!.json()).toMatchObject({status:'unavailable'});expect(existsSync(f.paths.integrityDbPath)).toBe(false);
        await startAdminWorldGenesis(f.result,f.result.resultDigest,f.adapter,f.paths);
        const response=await handleAdminRequest(request,new URL(url),context);expect(response?.status).toBe(200);
        expect(await response!.json()).toMatchObject({injectionCount:0,run:{runId:f.result.resultId},coverage:{unobservedHistory:'unavailable'}});
    });
});
