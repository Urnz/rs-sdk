import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {handleAdminRequest} from './routes.js';
import type {BotSupervisor} from './supervisor.js';
import {xpBaselineClient} from './xp-baseline.js';
import {xpExecutionClient} from './xp-execution.js';
import {makeXpStateSnapshot,xpStateDigest} from '../../../society-experiments/xp-state.js';

test('long experiment reports are authenticated, read only, and cannot select source paths through HTTP',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'long-admin-')),path=join(directory,'absent.sqlite');
    const context={gatewayBots:()=>new Map(),supervisor:{} as BotSupervisor,longExperimentJournalPath:path};
    const url=new URL('http://localhost:7780/api/admin/society/long-experiments/native-test?journal=C:/untrusted.sqlite');
    try{
        expect((await handleAdminRequest(new Request(url),url,context))!.status).toBe(401);
        const response=await handleAdminRequest(new Request(url,{headers:{'X-Admin-Request':'rs-sdk-admin'}}),url,context);
        expect(response!.status).toBe(200);expect(await response!.json()).toMatchObject({status:'unavailable'});expect(existsSync(path)).toBeFalse();
    }finally{rmSync(directory,{recursive:true,force:true});}
});
test('new Phase 12 preflight, environment and exact-run endpoints retain the admin authentication gate',async()=>{
    const context={gatewayBots:()=>new Map(),supervisor:{} as BotSupervisor};
    for(const [method,path] of [['POST','preflight'],['GET','environment'],['GET','10000000-0000-4000-8000-000000000001']]){
        const url=new URL(`http://localhost:7780/api/admin/multi-agent-experiments/${path}`);
        expect((await handleAdminRequest(new Request(url,{method}),url,context))!.status).toBe(401);
    }
});
test('XP baseline endpoints retain admin authentication for reads and mutations',async()=>{
    const context={gatewayBots:()=>new Map(),supervisor:{} as BotSupervisor};
    const url=new URL('http://localhost:7780/api/admin/society/xp-baseline?player=ada');
    for(const method of ['GET','POST'])expect((await handleAdminRequest(new Request(url,{method}),url,context))!.status).toBe(401);
});
test('XP execution reads and recovery retain admin authentication and local-only credentials',async()=>{
    const context={gatewayBots:()=>new Map(),supervisor:{} as BotSupervisor};
    const url=new URL('http://localhost:7780/api/admin/society/xp-execution/10000000-0000-4000-8000-000000000001');
    for(const method of ['GET','POST'])expect((await handleAdminRequest(new Request(url,{method}),url,context))!.status).toBe(401);
    expect(()=>xpExecutionClient('https://example.org','secret')).toThrow('local/private');
    const client=xpExecutionClient('http://localhost:8888','test-token',async(url,init)=>{
        expect(url.pathname).toBe('/api/internal/admin/xp-execution');expect(init.redirect).toBe('error');return Response.json(null);
    });
    expect(await client.read('10000000-0000-4000-8000-000000000001')).toBeNull();
    const forged=xpExecutionClient('http://localhost:8888','test-token',async()=>Response.json({complete:true}));
    await expect(forged.read('10000000-0000-4000-8000-000000000001')).rejects.toThrow();
});
test('XP baseline engine client rejects remote origins and validates native snapshots without following redirects',async()=>{
    expect(()=>xpBaselineClient('https://example.org','secret')).toThrow('local/private');
    const snapshot=makeXpStateSnapshot({},['ada'],xpStateDigest({}),xpStateDigest({}),'2030-01-01T00:00:00.000Z');
    const client=xpBaselineClient('http://localhost:8888','test-token',(async(url:URL,init:RequestInit)=>{
        expect(url.searchParams.getAll('player')).toEqual(['ada']);expect(init.redirect).toBe('error');
        expect((init.headers as Record<string,string>)['X-Engine-Admin-Token']).toBe('test-token');return Response.json(snapshot);
    }));
    expect(await client(['ada'])).toEqual(snapshot);
    const forged=xpBaselineClient('http://localhost:8888','test-token',async()=>Response.json({...snapshot,empty:false}));
    await expect(forged(['ada'])).rejects.toThrow('digest');
});
test('long comparison endpoints retain authentication and ignore untrusted source and evidence selection',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'compare-admin-')),path=join(directory,'absent.sqlite');
    const context={gatewayBots:()=>new Map(),supervisor:{} as BotSupervisor,longExperimentJournalPath:path};
    const url=new URL('http://localhost:7780/api/admin/society/long-experiment-comparison?control=c&treatment=t&axis=diminishing-xp&journal=C:/untrusted.sqlite');
    try{
        expect((await handleAdminRequest(new Request(url),url,context))!.status).toBe(401);
        const response=await handleAdminRequest(new Request(url,{headers:{'X-Admin-Request':'rs-sdk-admin'}}),url,context);
        expect(response!.status).toBe(200);expect(await response!.json()).toMatchObject({status:'unavailable'});expect(existsSync(path)).toBeFalse();
        url.searchParams.set('treatment','c');
        expect((await handleAdminRequest(new Request(url,{headers:{'X-Admin-Request':'rs-sdk-admin'}}),url,context))!.status).toBe(400);
    }finally{rmSync(directory,{recursive:true,force:true});}
});
