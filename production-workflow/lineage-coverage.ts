import type {Database} from 'bun:sqlite';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';

export const lineageProducerPaths=[
    'production-workflow/lineage-coverage.ts','production-workflow/native-material.ts','production-workflow/native-tool-work.ts',
    'production-workflow/native-tool-work-policy.ts','item-lifecycle/native-tool.ts','item-lifecycle/store.ts','item-lifecycle/production-cycle.ts',
    'server/engine/src/mods/NativeFoodConsumption.ts','server/engine/src/mods/NativeFoodConsumptionStore.ts',
    'server/engine/src/mods/NativeFoodProduction.ts','server/engine/src/mods/NativeFoodProductionStore.ts',
    'server/engine/src/mods/NativeFoodLineageStore.ts','server/engine/src/mods/NativeFoodDeliveryStore.ts','server/engine/src/mods/NativeFoodTrade.ts',
    'server/engine/src/mods/NativeFoodProductionPolicy.ts',
    'server/engine/src/mods/NativeMiningTool.ts','server/engine/src/mods/NativeToolWork.ts',
    'server/engine/src/mods/NativeMaterial.ts','server/engine/src/mods/PlayerInventoryEscrowStore.ts',
    'server/engine/src/mods/NativeKitchenStore.ts','food-loop/lineage.ts','food-loop/native-source.ts',
    'society-metrics/tool-maintenance.ts','society-metrics/tool-material-origin.ts','society-metrics/tool-capacity-ledger.ts','society-metrics/lineage-evidence.ts'
] as const;
export const lineageStreams=['native_food_lineage','native_food_delivery','native_tool_event','item_lifecycle_audit','native_tool_work_audit','native_material_event'] as const;
export const lineageTables=[...lineageStreams,'native_food_schema','native_food_actions','native_food_delivery_schema','native_food_delivery_head',
    'native_food_lineage_schema','native_food_lineage_head','native_food_production_schema','native_food_production_actions','native_food_source_quota',
    'native_tool_binding','item_lifecycle_schema','item_instance','item_lifecycle_operation','item_replacement','item_repair_evidence',
    'native_tool_work_schema','native_tool_work','native_tool_work_head','native_material_schema','native_material_lot','native_material_head',
    'player_inventory_escrow','player_inventory_escrow_audit','player_inventory_escrow_business_binding'] as const;
const optionalTables=['native_kitchen_schema','native_kitchen_operation','native_kitchen_audit','native_kitchen_head',
    'native_food_commerce_schema','native_food_commerce_operation','native_food_commerce_audit','native_food_commerce_head'];
export const lineageRegistryDigest=digest({protocol:'native-lineage-producers-v1',paths:lineageProducerPaths,tables:lineageTables,optionalTables});
export interface LineageCursor {registryDigest:string;stateDigest:string;openingCounts:{foodActions:number;productionActions:number;toolJobs:number;materialEvents:number};streams:Record<typeof lineageStreams[number],{count:number;digest:string}>}
/** Read-only seal of existing producers. Missing tables are a gap, never initialization or an empty history. */
export function readLineageSnapshot(db:Database){
    const tables:Record<string,any[]|null>={};
    for(const table of [...lineageTables,...optionalTables]){
        if(optionalTables.includes(table)&&!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)){tables[table]=null;continue;}
        const count=(db.query(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;
        if(count>100000)throw Error('Native lineage row budget exceeded');
        tables[table]=db.query(`SELECT * FROM ${table} ORDER BY rowid`).all();
    }
    const streams=Object.fromEntries(lineageStreams.map(table=>[table,{count:tables[table]!.length,digest:digest(tables[table])}])) as LineageCursor['streams'];
    return{tables,cursor:{registryDigest:lineageRegistryDigest,stateDigest:digest(tables),streams,openingCounts:{foodActions:tables.native_food_actions!.length,
        productionActions:tables.native_food_production_actions!.length,toolJobs:tables.native_tool_work!.length,materialEvents:tables.native_material_event!.length}} satisfies LineageCursor};
}
export function lineagePrefixMatches(c:LineageCursor,snapshot:ReturnType<typeof readLineageSnapshot>){
    return c.registryDigest===lineageRegistryDigest&&(Object.keys(c.openingCounts) as Array<keyof LineageCursor['openingCounts']>).every(k=>c.openingCounts[k]<=snapshot.cursor.openingCounts[k])
        &&lineageStreams.every(table=>{const p=c.streams[table],rows=snapshot.tables[table]!;
        return p.count<=rows.length&&p.digest===digest(rows.slice(0,p.count));});
}
export function validateLineageCursor(c:LineageCursor){const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
    if(!c||!hex(c.registryDigest)||!hex(c.stateDigest)||!c.openingCounts||Object.keys(c.openingCounts).sort().join(',')!=='foodActions,materialEvents,productionActions,toolJobs'
        ||Object.values(c.openingCounts).some(n=>!Number.isSafeInteger(n)||n<0)||!c.streams||Object.keys(c.streams).sort().join(',')!==[...lineageStreams].sort().join(',')
        ||lineageStreams.some(k=>!Number.isSafeInteger(c.streams[k]?.count)||c.streams[k].count<0||!hex(c.streams[k].digest)))throw Error('Invalid native lineage cursor');
}
