import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { captureNativeFinanceBoundary } from '../society-metrics/finance-sources.js';
import { nativeFinanceOptions } from '../society-metrics/finance-options.js';
const{values}=parseArgs({options:{boundary:{type:'string'},'opening-dir':{type:'string'},'closing-dir':{type:'string'},
    from:{type:'string'},to:{type:'string'},actor:{type:'string',multiple:true},'clock-id':{type:'string'},'clock-profile-digest':{type:'string'}}});
if(!['opening','closing'].includes(values.boundary??'')||!values['opening-dir']||!values['closing-dir'])
    throw new Error('Supply --boundary=opening|closing and both backend frozen boundary directories');
const options=nativeFinanceOptions(resolve(import.meta.dir,'..'),values['opening-dir'],values['closing-dir']);
console.log(JSON.stringify(captureNativeFinanceBoundary({fromSimulationTime:values.from??'',toSimulationTime:values.to??'',
    actorAgentIds:values.actor??[],clockId:values['clock-id']??'',clockProfileDigest:values['clock-profile-digest']??''},options,values.boundary as 'opening'|'closing'),null,2));
