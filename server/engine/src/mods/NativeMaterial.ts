import type { Database } from 'bun:sqlite';
import InvType from '../cache/config/InvType.js';
import type Player from '../engine/entity/Player.js';
import { NativeMaterialStore,type NativeMaterialFact } from '../../../../production-workflow/native-material.js';
import { nativeToolDigest as hash,type NativeToolOwner } from '../../../../item-lifecycle/native-tool.js';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';

type Item={id:number;count:number};
// Physical object identity, never an itemId/count lookup. Reload and copied/moved inventory objects have no implicit provenance.
const tokens=new WeakMap<Item,{db:Database;lotId:string;ownerDigest:string}>();
export function nativeMaterialReferences(player:Player){return new Set(player.getInventory(InvType.INV)!.items.filter((i):i is Item=>!!i));}
export function nativeMaterialMint(db:Database,player:Player,owner:NativeToolOwner,clock:SimulationClockObservation,nativeEventId:string,
    nativeEventDigest:string,itemId:number,before:Set<Item>,operationId?:string):(()=>void)|null{
    if(!NativeMaterialStore.present(db))return null;
    const store=new NativeMaterialStore(db);
    if(operationId&&!store.entry(`hold:${operationId}`))return null; // Legacy WIP did not capture prospective inputs.
    const copies=player.getInventory(InvType.INV)!.items.filter((i):i is Item=>!!i&&i.id===itemId&&!before.has(i));
    if(copies.length!==1||copies[0]!.count!==1)throw Error('Native material output identity is ambiguous');
    const fact:NativeMaterialFact=operationId?{kind:'smelt',lotId:`smelt:${operationId}`,itemId:2349,operationId,owner,clock,nativeEventId,nativeEventDigest}
        :{kind:'mining',lotId:`mine:${nativeEventId}`,itemId,owner,clock,nativeEventId,nativeEventDigest};
    store.append(fact);const reference=copies[0]!;
    // Only publish the volatile token after the enclosing native checkpoint transaction commits.
    return()=>tokens.set(reference,{db,lotId:fact.lotId,ownerDigest:hash(owner)});
}
export function nativeMaterialInputs(db:Database,player:Player,owner:NativeToolOwner,kind:'smelt'|'repair'){
    if(!NativeMaterialStore.present(db))return null;
    const inventory=player.getInventory(InvType.INV)!,store=new NativeMaterialStore(db),ownerDigest=hash(owner);
    return(kind==='smelt'?[436,438]:[2349]).map(itemId=>{
        // Player.invDel/Inventory.remove consumes from the first matching slot.
        const slot=inventory.getItemIndex(itemId),reference=inventory.get(slot);if(slot<0||!reference)throw Error('Native material input missing');
        const token=tokens.get(reference),lot=token?.db===db&&token.ownerDigest===ownerDigest?store.lot(token.lotId):null;
        const unique=[...player.invs.values()].flatMap(inv=>inv.items).filter(i=>i===reference).length===1;
        return{itemId,slot,lotId:reference.count===1&&unique&&lot?.itemId===itemId&&lot.spentBy===null?lot.lotId:null};
    });
}
