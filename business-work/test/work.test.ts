import { afterEach,describe,expect,test } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { BusinessWorkStore,loadDefaultBusinessWorkPolicyCatalog,validateBusinessWorkPolicyCatalog } from '../index.js';

const directories:string[]=[];afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true})});
function fixture(){const directory=mkdtempSync(join(tmpdir(),'business-work-'));directories.push(directory);const path=join(directory,'business.sqlite');
    const manager=new BusinessManagerStore(path);manager.create({businessId:'lumbridge-general-store',name:'Store',summary:'Agent shop.',
        ownerAgentId:'owner',propertyId:'lumbridge-general-store'});const employment=manager.hire('lumbridge-general-store',{
        workerAgentId:'clerk',roleDefinitionId:'business.shop-clerk.v1',title:'Shop clerk',wageGp:25,
        requiredSkill:{id:'trade.lumbridge.give-item',version:'1.0.0'}},undefined,'11111111-1111-4111-8111-111111111111');manager.close();
    return {path,employment,work:new BusinessWorkStore(path)}}
function grant(work:BusinessWorkStore){return work.grantEntitlement({entitlementId:'counter-access',businessId:'lumbridge-general-store',
    propertyId:'lumbridge-general-store',facilityCapability:'retail.counter',validFrom:'2026-09-20T08:00:00.000Z',
    validUntil:'2026-09-20T18:00:00.000Z'},'2026-09-19T10:00:00.000Z')}
function evidence(){return {evidenceId:'run-1',workOrderId:'order-1',businessId:'lumbridge-general-store',workerAgentId:'clerk',
    skill:{id:'trade.lumbridge.give-item',version:'1.0.0'},status:'completed' as const,
    startedAt:'2026-09-20T09:00:00.000Z',completedAt:'2026-09-20T10:00:00.000Z'}}

describe('role-bound Business shifts and work orders',()=>{
    test('snapshots role, wage, shift and facility entitlement then completes from trusted evidence',()=>{const {employment,work}=fixture();try{
        grant(work);const order=work.createWorkOrder('order-1','lumbridge-general-store.shop-clerk.v1',employment.employmentId,
            '2026-09-20T09:00:00.000Z','2026-09-20T10:00:00.000Z');expect(order).toMatchObject({workerAgentId:'clerk',
                roleDefinitionId:'business.shop-clerk.v1',wageGp:25,status:'scheduled',propertyId:'lumbridge-general-store',
                facilityCapability:'retail.counter'});expect(work.start(order.workOrderId,'2026-09-20T09:00:00.000Z').status).toBe('running');
        expect(work.complete(order.workOrderId,evidence(),()=>true)).toMatchObject({status:'completed',actualMinutes:60,evidenceId:'run-1',
            wageStatus:'earned',wageGp:25});expect(()=>work.settleWage(order.workOrderId,'wage-1')).toThrow('trusted exact settlement');
        expect(work.settleWage(order.workOrderId,'wage-1',(completed,id)=>completed.wageGp===25&&id==='wage-1'))
            .toMatchObject({wageStatus:'paid',wageSettlementId:'wage-1'});}finally{work.close()}});
    test('rejects work without the exact Property facility entitlement or schedule',()=>{const {employment,work}=fixture();try{
        expect(()=>work.createWorkOrder('order-1','lumbridge-general-store.shop-clerk.v1',employment.employmentId,
            '2026-09-20T09:00:00.000Z','2026-09-20T10:00:00.000Z')).toThrow('entitlement');grant(work);
        const order=work.createWorkOrder('order-1','lumbridge-general-store.shop-clerk.v1',employment.employmentId,
            '2026-09-20T09:00:00.000Z','2026-09-20T10:00:00.000Z');expect(()=>work.start(order.workOrderId,
            '2026-09-20T08:59:59.000Z')).toThrow('scheduled shift');}finally{work.close()}});
    test('requires trusted exact-worker skill evidence and bounded worked time',()=>{const {employment,work}=fixture();try{grant(work);
        const order=work.createWorkOrder('order-1','lumbridge-general-store.shop-clerk.v1',employment.employmentId,
            '2026-09-20T09:00:00.000Z','2026-09-20T10:00:00.000Z');work.start(order.workOrderId,'2026-09-20T09:00:00.000Z');
        expect(()=>work.complete(order.workOrderId,evidence())).toThrow('not trusted');expect(()=>work.complete(order.workOrderId,
            {...evidence(),workerAgentId:'other'},()=>true)).toThrow('does not match');expect(work.get(order.workOrderId)?.status).toBe('running');
    }finally{work.close()}});
    test('validates bounded role policy and stable catalog evidence',()=>{const catalog=loadDefaultBusinessWorkPolicyCatalog(),policy=catalog.policies[0]!;
        expect(catalog.digest).toHaveLength(64);expect(()=>validateBusinessWorkPolicyCatalog({schemaVersion:1,policies:[{...policy,
            minimumMinutes:500,maximumMinutes:100}]})).toThrow()});
    test('expires an abandoned order and accepts real elapsed time that is not millisecond-aligned',()=>{
        const {employment,work}=fixture();try{grant(work);work.createWorkOrder('expired-order',
            'lumbridge-general-store.shop-clerk.v1',employment.employmentId,'2026-09-20T09:00:00.000Z',
            '2026-09-20T10:00:00.000Z');work.start('expired-order','2026-09-20T09:00:00.000Z');
        expect(()=>work.expire('expired-order','2026-09-20T09:30:00.000Z')).toThrow('expired');
        expect(work.expire('expired-order','2026-09-20T10:01:00.000Z')).toMatchObject({status:'cancelled',wageStatus:'unearned'});
        work.createWorkOrder('real-time-order','lumbridge-general-store.shop-clerk.v1',employment.employmentId,
            '2026-09-20T09:00:00.000Z','2026-09-20T10:00:00.000Z');work.start('real-time-order','2026-09-20T09:00:00.000Z');
        expect(work.complete('real-time-order',{...evidence(),evidenceId:'real-time-proof',workOrderId:'real-time-order',
            completedAt:'2026-09-20T09:15:17.250Z'},()=>true)).toMatchObject({status:'completed',actualMinutes:15})
        }finally{work.close()}});
});
