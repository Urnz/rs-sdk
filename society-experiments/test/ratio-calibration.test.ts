import {expect,test} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {measureRatioInterval,projectWarmup,readRatioCalibrationSummary} from '../ratio-calibration.js';
import {societyMinimumDigest as digest} from '../../society-minimum/policy.js';
import type {SimulationClockObservation} from '../../simulation-clock/types.js';
const rate={simulationMilliseconds:288,wallMilliseconds:1};
const start:SimulationClockObservation={clockId:'world',profileDigest:'a'.repeat(64),status:'running',revision:2,engineTick:36,
    wallTime:'2026-10-31T00:20:38.421Z',simulationTime:'2001-01-01T01:19:59.808Z'};
const end:SimulationClockObservation={...start,engineTick:66,wallTime:'2026-10-31T00:20:50.644Z',simulationTime:'2001-01-01T02:18:40.032Z'};
test('native interval distinguishes wall, simulation and content ticks and rejects incompatible observations',()=>{
    expect(measureRatioInterval(start,end,rate)).toMatchObject({wallMs:12223,simulationMs:3520224,engineTicks:30});
    for(const patch of [{clockId:'other'},{profileDigest:'b'.repeat(64)},{revision:3},{status:'paused' as const},
        {engineTick:null},{engineTick:35},{wallTime:start.wallTime},{simulationTime:start.simulationTime},
        {wallTime:'2026-10-31T00:20:50Z'}])expect(()=>measureRatioInterval(start,{...end,...patch},rate)).toThrow();
    expect(()=>measureRatioInterval(start,end,{simulationMilliseconds:24,wallMilliseconds:1})).toThrow('observed clock rate differs');
});
test('two Mining samples warn about a five-minute day without pretending to measure51 warmup uses',()=>{
    const p=projectWarmup([12223,10271],51,300000);
    expect(p.projectedSerialMs).toBe(573597);expect(p.exceedsDayAtSampleMean).toBeTrue();
    expect(p.measuredWarmupUses).toBe(0);expect(p.verdict).toBe('unmeasured');
    expect(projectWarmup([1],51,300000).verdict).toBe('unmeasured');
    expect(()=>projectWarmup([],51,300000)).toThrow();
});
test('preflight summary stays closed on missing/stale/unsafe or corrupt calibration and reads no trial database',()=>{
    const root=mkdtempSync(join(tmpdir(),'si-ratio-summary-'));
    try{
        expect(readRatioCalibrationSummary(root)).toEqual({status:'missing',readyForRunApproval:false});
        mkdirSync(join(root,'docs/project'),{recursive:true});writeFileSync(join(root,'producer.ts'),'original\n');
        const hash=createHash('sha256').update('original\n').digest('hex'),body={protocol:'si-c07-native-ratio-calibration-v1',status:'incomplete',
            readyForRunApproval:false,qualifiesMinimum:false,dayWallMs:300000,rate,collectorPins:[],source:{pins:{housing:[{path:'producer.ts',currentLfSha256:hash}],tool:[]}},
            observations:{mining:[{},{}],work:[{},{},{},{}]},projection:{projectedSerialMs:573597},remainingEvidence:['actual51','food','schedule']};
        const save=(value:unknown)=>writeFileSync(join(root,'docs/project/SI_C07_RATIO_CALIBRATION_RESULT.json'),JSON.stringify({...value as object,digest:digest(value)}));
        save(body);expect(readRatioCalibrationSummary(root)).toMatchObject({status:'incomplete',readyForRunApproval:false,nativeMiningSamples:2});
        expect(readRatioCalibrationSummary(root,{simulationMilliseconds:24,wallMilliseconds:1}).status).toBe('profile-mismatch');
        writeFileSync(join(root,'producer.ts'),'changed\n');expect(readRatioCalibrationSummary(root).status).toBe('stale');
        for(const path of ['../secret','/absolute','C:/outside','\\\\server\\outside']){
            save({...body,source:{pins:{housing:[{path,currentLfSha256:hash}],tool:[]}}});expect(()=>readRatioCalibrationSummary(root)).toThrow('unsafe source path');
        }
        save(body);const file=join(root,'docs/project/SI_C07_RATIO_CALIBRATION_RESULT.json');
        writeFileSync(file,JSON.stringify({...body,digest:'0'.repeat(64)}));expect(()=>readRatioCalibrationSummary(root)).toThrow('invalid summary');
    }finally{rmSync(root,{recursive:true,force:true});}
});
