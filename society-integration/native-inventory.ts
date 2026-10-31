/** Genesis item allocations specify quantities, not physical inventory slot grouping.
 * Non-stackable items occupy separate native slots; no quantity or item identity may change. */
export function nativeInventoryQuantities(input:unknown):Array<{id:number;count:number}>{
        if(!Array.isArray(input))throw Error('Invalid native inventory');
        const result=new Map<number,number>();
        for(const item of input){
            if(!item||Object.keys(item).sort().join(',')!=='count,id'||!Number.isSafeInteger(item.id)||item.id<0||item.id>65534
                ||!Number.isSafeInteger(item.count)||item.count<1)throw Error('Invalid native inventory item');
            const count=(result.get(item.id)??0)+item.count;if(!Number.isSafeInteger(count))throw Error('Native inventory count overflow');result.set(item.id,count);
        }
        return [...result].sort(([a],[b])=>a-b).map(([id,count])=>({id,count}));
}
export function equalNativeInventoryQuantities(actual:unknown,planned:unknown):boolean{
    try{return JSON.stringify(nativeInventoryQuantities(actual))===JSON.stringify(nativeInventoryQuantities(planned));}catch{return false;}
}
