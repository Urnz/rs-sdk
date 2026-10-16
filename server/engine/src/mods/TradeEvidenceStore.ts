import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { bindNativeEngineTradeClock } from '../../../../external-trade/engine-clock.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER=/^[a-z0-9]{1,12}$/,DIGEST=/^[0-9a-f]{64}$/,ZERO='0'.repeat(64);
export interface EngineTradeEvidenceItem { id:number|undefined;name:string|null;count:number }
export interface EngineTradeEvidence {
    eventId:string;tick:number;fromUsername:string;toUsername:string;
    fromItems:EngineTradeEvidenceItem[];toItems:EngineTradeEvidenceItem[];fromValue:number;toValue:number;
    committedAt:string;eventDigest:string;
}
type Row={event_id:string;tick:number;from_username:string;to_username:string;from_items_json:string;
    to_items_json:string;from_value:number;to_value:number;committed_at:string;event_digest:string};
type Audit={sequence:number;event_id:string;event_digest:string;committed_at:string;previous_hash:string;entry_hash:string};
function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function facts(value:EngineTradeEvidence){const{eventDigest:_digest,...rest}=value;void _digest;return rest}
function event(row:Row):EngineTradeEvidence{return{eventId:row.event_id,tick:row.tick,fromUsername:row.from_username,
    toUsername:row.to_username,fromItems:JSON.parse(row.from_items_json),toItems:JSON.parse(row.to_items_json),
    fromValue:row.from_value,toValue:row.to_value,committedAt:row.committed_at,eventDigest:row.event_digest}}
function validItems(value:unknown):value is EngineTradeEvidenceItem[]{return Array.isArray(value)&&value.length<=28&&value.every(item=>
    item&&typeof item==='object'&&Object.keys(item).sort().join(',')==='count,id,name'
    &&(item.id===undefined||(Number.isSafeInteger(item.id)&&item.id>=0&&item.id<=65535))
    &&(item.name===null||typeof item.name==='string')&&Number.isSafeInteger(item.count)&&item.count>0)}

/** Committed engine exchange evidence. It proves a trade, never an underworld role by itself. */
export class TradeEvidenceStore{
    private readonly database:Database;
    constructor(path:string,private readonly bindClock?: (event:EngineTradeEvidence)=>void){mkdirSync(dirname(path),{recursive:true});this.database=new Database(path,{create:true,strict:true});this.migrate()}
    close(){this.database.close(true)}
    record(input:Omit<EngineTradeEvidence,'eventId'|'eventDigest'>,eventId:string=randomUUID()):EngineTradeEvidence{
        const committedAt=new Date(input.committedAt).toISOString();
        if(!UUID.test(eventId)||!Number.isSafeInteger(input.tick)||input.tick<0||!USER.test(input.fromUsername)
            ||!USER.test(input.toUsername)||input.fromUsername===input.toUsername||!validItems(input.fromItems)
            ||!validItems(input.toItems)||(!input.fromItems.length&&!input.toItems.length)
            ||!Number.isSafeInteger(input.fromValue)||input.fromValue<0||!Number.isSafeInteger(input.toValue)||input.toValue<0)
            throw new Error('Engine trade evidence is invalid');
        if(!this.verifyAuditChain())throw new Error('Engine trade evidence audit chain is invalid');
        const value={eventId,tick:input.tick,fromUsername:input.fromUsername,toUsername:input.toUsername,
            fromItems:structuredClone(input.fromItems),toItems:structuredClone(input.toItems),fromValue:input.fromValue,
            toValue:input.toValue,committedAt},eventDigest=hash(value),existing=this.get(eventId);
        if(existing){if(existing.eventDigest!==eventDigest)throw new Error('Engine trade evidence id was reused');return existing}
        this.database.transaction(()=>{
            // Bind before publishing the native row so observers cannot race a late stamp.
            // A missing clock preserves the exchange, explicitly untimed; replay never backfills it.
            try{this.bindClock?.({...value,eventDigest})}catch(error){console.warn('[trade-evidence] SimulationClock binding unavailable',error)}
            this.database.run(`INSERT INTO engine_trade_evidence VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
            [eventId,value.tick,value.fromUsername,value.toUsername,JSON.stringify(value.fromItems),JSON.stringify(value.toItems),
                value.fromValue,value.toValue,value.committedAt,eventDigest]);const previous=(this.database.query(
                    'SELECT entry_hash FROM engine_trade_evidence_audit ORDER BY sequence DESC LIMIT 1').get() as{entry_hash:string}|null)?.entry_hash??ZERO;
            const payload={eventId,eventDigest,committedAt:value.committedAt};this.database.run(`INSERT INTO engine_trade_evidence_audit
                (event_id,event_digest,committed_at,previous_hash,entry_hash)VALUES(?1,?2,?3,?4,?5)`,
            [eventId,eventDigest,value.committedAt,previous,hash({previousHash:previous,payload})])}).immediate();
        return this.get(eventId)!}
    get(eventId:string):EngineTradeEvidence|null{if(!UUID.test(eventId))throw new Error('Engine trade evidence id is invalid');
        if(!this.verifyAuditChain())throw new Error('Engine trade evidence audit chain is invalid');const row=this.database.query(
            'SELECT * FROM engine_trade_evidence WHERE event_id=?1').get(eventId) as Row|null;return row?event(row):null}
    verifyAuditChain():boolean{try{const rows=this.database.query('SELECT * FROM engine_trade_evidence').all() as Row[];
        const audits=this.database.query('SELECT * FROM engine_trade_evidence_audit ORDER BY sequence').all() as Audit[];
        if(rows.length!==audits.length)return false;const byId=new Map(rows.map(row=>[row.event_id,row]));let previous=ZERO;
        for(const audit of audits){const row=byId.get(audit.event_id);if(!row)return false;const value=event(row);
            if(!DIGEST.test(value.eventDigest)||value.eventDigest!==hash(facts(value))||audit.event_digest!==value.eventDigest
                ||audit.committed_at!==value.committedAt||audit.previous_hash!==previous)return false;
            const payload={eventId:value.eventId,eventDigest:value.eventDigest,committedAt:value.committedAt};
            if(audit.entry_hash!==hash({previousHash:previous,payload}))return false;previous=audit.entry_hash}return true}catch{return false}}
    private migrate(){const version=(this.database.query('PRAGMA user_version').get() as{user_version:number}).user_version;
        if(version>1)throw new Error(`Engine trade evidence schema ${version} is newer than supported version 1`);if(version===1)return;
        this.database.transaction(()=>{this.database.run(`CREATE TABLE engine_trade_evidence(event_id TEXT PRIMARY KEY,tick INTEGER NOT NULL,
            from_username TEXT NOT NULL,to_username TEXT NOT NULL,from_items_json TEXT NOT NULL,to_items_json TEXT NOT NULL,
            from_value INTEGER NOT NULL,to_value INTEGER NOT NULL,committed_at TEXT NOT NULL,event_digest TEXT NOT NULL UNIQUE)`);
            this.database.run(`CREATE TABLE engine_trade_evidence_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE REFERENCES engine_trade_evidence(event_id),event_digest TEXT NOT NULL,
                committed_at TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version=1')}).immediate()}
}
let store:TradeEvidenceStore|null=null;
export function getTradeEvidenceStore(){return store??=new TradeEvidenceStore(process.env.TRADE_EVIDENCE_DB||'data/mods/trade-evidence.sqlite',bindNativeEngineTradeClock)}
