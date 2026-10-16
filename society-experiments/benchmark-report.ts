import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { check, readDatabase } from '../external-trade/source.js';
import { digest } from '../external-trade/policy.js';
import { reportSocietyEvaluation } from '../society-metrics/evaluation-report.js';
import { validateLongExperimentPlan, type LongExperimentPlan } from './plan.js';
import { defaultLongExperimentSources, nativeLongExperimentDependencies, readLongExperimentReport } from './runtime.js';
import { readLongExperimentBinding } from './source.js';

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
export function readBenchmarkReport(baseRoot: string, raw: LongExperimentPlan) {
    const root = resolve(baseRoot), plan = validateLongExperimentPlan(raw), paths = defaultLongExperimentSources(root);
    const noNetwork = async (): Promise<never> => { throw new Error('Archived report cannot access the live gateway'); };
    const deps = nativeLongExperimentDependencies(paths, noNetwork, join(root, '.local/admin/multi-agent-experiments.sqlite'), join(root, '.local/admin/xp-execution.sqlite'));
    const execution = readLongExperimentReport(plan.sessionId, join(root, '.local/admin/long-experiments.sqlite'), deps);
    check('definition' in execution && digest(execution.definition.plan) === digest(plan), 'Exact native benchmark plan unavailable');
    check(execution.status !== 'running', 'Stop the bounded program before exporting its result');
    const from = new Date(Date.parse(execution.started.simulationTime) + plan.warmupSimulationMilliseconds).toISOString();
    const to = new Date(Math.min(Date.parse(from) + plan.evaluationSimulationMilliseconds, Date.parse(execution.lastObservation.simulationTime))).toISOString();
    const evaluation = Date.parse(to) > Date.parse(from) ? reportSocietyEvaluation({
        fromSimulationTime: from, toSimulationTime: to, actorAgentIds: execution.definition.binding.founders.map(row => row.agentId),
        clockId: execution.started.clockId, clockProfileDigest: execution.started.profileDigest
    }, { configDirectory: paths.configDirectory, dependencies: {
        enginePath: join(root, 'server/engine/data/mods/trade-evidence.sqlite'), productionPath: join(root, '.local/economy/businesses.sqlite'),
        agentPath: paths.agentPath, clockPath: paths.clockPath
    } }) : { status: 'inconclusive', reason: 'No positive observed evaluation window after warmup.' };
    const definition = { protocol: 'society-benchmark-report-v1', execution, evaluation,
        limitations: ['Food/tool/housing final-use ledgers have no default native gateway binding; their evaluation remains inconclusive.',
            'Exact archived evidence replay is supported. Engine random stream, asynchronous scheduling and external LLM replies are not deterministic replay inputs.',
            'Completion of the execution protocol does not establish a functioning or self-sufficient society.'] };
    return { ...definition, digest: digest(definition) };
}
