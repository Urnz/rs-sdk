import { afterEach,describe,expect,test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decideFencingParticipation,fencingMarketPolicyDigest,FencingSettlementCoordinator,loadDefaultFencingMarketPolicy,
    type FencingCandidateSnapshot,type FencingOpportunity,type FencingSettlementPorts,
    type FencingSettlementRequest,type FencingTradeReceipt } from '../index.js';

const directories:string[]=[];afterEach(()=>directories.splice(0).forEach(value=>rmSync(value,{recursive:true,force:true})));
function path():string{const directory=mkdtempSync(join(tmpdir(),'fencing-settlement-'));directories.push(directory);
    return join(directory,'settlement.sqlite')}
const candidate=(kind:'agent'|'business'='business'):FencingCandidateSnapshot=>({candidateId:kind==='business'?'shadow-traders':'buyer',
    kind,operatorAgentId:'buyer',lifecycleStatus:'active',availableGp:100,storageAvailableUnits:5,
    capabilities:['trade.appraise'],relationships:[{counterpartyAgentId:'thief',familiarity:60,trust:30}],
    sourceEvidenceDigest:'a'.repeat(64)});
const opportunity:FencingOpportunity={opportunityId:'offer-1',sellerAgentId:'thief',itemId:1265,quantity:1,
    assetId:'pickaxe-1',provenanceDigest:'b'.repeat(64),storageUnits:1,acquisitionCostGp:40,expectedResaleGp:80,
    estimatedRiskCostGp:10,requiredCapabilities:['trade.appraise'],sourceEvidenceDigest:'c'.repeat(64)};
const trade:FencingTradeReceipt={receiptId:'trade-1',buyerAgentId:'buyer',sellerAgentId:'thief',itemId:1265,quantity:1,
    coinsPaid:40,assetId:'pickaxe-1',assetRevision:3,provenanceDigest:'b'.repeat(64),status:'committed',partial:false,
    sourceEvidenceDigest:'d'.repeat(64),occurredAt:'2030-01-01T00:00:00.000Z'};
function request(kind:'agent'|'business'='business'):FencingSettlementRequest{const actor=candidate(kind);return{
    settlementId:'11111111-1111-4111-8111-111111111111',reservationId:kind==='business'?'fencing.offer-1':null,
    storageId:kind==='business'?'shadow-vault':null,candidate:actor,opportunity,
    decision:decideFencingParticipation(loadDefaultFencingMarketPolicy(),actor,opportunity),trade}}

describe('restart-safe fencing settlement',()=>{
    test('resumes after a partial failure without repeating committed ledger steps',()=>{const calls:string[]=[],ports:FencingSettlementPorts={
            commitProvenance:input=>{calls.push(`provenance:${input.operationId}`)},
            commitBusinessStock:input=>{calls.push(`stock:${input.operationId}`);if(calls.filter(value=>value.startsWith('stock')).length===1)
                throw new Error('temporary stock failure')},commitBusinessMoney:input=>{calls.push(`money:${input.settlementId}`)}};
        const store=new FencingSettlementCoordinator(path(),loadDefaultFencingMarketPolicy(),ports);try{
            expect(()=>store.settle(request(),()=>true)).toThrow('temporary stock failure');
            expect(store.get(request().settlementId)).toMatchObject({provenanceCommitted:true,stockCommitted:false,
                moneyCommitted:false,status:'settling',lastError:'temporary stock failure'});
            expect(store.settle(request(),()=>true,'2030-01-01T00:01:00.000Z')).toMatchObject({provenanceCommitted:true,
                stockCommitted:true,moneyCommitted:true,status:'committed',lastError:null});
            expect(calls.filter(value=>value.startsWith('provenance'))).toHaveLength(1);
            expect(calls.filter(value=>value.startsWith('stock'))).toHaveLength(2);
            expect(calls.filter(value=>value.startsWith('money'))).toHaveLength(1);expect(store.verifyAuditChain()).toBeTrue()
        }finally{store.close()}});
    test('uses only provenance for an agent whose physical trade already moved personal money and inventory',()=>{
        const calls:string[]=[],ports:FencingSettlementPorts={commitProvenance:()=>{calls.push('provenance')},
            commitBusinessStock:()=>{calls.push('stock')},commitBusinessMoney:()=>{calls.push('money')}};
        const store=new FencingSettlementCoordinator(path(),loadDefaultFencingMarketPolicy(),ports);try{
            expect(store.settle(request('agent'),()=>true)).toMatchObject({status:'committed',stockCommitted:true,moneyCommitted:true});
            expect(calls).toEqual(['provenance']);expect(store.verifyAuditChain()).toBeTrue()}finally{store.close()}});
    test('rejects untrusted or mismatched trade before journalling',()=>{const ports:FencingSettlementPorts={
            commitProvenance:()=>{},commitBusinessStock:()=>{},commitBusinessMoney:()=>{}};
        const store=new FencingSettlementCoordinator(path(),loadDefaultFencingMarketPolicy(),ports);try{
            expect(()=>store.settle(request(),()=>false)).toThrow('not trusted');expect(store.get(request().settlementId)).toBeNull();
            expect(()=>store.settle({...request(),trade:{...trade,coinsPaid:39}},()=>true)).toThrow('does not match');
            expect(store.get(request().settlementId)).toBeNull()}finally{store.close()}});
    test('detects mutation of the persisted settlement journal',()=>{const databasePath=path(),ports:FencingSettlementPorts={
            commitProvenance:()=>{},commitBusinessStock:()=>{},commitBusinessMoney:()=>{}};
        const store=new FencingSettlementCoordinator(databasePath,loadDefaultFencingMarketPolicy(),ports);
        store.settle(request(),()=>true);store.close();const database=new Database(databasePath);
        database.run("UPDATE fencing_settlement SET stock_committed=0 WHERE settlement_id=?1",[request().settlementId]);database.close();
        const reopened=new FencingSettlementCoordinator(databasePath,loadDefaultFencingMarketPolicy(),ports);
        try{expect(reopened.verifyAuditChain()).toBeFalse()}finally{reopened.close()}});
});

describe('audit-bound recorded fencing request evidence',()=>{
    const ports:FencingSettlementPorts={commitProvenance:()=>{},commitBusinessStock:()=>{},commitBusinessMoney:()=>{}};
    test('returns null for a missing request and rejects invalid ids',()=>{
        const store=new FencingSettlementCoordinator(path(),loadDefaultFencingMarketPolicy(),ports);try{
            expect(store.getRecordedRequest(request().settlementId)).toBeNull();
            expect(()=>store.getRecordedRequest('offer-1')).toThrow('settlementId is invalid')
        }finally{store.close()}});
    test('reads the exact request while settling and after commit, without repeating callbacks',()=>{
        let blocked=true,sourceCalls=0,ledgerCalls=0;
        const store=new FencingSettlementCoordinator(path(),loadDefaultFencingMarketPolicy(),{
            commitProvenance:()=>{ledgerCalls++;if(blocked)throw new Error('blocked')},
            commitBusinessStock:()=>{ledgerCalls++},commitBusinessMoney:()=>{ledgerCalls++}});
        const input=structuredClone(request()),verify=()=>{sourceCalls++;return true};try{
            expect(()=>store.settle(input,verify)).toThrow('blocked');
            expect(store.getRecordedRequest(` ${input.settlementId.toUpperCase()} `)).toEqual(input);
            expect(sourceCalls).toBe(1);expect(ledgerCalls).toBe(1);
            blocked=false;store.settle(input,verify);const before=[sourceCalls,ledgerCalls];
            expect(store.getRecordedRequest(input.settlementId)).toEqual(input);
            expect([sourceCalls,ledgerCalls]).toEqual(before)
        }finally{store.close()}});
    test('returns detached deeply frozen evidence, including nested arrays and objects',()=>{
        const store=new FencingSettlementCoordinator(path(),loadDefaultFencingMarketPolicy(),ports);
        const input=structuredClone(request());try{store.settle(input,()=>true);
            const first=store.getRecordedRequest(input.settlementId)!,second=store.getRecordedRequest(input.settlementId)!;
            expect(first).not.toBe(second);expect(first.candidate).not.toBe(input.candidate);
            const assertFrozen=(value:unknown):void=>{if(value&&typeof value==='object'){
                expect(Object.isFrozen(value)).toBeTrue();Object.values(value).forEach(assertFrozen)}};assertFrozen(first);
            expect(()=>first.candidate.capabilities.push('mutated')).toThrow();
            expect(()=>{first.candidate.relationships[0]!.trust=100}).toThrow();
            input.candidate.relationships[0]!.trust=0;input.opportunity.expectedResaleGp=0;
            expect(store.getRecordedRequest(input.settlementId)).toEqual(second)
        }finally{store.close()}});
    test('survives restart and later policy or live state changes without validating historical participation',()=>{
        const databasePath=path(),input=structuredClone(request());
        const store=new FencingSettlementCoordinator(databasePath,loadDefaultFencingMarketPolicy(),ports);
        store.settle(input,()=>true);store.close();
        input.candidate.lifecycleStatus='deceased';input.candidate.availableGp=0;
        const {digest:unused,...definition}=loadDefaultFencingMarketPolicy();
        const changed={...definition,minimumExpectedProfitGp:1_000_000};
        let calls=0;const reopened=new FencingSettlementCoordinator(databasePath,
            {...changed,digest:fencingMarketPolicyDigest(changed)},{commitProvenance:()=>{calls++;throw new Error('no live writes')},
                commitBusinessStock:()=>{calls++},commitBusinessMoney:()=>{calls++}});
        try{expect(reopened.getRecordedRequest(input.settlementId)).toEqual(request());expect(calls).toBe(0)
        }finally{reopened.close()}});
    test.each(['settlement_id','candidate_id','opportunity_id','trade_receipt_id','request_json','request_digest'])(
        'fails closed when persisted %s disagrees with the recorded request',column=>{
            const databasePath=path(),input=request(),store=new FencingSettlementCoordinator(databasePath,loadDefaultFencingMarketPolicy(),ports);
            store.settle(input,()=>true);store.close();const database=new Database(databasePath);
            const changed=column==='request_json'?JSON.stringify({...input,storageId:'other-vault'}):column==='request_digest'?'f'.repeat(64):'tampered';
            database.run(`UPDATE fencing_settlement SET ${column}=?1`,[changed]);database.close();
            const reopened=new FencingSettlementCoordinator(databasePath,loadDefaultFencingMarketPolicy(),ports);try{
                expect(reopened.verifyAuditChain()).toBeFalse();
                expect(()=>reopened.getRecordedRequest(input.settlementId)).toThrow('audit integrity mismatch')
            }finally{reopened.close()}});
    test('fails closed on malformed request JSON and audit mutation',()=>{
        for(const sql of ["UPDATE fencing_settlement SET request_json='{'",
            "UPDATE fencing_settlement_audit SET request_digest='tampered' WHERE step='planned'"]){
            const databasePath=path(),store=new FencingSettlementCoordinator(databasePath,loadDefaultFencingMarketPolicy(),ports);
            store.settle(request(),()=>true);store.close();const database=new Database(databasePath);database.run(sql);database.close();
            const reopened=new FencingSettlementCoordinator(databasePath,loadDefaultFencingMarketPolicy(),ports);try{
                expect(reopened.verifyAuditChain()).toBeFalse();
                expect(()=>reopened.getRecordedRequest(request().settlementId)).toThrow('audit integrity mismatch')
            }finally{reopened.close()}}});
    test('rejects a rewritten request even when its settlement digest was recomputed',()=>{
        const databasePath=path(),input=structuredClone(request());
        const store=new FencingSettlementCoordinator(databasePath,loadDefaultFencingMarketPolicy(),ports);
        store.settle(input,()=>true);store.close();input.opportunity.expectedResaleGp=800;
        const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
            ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)])):value;
        const json=JSON.stringify(canonical(input)),digest=createHash('sha256').update(json).digest('hex');
        const database=new Database(databasePath);database.run('UPDATE fencing_settlement SET request_json=?1,request_digest=?2',[json,digest]);
        database.close();const reopened=new FencingSettlementCoordinator(databasePath,loadDefaultFencingMarketPolicy(),ports);try{
            expect(reopened.verifyAuditChain()).toBeFalse();
            expect(()=>reopened.getRecordedRequest(input.settlementId)).toThrow('audit integrity mismatch')
        }finally{reopened.close()}});
});
