import { expect,test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { NativeMaterialStore,type NativeMaterialFact } from '../native-material.js';
import { OwnedDatabase } from '../../server/engine/src/io/OwnedDatabase.js';
const owner={actorId:'ada',username:'ada',lifecycleId:'life-ada',worldId:'private',clockId:'clock',clockProfileDigest:'a'.repeat(64)},
    clock={clockId:'clock',profileDigest:owner.clockProfileDigest,status:'running' as const,revision:1,engineTick:1,wallTime:'2026-10-27T12:00:00.000Z',simulationTime:'2001-01-01T00:00:00.000Z'};
function fixture(){const db=new OwnedDatabase(':memory:');db.run('PRAGMA user_version=42');let store!:NativeMaterialStore;
    db.transaction(()=>store=new NativeMaterialStore(db,true)).immediate();
    const append=(f:NativeMaterialFact)=>db.transaction(()=>store.append(f)).immediate();
    const mine=(itemId:number):Extract<NativeMaterialFact,{kind:'mining'}>=>({kind:'mining',itemId,lotId:`mine:${itemId}`,nativeEventId:String(itemId),nativeEventDigest:'b'.repeat(64),owner,clock});
    return{db,store,append,mine};}
test('own prospective schema preserves shared user_version; exact lots are single-spend and reopen read-only without writes',()=>{
    const f=fixture();try{
        expect(f.db.query('PRAGMA user_version').get()).toEqual({user_version:42});const a=f.append(f.mine(436));expect(f.append(f.mine(436))).toEqual(a);f.append(f.mine(438));
        const id=randomUUID(),hold:NativeMaterialFact={kind:'hold',operationId:id,escrowId:randomUUID(),workKind:'smelt',intentDigest:'c'.repeat(64),owner,clock,
            inputs:[{itemId:436,slot:1,lotId:'mine:436'},{itemId:438,slot:2,lotId:'mine:438'}]};f.append(hold);
        f.append({kind:'smelt',operationId:id,lotId:`smelt:${id}`,itemId:2349,owner,clock,nativeEventId:`work:${id}`,nativeEventDigest:'d'.repeat(64)});
        const before=f.db.serialize(),source=NativeMaterialStore.read(f.db);expect(f.db.serialize()).toEqual(before);
        expect(source.lots.get(`smelt:${id}`)).toMatchObject({internal:true,spentBy:null});
        expect(()=>f.append({...hold,operationId:randomUUID()})).toThrow('already held');
        expect(f.db.serialize()).toEqual(before);expect(()=>f.append({...f.mine(436),nativeEventDigest:'e'.repeat(64)})).toThrow('reused');
    }finally{f.db.close(true);}
});
test('unknown input cannot become internal bronze; failed checkpoint rolls back minted and spent lots together',()=>{
    const f=fixture();try{f.append(f.mine(436));const id=randomUUID(),hold:NativeMaterialFact={kind:'hold',operationId:id,escrowId:randomUUID(),workKind:'smelt',intentDigest:'c'.repeat(64),owner,clock,
        inputs:[{itemId:436,slot:1,lotId:'mine:436'},{itemId:438,slot:2,lotId:null}]};
        expect(()=>f.db.transaction(()=>{f.store.append(hold);throw Error('checkpoint fault');}).immediate()).toThrow('checkpoint fault');
        expect(NativeMaterialStore.read(f.db).holds.size).toBe(0);expect(f.store.lot('mine:436')!.spentBy).toBeNull();
        f.append(hold);f.append({kind:'smelt',operationId:id,lotId:`smelt:${id}`,itemId:2349,owner,clock,nativeEventId:`work:${id}`,nativeEventDigest:'d'.repeat(64)});
        expect(NativeMaterialStore.read(f.db).lots.get(`smelt:${id}`)!.internal).toBeFalse();
    }finally{f.db.close(true);}
});
test('foreign owners, wrong quantities, time reversal, altered projection and truncated history fail closed',()=>{
    const f=fixture();try{f.append(f.mine(436));f.append(f.mine(438));
        const hold:NativeMaterialFact={kind:'hold',operationId:randomUUID(),escrowId:randomUUID(),workKind:'smelt',intentDigest:'c'.repeat(64),owner,clock,
            inputs:[{itemId:436,slot:1,lotId:'mine:436'},{itemId:438,slot:2,lotId:'mine:438'}]};
        expect(()=>f.append({...hold,owner:{...owner,lifecycleId:'foreign'}})).toThrow('foreign');
        expect(()=>f.append({...hold,clock:{...clock,simulationTime:'2000-01-01T00:00:00.000Z'}})).toThrow();
        expect(()=>f.append({...hold,inputs:[hold.inputs[0]!]})).toThrow('hold');
        f.db.run("UPDATE native_material_lot SET internal=0 WHERE lot_id='mine:436'");expect(()=>NativeMaterialStore.read(f.db)).toThrow('projection');
        f.db.run("UPDATE native_material_lot SET internal=2 WHERE lot_id='mine:436'");expect(()=>NativeMaterialStore.read(f.db)).toThrow('projection');
        f.db.run("UPDATE native_material_lot SET internal=1 WHERE lot_id='mine:436'");
        expect(()=>f.db.run('DELETE FROM native_material_event WHERE sequence=2')).toThrow('immutable');
        f.db.run('DROP TRIGGER native_material_no_delete');f.db.run('DELETE FROM native_material_event WHERE sequence=2');
        expect(()=>NativeMaterialStore.read(f.db)).toThrow();
    }finally{f.db.close(true);}
});
test('old checkpoint without explicit initialization remains legacy and is never backfilled',()=>{
    const db=new OwnedDatabase(':memory:');try{expect(NativeMaterialStore.present(db)).toBeFalse();
        expect(()=>new NativeMaterialStore(db)).toThrow('explicit');expect(()=>NativeMaterialStore.read(db)).toThrow();
        expect(db.query("SELECT name FROM sqlite_master WHERE name LIKE 'native_material_%'").all()).toHaveLength(0);
    }finally{db.close(true);}
});
