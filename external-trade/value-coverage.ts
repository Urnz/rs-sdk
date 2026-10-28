import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstatSync} from 'node:fs';
import {OwnedDatabase} from '../server/engine/src/io/OwnedDatabase.js';
import {readNativeTradeLedger,ZERO} from './source.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import {verifyLegacyTreasuryCreditArchive} from '../server/gateway/admin/institution-treasury-migration.js';
import type {NativeCommerceRecord} from '../server/engine/src/mods/NativeCommerceStore.js';

/** Only consumes a receipt already verified by readNativeCommerce; never a query-supplied origin label. */
export function isInternalTreasuryCommerce(r:any,receipt:NativeCommerceRecord|undefined,scope:{clockId:string;clockProfileDigest:string},worldId:string,
    founders:readonly {username:string;actorId:string}[]){
    const i=receipt?.binding.intent,people=new Map(founders.map(f=>[f.username,f]));
    return !!(receipt?.phase==='completed'&&i&&i.kind==='sale'&&i.worldId===worldId&&i.clockId===scope.clockId&&i.clockProfileDigest===scope.clockProfileDigest
        &&i.businessId===r.actor_id&&r.actor_kind==='business'&&i.quantity*i.unitPriceGp===r.amount_gp&&r.source_ref===`trade:${receipt.trade?.eventId}`
        &&people.get(i.worker.username)?.actorId===i.worker.agentId&&people.get(i.counterparty.username)?.actorId===i.counterparty.agentId);
}

export const externalValueSourcePaths=[
    'external-trade/value-coverage.ts','external-trade/source.ts','external-trade/engine-clock.ts',
    'server/engine/src/mods/TradeEvidenceStore.ts','server/engine/src/engine/entity/tracking/TradeLedger.ts',
    'server/engine/src/engine/script/handlers/InvOps.ts','server/engine/src/engine/script/handlers/DebugOps.ts',
    'server/engine/src/mods/ShopEconomyPolicy.ts','server/engine/src/util/WorldConfig.ts','server/engine/src/util/Environment.ts',
    'server/content/scripts/shop/scripts/shop.rs2','server/engine/src/engine/market/MarketStore.ts','server/engine/src/engine/market/GrandExchange.ts',
    'server/engine/src/mods/NativeCommerce.ts','server/engine/src/mods/NativeCommerceRuntime.ts','server/engine/src/mods/NativeCommerceStore.ts',
    'agent-operated-shop/native-commerce.ts','agent-operated-shop/native-commerce-runtime.ts','agent-operated-shop/lifecycle.ts',
    'server/gateway/admin/institution-treasury-migration.ts'
] as const;
export const externalValueRegistryDigest=digest({protocol:'native-external-value-producers-v1',paths:externalValueSourcePaths});
export interface ExternalValueHead {sequence:number;hash:string}
export interface ExternalValueCursor {registryDigest:string;shopMode:'legacy'|'closed-society';
    trades:ExternalValueHead;tradeStateDigest:string;market:ExternalValueHead;marketStateDigest:string;marketOfferCount:number;
    marketEnabled:boolean;marketSourceDigest:string;
    tradeSourceDigest:string;treasurySourceDigest:string;
    treasury:ExternalValueHead;treasuryStateDigest:string}
export const disabledExternalMarket=()=>({offers:[],trades:[],head:{sequence:0,hash:ZERO},stateDigest:digest('native-grand-exchange-disabled')});
export const externalMarketSourceDigest=(root:string,path:string)=>digest(relative(resolve(root),resolve(path)).replaceAll('\\','/'));
function check(v:unknown):asserts v {if(!v)throw Error('Native external value source differs');}
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function rows(db:Database,table:string){check((db.query(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n<=100000);return db.query(`SELECT * FROM ${table}`).all() as any[];}
function readFile<T>(root:string,path:string,read:(db:Database)=>T):T{
    const rel=relative(resolve(root),resolve(path));check(rel&&!rel.startsWith('..')&&!isAbsolute(rel));
    let full=resolve(root);for(const part of rel.split(/[\\/]/)){full=join(full,part);check(!lstatSync(full).isSymbolicLink());}
    check(lstatSync(path).isFile()&&lstatSync(path).size<=256*1024*1024);const db=new OwnedDatabase(path,{readonly:true});
    try{for(const {name} of db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]){check(/^[a-z_][a-z0-9_]*$/.test(name));check((db.query(`SELECT COUNT(*) n FROM ${name}`).get() as {n:number}).n<=100000);}
        let result!:T;db.transaction(()=>{result=read(db);}).deferred();return result;
    }finally{db.close(true);}
}
export function readExternalValueMarket(db:Database){
    const offers=rows(db,'offers').sort((a,b)=>a.id-b.id),trades=rows(db,'trades').sort((a,b)=>a.id-b.id),byId=new Map(offers.map(o=>[o.id,o]));
    const entries:Array<{sequence:number;hash:string;row:any;buyer:string;seller:string}>=[];let previous=ZERO;
    for(const [i,t] of trades.entries()){const buy=byId.get(t.buy_offer),sell=byId.get(t.sell_offer);
        check(t.id===i+1&&buy?.side==='buy'&&sell?.side==='sell'&&buy.item===t.item&&sell.item===t.item&&buy.owner!==sell.owner
            &&[t.quantity,t.price,t.gross].every(v=>Number.isSafeInteger(v)&&v>0)&&t.gross===t.quantity*t.price&&Number.isSafeInteger(t.tax)&&t.tax>=0&&t.tax<=t.gross&&Number.isSafeInteger(t.time));
        const identity=(o:any)=>({id:o.id,owner:o.owner,item:o.item,side:o.side,quantity:o.quantity,price:o.price,created:o.created});
        const hash=digest({previous,row:t,buy:identity(buy),sell:identity(sell)});entries.push({sequence:i+1,hash,row:t,buyer:buy.owner,seller:sell.owner});previous=hash;}
    return{offers,trades:entries,head:{sequence:entries.length,hash:previous},stateDigest:digest({offers,trades})};
}
export function readExternalValueTreasury(db:Database){
    verifyLegacyTreasuryCreditArchive(db);const credits=rows(db,'institution_treasury_external_credit').sort((a,b)=>a.settlement_id.localeCompare(b.settlement_id)),
        audits=rows(db,'institution_treasury_external_credit_audit').sort((a,b)=>a.sequence-b.sequence),byId=new Map(credits.map(r=>[r.settlement_id,r]));
    check(credits.length===audits.length);let previous='genesis';
    const entries=audits.map((a,i)=>{const r=byId.get(a.settlement_id);check(r&&a.sequence===i+1&&a.previous_hash===previous
        &&Number.isSafeInteger(r.amount_gp)&&r.amount_gp>0&&Number.isFinite(Date.parse(r.created_at))
        &&a.receipt_hash===sha([r.settlement_id,r.actor_kind,r.actor_id,r.amount_gp,r.source_ref,r.created_at])
        &&a.audit_hash===sha([a.sequence,r.settlement_id,a.receipt_hash,previous]));previous=a.audit_hash;return{sequence:i+1,hash:previous,row:r};});
    return{entries,head:{sequence:entries.length,hash:entries.length?previous:ZERO},stateDigest:digest({credits,audits})};
}
export function readExternalValueSnapshot(root:string,paths:{tradePath:string;treasuryPath:string;marketPath?:string},shopMode:ExternalValueCursor['shopMode'],marketEnabled:boolean){
    check(shopMode==='legacy'||shopMode==='closed-society');
    // Bound the native reader before it allocates/verifies the complete trade chain. No registration, writes or backfill.
    readFile(root,paths.tradePath,db=>{rows(db,'engine_trade_evidence');rows(db,'engine_trade_evidence_audit');});
    if(marketEnabled)check(paths.marketPath);
    const trades=readNativeTradeLedger(paths.tradePath),market=marketEnabled?readFile(root,paths.marketPath!,readExternalValueMarket):disabledExternalMarket(),treasury=readFile(root,paths.treasuryPath,readExternalValueTreasury),
        cursor:ExternalValueCursor={registryDigest:externalValueRegistryDigest,shopMode,trades:{sequence:trades.length,hash:trades.at(-1)?.headHash??ZERO},
            tradeStateDigest:digest(trades),market:market.head,marketStateDigest:market.stateDigest,marketOfferCount:market.offers.length,
            marketEnabled,marketSourceDigest:marketEnabled?externalMarketSourceDigest(root,paths.marketPath!):digest('native-grand-exchange-disabled'),treasury:treasury.head,treasuryStateDigest:treasury.stateDigest,
            tradeSourceDigest:externalMarketSourceDigest(root,paths.tradePath),treasurySourceDigest:externalMarketSourceDigest(root,paths.treasuryPath)};
    return{trades,market,treasury,cursor};
}
export function readNativeExternalValueCursor(root:string,shopMode:ExternalValueCursor['shopMode'],marketEnabled:boolean):ExternalValueCursor|null{
    if(resolve(root).toLowerCase()!==resolve(fileURLToPath(new URL('../',import.meta.url))).toLowerCase()
        ||resolve(process.cwd()).toLowerCase()!==resolve(root,'server/engine').toLowerCase())return null;
    return readExternalValueSnapshot(root,{tradePath:resolve(root,'server/engine',process.env.TRADE_EVIDENCE_DB??'data/mods/trade-evidence.sqlite'),
        marketPath:resolve(root,'server/engine',process.env.GE_DATABASE??'data/market.sqlite'),treasuryPath:join(root,'.local/economy/institution-treasury.sqlite')},shopMode,marketEnabled).cursor;
}
export function validateExternalValueCursor(c:ExternalValueCursor){const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
    check(c&&hex(c.registryDigest)&&['legacy','closed-society'].includes(c.shopMode)&&[c.tradeStateDigest,c.marketStateDigest,c.treasuryStateDigest].every(hex)
        &&typeof c.marketEnabled==='boolean'&&[c.marketSourceDigest,c.tradeSourceDigest,c.treasurySourceDigest].every(hex)&&Number.isSafeInteger(c.marketOfferCount)&&c.marketOfferCount>=0&&[c.trades,c.market,c.treasury].every(h=>Number.isSafeInteger(h?.sequence)&&h.sequence>=0&&hex(h.hash)));
}
