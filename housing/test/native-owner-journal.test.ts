import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {resolve,join} from 'node:path';
import {cpSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {nativeHousingCatalogs} from '../native-rent.js';
import {appendOwnerBedReservation,readOwnerBedReservations,validateOwnerBedBinding,type NativeOwnerBedBinding} from '../native-owner.js';
import {foodDigest} from '../../server/engine/src/mods/NativeFoodConsumptionStore.js';
const catalogs=nativeHousingCatalogs(resolve(import.meta.dir,'../..'));
function binding(){const intent={operationId:'owner-slot-1',worldId:'world',clockId:'world',clockProfileDigest:'a'.repeat(64),
    owner:{agentId:'owner',username:'owner',lifecycleId:'owner-life'},housingUnitId:catalogs.native.housingUnitId,bedSlotId:catalogs.native.beds[0]!.bedSlotId,
    propertyVersion:2,startsAt:'2001-01-01T00:00:00.000Z',endsAt:'2001-01-02T00:00:00.000Z',catalogs};return{intent,digest:foodDigest(intent)};}
test('legacy owner absence is readonly empty; atomic first-use setup rolls back with its admission',()=>{
    const db=new Database(':memory:');try{
        const before=db.serialize();expect(readOwnerBedReservations(db)).toEqual([]);expect(db.serialize()).toEqual(before);
        expect(()=>appendOwnerBedReservation(db,binding())).toThrow('transaction');
        expect(()=>db.transaction(()=>{appendOwnerBedReservation(db,binding());throw Error('stop before commit');})()).toThrow('before commit');
        expect(readOwnerBedReservations(db)).toEqual([]);expect(db.query("SELECT 1 FROM sqlite_master WHERE name='housing_owner_schema'").get()).toBeNull();
    }finally{db.close();}
});
test('owner audit and exact replay survive a readonly database image; no rent table or payment is created',()=>{
    const db=new Database(':memory:');try{
        db.transaction(()=>appendOwnerBedReservation(db,binding()))();db.transaction(()=>appendOwnerBedReservation(db,binding()))();
        expect(readOwnerBedReservations(db)).toEqual([binding()]);
        const reopened=Database.deserialize(db.serialize(),true);try{const before=reopened.serialize();
            expect(readOwnerBedReservations(reopened)).toEqual([binding()]);expect(reopened.serialize()).toEqual(before);
            expect(reopened.query("SELECT 1 FROM sqlite_master WHERE name IN ('housing_tenancy','native_rent_operation')").get()).toBeNull();
        }finally{reopened.close();}
        expect(()=>db.run("DELETE FROM housing_owner_reservation")).toThrow('immutable');
        const changed=binding();changed.intent.owner.lifecycleId='new-life';changed.digest=foodDigest(changed.intent);
        expect(()=>db.transaction(()=>appendOwnerBedReservation(db,changed))()).toThrow('reused');
    }finally{db.close();}
});
test('partial schema, unsupported version and a deleted audit tail are fail-closed',()=>{
    for(const mode of ['partial','version','tail'] as const){const db=new Database(':memory:');try{
        if(mode==='partial')db.run('CREATE TABLE housing_owner_head(id INTEGER)');
        else{db.transaction(()=>appendOwnerBedReservation(db,binding()))();
            if(mode==='version')db.run('UPDATE housing_owner_schema SET version=2');else db.run('UPDATE housing_owner_head SET sequence=2');}
        expect(()=>readOwnerBedReservations(db)).toThrow();
        expect(()=>db.transaction(()=>appendOwnerBedReservation(db,binding()))()).toThrow();
    }finally{db.close();}}
});
test('owner reservations require exact positive period, real slot, property revision and binding digest',()=>{
    for(const edit of [(b:NativeOwnerBedBinding)=>{b.intent.endsAt=b.intent.startsAt;},(b:NativeOwnerBedBinding)=>{b.intent.bedSlotId='invented';},
        (b:NativeOwnerBedBinding)=>{b.intent.propertyVersion=0;},(b:NativeOwnerBedBinding)=>{b.intent.owner.username='UPPER';}]){
        const b=binding();edit(b);b.digest=foodDigest(b.intent);expect(()=>validateOwnerBedBinding(b)).toThrow();}
    const b=binding();b.digest='b'.repeat(64);expect(()=>validateOwnerBedBinding(b)).toThrow();
});
test('different bed IDs cannot multiply one physical bed into two capacity slots',()=>{
    const root=mkdtempSync(join(tmpdir(),'owner-physical-bed-'));try{
        cpSync(resolve(import.meta.dir,'../../config'),join(root,'config'),{recursive:true});
        const path=join(root,'config/native-housing.json'),mapping=JSON.parse(readFileSync(path,'utf8'));
        mapping.beds[1]={...mapping.beds[0],bedSlotId:mapping.beds[1].bedSlotId};writeFileSync(path,JSON.stringify(mapping));
        expect(()=>nativeHousingCatalogs(root)).toThrow('bed mapping');
    }finally{rmSync(root,{recursive:true,force:true});}
});
