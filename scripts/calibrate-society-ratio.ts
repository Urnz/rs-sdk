import {parseArgs} from 'node:util';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {readNativeRatioCalibration} from '../society-experiments/ratio-calibration.js';
const {values}=parseArgs({strict:true,options:{output:{type:'string'}}}),started=Date.now(),result=readNativeRatioCalibration(resolve(import.meta.dir,'..')),
    again=readNativeRatioCalibration(resolve(import.meta.dir,'..'));
if(JSON.stringify(result)!==JSON.stringify(again))throw Error('Independent readonly ratio calibration differs');
const text=JSON.stringify(result,null,2)+'\n';
if(Date.now()-started>10000)throw Error('Ratio calibration exceeded its10s diagnostic IO budget');
if(values.output){const path=resolve(values.output);if(existsSync(path)&&readFileSync(path,'utf8').replace(/\r\n/g,'\n')!==text)throw Error('Existing ratio result cannot be relabelled');
    if(!existsSync(path))writeFileSync(path,text,{flag:'wx'});}
console.log(JSON.stringify({status:result.status,dayWallMs:result.dayWallMs,miningSamples:result.observations.mining.length,
    workSamples:result.observations.work.length,projection:result.projection,remainingEvidence:result.remainingEvidence,digest:result.digest,
    readyForRunApproval:false,readonlyUnchanged:true,providerCalls:0}));
