#!/usr/bin/env bun

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildPhase22EvidenceBundle, loadPhase22AcceptanceFixture,
    verifyPhase22EvidenceBundle } from './lib/phase22-acceptance.js';

const [bundleId,liveBundleInput]=process.argv.slice(2),root=resolve(import.meta.dir,'..');
if(!bundleId||!liveBundleInput||process.argv.length!==4)throw new Error(
    'Usage: bun scripts/run-phase22-acceptance.ts <bundle-id> <phase22-live-bundle-directory>');
const liveBundlePath=resolve(root,liveBundleInput),liveRoot=resolve(root,'.local','phase22-live');
if(!liveBundlePath.startsWith(`${liveRoot}\\`))throw new Error('Live bundle must be under .local/phase22-live');
const fixturePath=join(root,'config','fixtures','phase22-acceptance-v1.json'),fixture=loadPhase22AcceptanceFixture(fixturePath),
    output=join(root,'.local','phase22-acceptance',bundleId);mkdirSync(output,{recursive:true});
const tests=[...new Set(fixture.packages.flatMap(value=>value.tests))],command=[process.execPath,'test',...tests],
    child=Bun.spawn(command,{cwd:root,env:process.env,stdout:'pipe',stderr:'pipe'}),[stdout,stderr,exitCode]=await Promise.all([
        new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
const focusedLogPath=join(output,'focused-verification.log');await Bun.write(focusedLogPath,
    `${stdout}${stderr}\ncommand: bun test ${tests.join(' ')}\nexit-code: ${exitCode}\n`);
if(exitCode!==0)throw new Error(`Phase 22 focused acceptance failed; see ${focusedLogPath}`);
const bundle=await buildPhase22EvidenceBundle({bundleId,fixturePath,liveBundlePath,
    focusedCommand:`bun test ${tests.join(' ')}`,focusedExitCode:exitCode,focusedLogPath});
if(!verifyPhase22EvidenceBundle(bundle))throw new Error('Generated Phase 22 evidence bundle failed self-verification');
const bundlePath=join(output,'evidence-bundle.json');await Bun.write(bundlePath,`${JSON.stringify(bundle,null,2)}\n`);
const replay=JSON.parse(await Bun.file(bundlePath).text());if(!verifyPhase22EvidenceBundle(replay))
    throw new Error('Persisted Phase 22 evidence bundle failed replay verification');
console.log(JSON.stringify({passed:true,bundleId,bundlePath,packages:bundle.packageCoverage.map(value=>value.id),
    focusedTests:tests.length,liveSourceBundle:bundle.live.sourceBundleId,bundleDigest:bundle.bundleDigest}));
