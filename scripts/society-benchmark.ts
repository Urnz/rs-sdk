import { readFileSync,writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { captureSocietyArchive, verifySocietyArchive, restoreSocietyArchive } from '../society-experiments/archive.js';
import { readBenchmarkReport, validateBenchmarkBaseline } from '../society-experiments/benchmark-report.js';
import { validateLongExperimentPlan } from '../society-experiments/plan.js';
import { check } from '../external-trade/source.js';
import { digest } from '../external-trade/policy.js';
import { transitionBenchmarkClock } from '../society-experiments/benchmark-clock.js';
import { prepareExpandedBaseline,captureExpandedArchive,validateExpandedManifest,validateExpandedRestore,expandedArchiveSelection,compareExpandedArchives,type ExpandedBaselinePin } from '../society-experiments/expanded-baseline.js';

const { values } = parseArgs({ options: { command: { type: 'string', default: 'verify' },
    root: { type: 'string' }, plan: { type: 'string' }, bundle: { type: 'string' }, output: { type: 'string' },
    kind: { type: 'string', default: 'baseline' }, offline: { type: 'boolean', default: false },
    selection:{type:'string'},'expanded-pin':{type:'string'},baseline:{type:'string'},result:{type:'string'} } });
const root = resolve(values.root ?? join(import.meta.dir, '..'));
function assertOffline() {
    check(values.offline, 'This operation requires --offline and all writers stopped');
    check(process.platform === 'win32', 'Offline process probe currently supports Windows only');
    const result = Bun.spawnSync(['pwsh', '-NoProfile', '-File', join(import.meta.dir, 'assert-society-offline.ps1'),
        '-Root', root, '-CallerPid', String(process.pid)], { stdout: 'pipe', stderr: 'pipe' });
    check(result.exitCode === 0, `Offline probe failed: ${result.stderr.toString()}`);
}
if(values.command==='prepare-expanded'){
    check(values.selection&&values.plan&&values.output,'Prepare requires --selection --plan --output');assertOffline();
    const plan=validateLongExperimentPlan(JSON.parse(readFileSync(values.plan,'utf8')));validateBenchmarkBaseline(root,plan);
    const pin=prepareExpandedBaseline(root,JSON.parse(readFileSync(values.selection,'utf8')));check(pin.selection.runId===plan.sessionId,'Pin run differs');
    writeFileSync(values.output,JSON.stringify(pin,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({pinDigest:pin.digest,output:resolve(values.output)}));
} else if (values.command === 'capture') {
    check(values.offline && values.plan && values.output, 'Capture requires --offline --plan --output; stop all writers first');
    check(values.kind === 'baseline' || values.kind === 'result', 'Kind must be baseline or result');
    const kind:'baseline'|'result'=values.kind;
    const plan = validateLongExperimentPlan(JSON.parse(readFileSync(values.plan, 'utf8')));
    const validateBaseline = () => { validateBenchmarkBaseline(root, plan); };
    const pin:ExpandedBaselinePin|undefined=values['expanded-pin']?JSON.parse(readFileSync(values['expanded-pin'],'utf8')):undefined;
    const captureOptions={ root, output: values.output, plan, kind, assertOffline, validateBaseline,
        readReport: (selected:string) => readBenchmarkReport(selected, plan,pin?.selection) };
    const manifest = pin?captureExpandedArchive({...captureOptions,pin,baselineBundle:values.baseline}):captureSocietyArchive(captureOptions);
    console.log(JSON.stringify({ bundle: resolve(values.output), digest: manifest.digest, files: manifest.files.length,
        sourceTreeDigest: manifest.sourceTreeDigest, kind: manifest.kind }, null, 2));
} else if (values.command === 'pause' || values.command === 'resume') {
    assertOffline(); console.log(JSON.stringify(transitionBenchmarkClock(root, values.command), null, 2));
} else if (values.command === 'verify') {
    check(values.bundle, 'Verify requires --bundle'); const basic=verifySocietyArchive(values.bundle);
    const manifest=basic.baselineEvidence?validateExpandedManifest(basic):basic;
    console.log(JSON.stringify({ verified: true, digest: manifest.digest, kind: manifest.kind, sessionId: manifest.plan.sessionId,
        nativeEvidenceVerified: false, next: 'Restore into a new directory and run report for native evidence verification.' }, null, 2));
} else if (values.command === 'restore') {
    check(values.bundle && values.output, 'Restore requires --bundle --output');
    const manifest = restoreSocietyArchive(values.bundle, values.output,(staging,m)=>{
        if(m.baselineEvidence)validateExpandedRestore(staging,m,selected=>readBenchmarkReport(selected,m.plan,expandedArchiveSelection(m)));
        else if(m.kind==='result')check(digest(readBenchmarkReport(staging,m.plan))===digest(m.report),'Restored native report differs');
    });
    console.log(JSON.stringify({ restored: join(resolve(values.output), 'workspace'), digest: manifest.digest,
        nativeEvidenceVerified: manifest.kind === 'result',expandedBaselineVerified:!!manifest.baselineEvidence }, null, 2));
} else if(values.command==='compare-expanded'){
    check(values.baseline&&values.result,'Compare requires --baseline --result');console.log(JSON.stringify(compareExpandedArchives(values.baseline,values.result),null,2));
} else if (values.command === 'report') {
    check(values.plan, 'Report requires --root <restored workspace> --plan');
    const pin:ExpandedBaselinePin|undefined=values['expanded-pin']?JSON.parse(readFileSync(values['expanded-pin'],'utf8')):undefined;
    console.log(JSON.stringify(readBenchmarkReport(root, JSON.parse(readFileSync(values.plan, 'utf8')),pin?.selection), null, 2));
} else throw new Error('Commands: capture, verify, restore, report, pause, resume. Run support: bun run society:experiment.');
