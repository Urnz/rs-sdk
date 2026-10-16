import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {XpExecutionStore} from '../server/engine/src/mods/XpExecutionStore.js';
export const nativeXpExecutionJournalPath=fileURLToPath(new URL('../.local/admin/xp-execution.sqlite',import.meta.url));
export function readXpExecutionSource(id:string,path=nativeXpExecutionJournalPath){
    if(!existsSync(path))return null;const source=new XpExecutionStore(path,true);try{return source.get(id);}finally{source.close();}
}
export function readXpExecutionSources(ids:string[],path=nativeXpExecutionJournalPath){
    if(!existsSync(path))return new Map(ids.map(id=>[id,null]));
    const source=new XpExecutionStore(path,true);try{return new Map(ids.map(id=>[id,source.get(id)]));}finally{source.close();}
}
