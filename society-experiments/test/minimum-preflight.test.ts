import { expect,test } from 'bun:test';
import { join,resolve } from 'node:path';
import { loadIntegrationFixture } from '../../society-integration/fixture.js';
import { inspectMinimumRunPreparation } from '../minimum-preflight.js';
import { cpSync,mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
const root=resolve(import.meta.dir,'../..');
test('C07 preparation retains all17 minimum rules and fails closed on known unmeasured gates without starting a world',async()=>{
    const fixture=loadIntegrationFixture(join(root,'config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json'));
    const report=await inspectMinimumRunPreparation(root,fixture);
    expect(report.readerCoverage).toHaveLength(17);expect(report.requiredIntegrityGates).toHaveLength(8);
    expect(report.minimumSourceMap.requirements).toHaveLength(17);expect(report.minimumSourceMap.integrity).toHaveLength(8);
    expect(report.readerCoverage.filter(r=>r.status==='minimum-lower-bound-adapter')).toHaveLength(4);
    expect(report.readerCoverage.filter(r=>r.status==='minimum-population-bound-adapter')).toHaveLength(3);
    expect(report.readerCoverage.filter(r=>r.status==='minimum-needs-exposure-adapter')).toHaveLength(4);
    expect(report.readerCoverage.filter(r=>r.status==='minimum-food-bound-adapter')).toHaveLength(4);
    expect(report.readerCoverage.filter(r=>r.status==='minimum-housing-exposure-adapter')).toHaveLength(1);
    expect(report.readerCoverage.filter(r=>r.status==='minimum-tool-capacity-bound-adapter')).toHaveLength(1);
    expect(report.readerCoverage.filter(r=>r.status==='source-map-only')).toHaveLength(0);
    expect(report.candidate).toMatchObject({warmupSimulationMs:86400000,evaluationSimulationMs:604800000,nominalWallMs:2400000,
        proposedSampleWallMs:5000,providerRequestsAuthorized:0,providerCostMicrosAuthorized:0,selectedWorldId:null});
    expect(report.liveRunStarted).toBeFalse();expect(report.readyForRunApproval).toBeFalse();
    expect(report.gates.find(g=>g.id==='minimum-assessor')?.status).toBe('blocked');
    expect(report.gates.find(g=>g.id==='tool-chain-baseline')?.status).toBe('blocked');
    expect(report.supplyEnvelope.optimisticNoBurnHeadroom).toBe(0);
    expect(report.readerCoverage.every(r=>r.verdict==='inconclusive'&&r.assessedValue===null)).toBeTrue();
});
test('a relaxed minimum in a copied definition cannot pass the original-policy gate',async()=>{
    const fixture=loadIntegrationFixture(join(root,'config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json'));
    const original=await inspectMinimumRunPreparation(root,fixture),copy=mkdtempSync(join(tmpdir(),'si-c07-minimum-drift-'));
    try{
        cpSync(join(root,'config'),join(copy,'config'),{recursive:true});cpSync(join(root,'agent-skills/catalog'),join(copy,'agent-skills/catalog'),{recursive:true});
        for(const source of original.sources.filter(s=>!s.path.startsWith('config/')&&!s.path.startsWith('agent-skills/catalog/'))){
            mkdirSync(dirname(join(copy,source.path)),{recursive:true});writeFileSync(join(copy,source.path),readFileSync(join(root,source.path)));}
        const path=join(copy,'config/society-minimum-policy.json'),policy=JSON.parse(readFileSync(path,'utf8'));
        policy.needs.minimumSatisfiedPersonTimeBasisPoints=9400;writeFileSync(path,JSON.stringify(policy));
        const report=await inspectMinimumRunPreparation(copy,fixture);expect(report.gates.find(g=>g.id==='unchanged-minimum')?.status).toBe('blocked');
        expect(report.readyForRunApproval).toBeFalse();
    }finally{rmSync(copy,{recursive:true,force:true});}
});
test('preparation CLI emits a machine-readable NO-GO and a nonzero gate exit without executing a run',async()=>{
    const child=Bun.spawn({cmd:[process.execPath,join(root,'scripts/prepare-society-minimum-run.ts')],stdout:'pipe',stderr:'pipe'});
    const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect(exit,err).toBe(2);const report=JSON.parse(out);expect(report.status).toBe('no-go');expect(report.liveStartAuthorized).toBeFalse();
    expect(report.gates.some((g:{status:string})=>g.status==='blocked')).toBeTrue();
});
