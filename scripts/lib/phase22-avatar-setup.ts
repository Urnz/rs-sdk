export interface Phase22SetupItem { id:number; count:number; slot?:number }

/**
 * Keep the one tool needed by the acceptance actor and bank everything else.
 * The offline edit is transactional, so bank capacity or item validation errors
 * reject the whole setup instead of dropping an item.
 */
export function reservePhase22ActorInventory(inventory:Phase22SetupItem[],bank:Phase22SetupItem[]){
    const nextInventory:Phase22SetupItem[]=[];const nextBank=bank.map(item=>({...item}));let keptLockpick=false;
    for(const item of inventory){
        if(item.id===1523&&!keptLockpick){nextInventory.push({...item});keptLockpick=true}
        else nextBank.push({...item});
    }
    if(!keptLockpick)nextInventory.push({id:1523,count:1});
    return{inventory:nextInventory,bank:nextBank,addedLockpick:!keptLockpick};
}

export function phase22ItemTotals(...groups:Phase22SetupItem[][]){
    const totals=new Map<number,number>();for(const group of groups)for(const item of group)
        totals.set(item.id,(totals.get(item.id)??0)+item.count);
    return[...totals].sort(([a],[b])=>a-b);
}
