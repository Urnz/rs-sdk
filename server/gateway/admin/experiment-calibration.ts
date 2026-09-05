import { EXPERIMENT_ADAPTERS } from './experiment-applied-profile.js';
import { compareMultiAgentExperiments, validateMultiAgentExperimentEnvironment,
    type MultiAgentExperimentRun } from './multi-agent-experiments.js';

export interface ExperimentCalibrationPair {
    control: MultiAgentExperimentRun;
    treatment: MultiAgentExperimentRun;
}

/** A descriptive comparison of measured candidates; no inferred optimum or synthetic runs. */
export function compareExperimentCalibrations(manual: ExperimentCalibrationPair,
    grid: ExperimentCalibrationPair[]) {
    if (!Array.isArray(grid) || grid.length < 2 || grid.length > 16) {
        throw new Error('Calibration comparison requires 2-16 measured grid candidates');
    }
    const reference = compareMultiAgentExperiments(manual.control, manual.treatment);
    if (manual.control.parameterProfile!.origin !== 'manual') {
        throw new Error('The reference calibration must have manual provenance');
    }
    const environments = (run: MultiAgentExperimentRun) =>
        validateMultiAgentExperimentEnvironment(run.environment).environment.mods.map(mod =>
            EXPERIMENT_ADAPTERS.some(adapter => adapter.id === mod.id) ? { ...mod, config: {} } : mod);
    const referenceEnvironment = JSON.stringify(environments(manual.control));
    const seenRuns = new Set([manual.control.experimentId, manual.treatment.experimentId]);
    const seenParameters = new Set<string>();
    const candidates = grid.map(pair => {
        const comparison = compareMultiAgentExperiments(pair.control, pair.treatment);
        const profile = pair.control.parameterProfile!;
        if (profile.origin !== 'grid-search') throw new Error('Grid candidates must have grid-search provenance');
        for (const run of [pair.control, pair.treatment]) {
            if (seenRuns.has(run.experimentId)) throw new Error('Calibration runs cannot be reused');
            seenRuns.add(run.experimentId);
        }
        const parameters = JSON.stringify(profile.parameters);
        if (seenParameters.has(parameters)) throw new Error('Grid candidates must have distinct parameter values');
        seenParameters.add(parameters);
        if (comparison.seed !== reference.seed || JSON.stringify(comparison.agentIds) !== JSON.stringify(reference.agentIds)
            || pair.control.summary !== manual.control.summary || pair.treatment.summary !== manual.treatment.summary
            || JSON.stringify(environments(pair.control)) !== referenceEnvironment) {
            throw new Error('Calibrations require the same seed, cohort, scenario and non-parameter environment');
        }
        for (const participant of manual.control.participants) {
            const candidate = pair.control.participants.find(entry => entry.agentId === participant.agentId)!;
            if (candidate.baselineAvatarDigest !== participant.baselineAvatarDigest
                || JSON.stringify(candidate.baselineGoals) !== JSON.stringify(participant.baselineGoals)) {
                throw new Error('Calibrations require identical avatar and goal baselines');
            }
        }
        const delta = comparison.treatmentMinusControl;
        const difference = Object.fromEntries(Object.entries(delta).map(([key, value]) =>
            [key, value - reference.treatmentMinusControl[key as keyof typeof delta]]));
        return { profile, comparison, effectMinusManual: difference };
    });
    return { schemaVersion: 1 as const, manual: { profile: manual.control.parameterProfile!, comparison: reference },
        candidates, interpretation: 'Descriptive treatment-minus-control effects; no optimum or statistical significance inferred.' };
}
