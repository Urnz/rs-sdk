import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {readFounderHousingResult} from '../society-experiments/founder-housing-result.js';
import {checkHousing} from '../society-experiments/founder-housing.js';
const {values}=parseArgs({strict:true,options:{root:{type:'string'},output:{type:'string'}}});
checkHousing(values.root,'--root is required');const root=resolve(values.root),result=readFounderHousingResult(root),again=readFounderHousingResult(root);
checkHousing(JSON.stringify(result)===JSON.stringify(again),'Independent readonly housing reread differs');
const text=JSON.stringify(result,null,2)+'\n';
if(values.output){const path=resolve(values.output);
    if(existsSync(path))checkHousing(readFileSync(path,'utf8').replace(/\r\n/g,'\n')===text,'Existing housing result cannot be relabelled');
    else writeFileSync(path,text,{flag:'wx'});
}
console.log(JSON.stringify({status:result.status,worldId:result.worldId,actors:result.actors.length,digest:result.digest,elapsedMs:result.elapsedMs,
    readonlyUnchanged:result.readonlyUnchanged,qualifiesMinimum:false,providerCalls:0},null,2));
