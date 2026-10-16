import{createHash}from'node:crypto';import{Database}from'bun:sqlite';
import type{AgentStateStore}from'../agent-state/store.js';import type{FencingTradeReceipt,FencingTradeVerifier}from'./types.js';
const ZERO='0'.repeat(64),UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface CommittedEngineTrade{eventId:string;tick:number;fromUsername:string;toUsername:string;
    fromItems:Array<{id:number|undefined;name:string|null;count:number}>;toItems:Array<{id:number|undefined;name:string|null;count:number}>;
    fromValue:number;toValue:number;committedAt:string;eventDigest:string}
type Row={event_id:string;tick:number;from_username:string;to_username:string;from_items_json:string;to_items_json:string;
    from_value:number;to_value:number;committed_at:string;event_digest:string};type Audit={sequence:number;event_id:string;
    event_digest:string;committed_at:string;previous_hash:string;entry_hash:string};
function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function event(row:Row):CommittedEngineTrade{return{eventId:row.event_id,tick:row.tick,fromUsername:row.from_username,
    toUsername:row.to_username,fromItems:JSON.parse(row.from_items_json),toItems:JSON.parse(row.to_items_json),
    fromValue:row.from_value,toValue:row.to_value,committedAt:row.committed_at,eventDigest:row.event_digest}}
function facts(value:CommittedEngineTrade){const{eventDigest:_digest,...rest}=value;void _digest;return rest}
/** Read-only gateway/domain view over the engine-owned committed trade ledger. */
export class EngineTradeEvidenceSource{
    private readonly database:Database;constructor(path:string){this.database=new Database(path,{readonly:true,strict:true})}
    close(){this.database.close(true)}
    get(eventId:string):CommittedEngineTrade|null{if(!UUID.test(eventId))return null;if(!this.verifyAuditChain())
        throw new Error('Engine trade evidence audit chain is invalid');const row=this.database.query(
            'SELECT * FROM engine_trade_evidence WHERE event_id=?1').get(eventId)as Row|null;return row?event(row):null}
    list():CommittedEngineTrade[]{if(!this.verifyAuditChain())throw new Error('Engine trade evidence audit chain is invalid');
        return(this.database.query('SELECT * FROM engine_trade_evidence ORDER BY rowid').all()as Row[]).map(event)}
    verifyAuditChain():boolean{try{const rows=this.database.query('SELECT * FROM engine_trade_evidence').all()as Row[];
        const audits=this.database.query('SELECT * FROM engine_trade_evidence_audit ORDER BY sequence').all()as Audit[];
        if(rows.length!==audits.length)return false;const byId=new Map(rows.map(row=>[row.event_id,row]));let previous=ZERO;
        for(const audit of audits){const row=byId.get(audit.event_id);if(!row)return false;const value=event(row);
            if(value.eventDigest!==hash(facts(value))||audit.event_digest!==value.eventDigest||audit.committed_at!==value.committedAt
                ||audit.previous_hash!==previous)return false;const payload={eventId:value.eventId,eventDigest:value.eventDigest,
                    committedAt:value.committedAt};if(audit.entry_hash!==hash({previousHash:previous,payload}))return false;
            previous=audit.entry_hash}return true}catch{return false}}
    createFencingTradeVerifier(agents:Pick<AgentStateStore,'getIdentity'>):FencingTradeVerifier{return receipt=>{
        const evidence=this.get(receipt.receiptId),buyer=agents.getIdentity(receipt.buyerAgentId),seller=agents.getIdentity(receipt.sellerAgentId);
        if(!evidence||!buyer?.playerUsername||!seller?.playerUsername||receipt.sourceEvidenceDigest!==evidence.eventDigest
            ||receipt.occurredAt!==evidence.committedAt)return false;const buyerName=buyer.playerUsername.toLowerCase(),sellerName=seller.playerUsername.toLowerCase();
        let sellerOut,buyerOut;if(evidence.fromUsername===sellerName&&evidence.toUsername===buyerName){sellerOut=evidence.fromItems;buyerOut=evidence.toItems}
        else if(evidence.toUsername===sellerName&&evidence.fromUsername===buyerName){sellerOut=evidence.toItems;buyerOut=evidence.fromItems}else return false;
        return sellerOut.every(item=>item.id===receipt.itemId)&&sellerOut.reduce((sum,item)=>sum+item.count,0)===receipt.quantity
            &&buyerOut.every(item=>item.id===995)&&buyerOut.reduce((sum,item)=>sum+item.count,0)===receipt.coinsPaid}}
}
