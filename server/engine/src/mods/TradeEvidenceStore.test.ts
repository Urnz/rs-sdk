import{afterEach,describe,expect,test}from'bun:test';import{mkdtempSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';import{join}from'node:path';import{Database}from'bun:sqlite';
import{TradeEvidenceStore}from'./TradeEvidenceStore.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})});
function setup(){const root=mkdtempSync(join(tmpdir(),'trade-evidence-'));roots.push(root);const path=join(root,'db.sqlite');
    return{path,store:new TradeEvidenceStore(path)}}
const id='10000000-0000-4000-8000-000000000001',input={tick:42,fromUsername:'seller',toUsername:'buyer',
    fromItems:[{id:1265,name:'bronze_pickaxe',count:1}],toItems:[{id:995,name:'coins',count:40}],fromValue:1,toValue:40,
    committedAt:'2026-09-28T16:00:00.000Z'};
describe('committed engine trade evidence',()=>{
 test('records both sides atomically and exact replay is idempotent',()=>{const{store}=setup();const first=store.record(input,id);
    expect(first).toMatchObject({fromUsername:'seller',toUsername:'buyer',eventDigest:expect.stringMatching(/^[0-9a-f]{64}$/)});
    expect(store.record(input,id)).toEqual(first);expect(()=>store.record({...input,toValue:41},id)).toThrow('reused');
    expect(store.verifyAuditChain()).toBeTrue();store.close()});
 test('survives restart and corrupted evidence fails closed',()=>{const{path,store}=setup();store.record(input,id);store.close();
    const reopened=new TradeEvidenceStore(path);expect(reopened.get(id)?.tick).toBe(42);reopened.close();
    const raw=new Database(path);raw.run('UPDATE engine_trade_evidence SET to_value=41');raw.close(true);
    const corrupt=new TradeEvidenceStore(path);expect(corrupt.verifyAuditChain()).toBeFalse();expect(()=>corrupt.get(id)).toThrow('audit chain');corrupt.close()});
});
