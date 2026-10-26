import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { check, readDatabase } from '../external-trade/source.js';
import { digest } from '../external-trade/policy.js';
import { reportSocietyEvaluation } from '../society-metrics/evaluation-report.js';
import { validateLongExperimentPlan, type LongExperimentPlan } from './plan.js';
import { defaultLongExperimentSources, nativeLongExperimentDependencies, readLongExperimentReport } from './runtime.js';
import { readLongExperimentBinding } from './source.js';
import type { ExpandedSelection } from './expanded-baseline.js';
import type { NativeOutcomeOptions } from '../society-metrics/native-outcomes.js';

export function validateBenchmarkBaseline(root: string, raw: LongExperimentPlan) {
    const plan = validateLongExperimentPlan(raw), paths = defaultLongExperimentSources(root);
    const binding = readLongExperimentBinding(plan, paths);
    readDatabase(paths.clockPath, db => check((db.query('SELECT status FROM simulation_clock WHERE clock_id=?1')
        .get(binding.genesis.simulationClock.clockId) as { status?: string } | null)?.status === 'paused', 'Pause the native simulation clock before baseline capture'));
    check(binding.conditionDigest === plan.expectedConditionDigest, 'Prepare and pin the baseline plan first');
    const journal = join(root, '.local/admin/long-experiments.sqlite');
    if (existsSync(journal)) readDatabase(journal, db => {
        check(!db.query('SELECT 1 FROM long_experiment_lock LIMIT 1').get(), 'A long program still owns the clock');
        check(!db.query('SELECT 1 FROM long_experiment_run WHERE id=?1').get(plan.sessionId), 'Baseline session id was already used');
    });
    const phase12 = join(root, '.local/admin/multi-agent-experiments.sqlite');
    if (existsSync(phase12)) readDatabase(phase12, db => check(!db.query("SELECT 1 FROM multi_agent_experiment WHERE status='running' LIMIT 1").get(), 'An unresolved Phase12 wave exists'));
    return binding;
}

/** Every source, including XP attestation, belongs to the selected isolated workspace. No HTTP, migrations or clock observation. */
export function readBenchmarkReport(baseRoot: string, raw: LongExperimentPlan, expanded?: ExpandedSelection) {
    const root = resolve(baseRoot), plan = validateLongExperimentPlan(raw), paths = defaultLongExperimentSources(root);
    const noNetwork = async (): Promise<never> => { throw new Error('Archived report cannot access the live gateway'); };
    const deps = nativeLongExperimentDependencies(paths, noNetwork, join(root, '.local/admin/multi-agent-experiments.sqlite'), join(root, '.local/admin/xp-execution.sqlite'));
    const execution = readLongExperimentReport(plan.sessionId, join(root, '.local/admin/long-experiments.sqlite'), deps);
    check('definition' in execution && digest(execution.definition.plan) === digest(plan), 'Exact native benchmark plan unavailable');
    check(execution.status !== 'running', 'Stop the bounded program before exporting its result');
    const from = new Date(Date.parse(execution.started.simulationTime) + plan.warmupSimulationMilliseconds).toISOString();
    const to = new Date(Math.min(Date.parse(from) + plan.evaluationSimulationMilliseconds, Date.parse(execution.lastObservation.simulationTime))).toISOString();
    const source=(role:string,fallback:string)=>join(root,expanded?.stores.find(s=>s.role===role)?.path??fallback);
    const nativeOutcomes:NativeOutcomeOptions|undefined=expanded?{workspace:root,worldId:expanded.worldId,
        agentPath:source('agent','.local/agent-state/agents.sqlite'),clockPath:source('clock','.local/simulation/simulation-clock.sqlite'),
        checkpointPath:source('checkpoint','server/engine/data/player-checkpoints.sqlite'),businessPath:source('business','.local/economy/businesses.sqlite'),
        tradePath:source('trades','server/engine/data/mods/trade-evidence.sqlite'),queuePath:source('queue','.local/admin/inference-queue.sqlite'),auditPath:join(root,'.local/admin/llm-audit.jsonl'),
        wallWindow:{from:execution.started.wallTime,to:execution.lastObservation.wallTime},
        population:{genesisPath:paths.genesisPath,integrityPath:paths.integrityPath,configDirectory:paths.configDirectory,
            healthPath:source('health','server/engine/data/mods/player-health-evidence.sqlite'),
            genesisResultId:plan.genesisResultId,genesisResultDigest:plan.genesisResultDigest},
        allowedActorAgentIds:execution.definition.binding.founders.map(f=>f.agentId),allowedObserverAgentIds:[]}:undefined;
    if(expanded)check(expanded.runId===plan.sessionId&&expanded.clockId===execution.started.clockId&&expanded.clockProfileDigest===execution.started.profileDigest
        &&expanded.seed===execution.definition.binding.genesis.seed,'Expanded report run/clock/seed differs');
    const evaluation = Date.parse(to) > Date.parse(from) ? reportSocietyEvaluation({
        fromSimulationTime: from, toSimulationTime: to, actorAgentIds: execution.definition.binding.founders.map(row => row.agentId),
        clockId: execution.started.clockId, clockProfileDigest: execution.started.profileDigest
    }, { configDirectory: paths.configDirectory, nativeOutcomes, dependencies: {
        enginePath: join(root, 'server/engine/data/mods/trade-evidence.sqlite'), productionPath: join(root, '.local/economy/businesses.sqlite'),
        agentPath: paths.agentPath, clockPath: paths.clockPath
    } }) : { status: 'inconclusive', reason: 'No positive observed evaluation window after warmup.' };
    const definition = { protocol: expanded?'society-benchmark-report-v2-expanded':'society-benchmark-report-v1', execution, evaluation,
        ...(expanded?{expandedInputs:{reportVersion:expanded.reportVersion,declaredSeed:expanded.seed,provider:expanded.provider,observerExport:'disabled'}}:{}),
        limitations: ['Food/tool/housing final-use ledgers have no default native gateway binding; their evaluation remains inconclusive.',
            'Exact archived evidence replay is supported. Engine random stream, asynchronous scheduling and external LLM replies are not deterministic replay inputs.',
            'Completion of the execution protocol does not establish a functioning or self-sufficient society.'] };
    return { ...definition, digest: digest(definition) };
}
