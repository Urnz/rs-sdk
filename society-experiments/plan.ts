import { digest, integer, key, hash, object } from '../external-trade/policy.js';
import { check } from '../external-trade/source.js';

export interface LongExperimentPlan {
    schemaVersion: 1; sessionId: string; label: string; summary: string; genesisResultId: string; genesisResultDigest: string;
    parameterProfileId: string; parameterProfileVersion: string; parameterProfileDigest: string;
    attributeBudgetPolicyId: string; attributeAllocationPolicyId: string; expectedConditionDigest: string; expectedInitialStateDigest: string;
    warmupSimulationMilliseconds: number; evaluationSimulationMilliseconds: number; bucketSimulationMilliseconds: number;
    cadenceSimulationMilliseconds: number; maximumGapSimulationMilliseconds: number; maximumWaveWallMilliseconds: number; maximumWallMilliseconds: number;
}
export function validateLongExperimentPlan(input: LongExperimentPlan): LongExperimentPlan {
    object(input, ['schemaVersion','sessionId','label','summary','genesisResultId','genesisResultDigest','parameterProfileId','parameterProfileVersion',
        'parameterProfileDigest','attributeBudgetPolicyId','attributeAllocationPolicyId','expectedConditionDigest','expectedInitialStateDigest','warmupSimulationMilliseconds','evaluationSimulationMilliseconds',
        'bucketSimulationMilliseconds','cadenceSimulationMilliseconds','maximumGapSimulationMilliseconds','maximumWaveWallMilliseconds','maximumWallMilliseconds']);
    check(input.schemaVersion === 1, 'Unsupported long experiment schema');
    for (const value of [input.sessionId,input.genesisResultId,input.parameterProfileId,input.attributeBudgetPolicyId,input.attributeAllocationPolicyId]) key(value);
    hash(input.genesisResultDigest); hash(input.parameterProfileDigest); hash(input.expectedConditionDigest); hash(input.expectedInitialStateDigest);
    check(/^[a-z0-9][a-z0-9.-]{0,63}$/.test(input.sessionId),'Invalid clock-safe session id');
    check(/^\d+\.\d+\.\d+$/.test(input.parameterProfileVersion) && input.label.trim() === input.label && input.label.length > 0 && input.label.length <= 80
        && input.summary.trim() === input.summary && input.summary.length > 0 && input.summary.length <= 240, 'Invalid long experiment description');
    const day = 86400000;
    integer(input.warmupSimulationMilliseconds, 30 * day);
    check(integer(input.evaluationSimulationMilliseconds, 365 * day) >= day, 'Long evaluation must cover at least one simulation day');
    check(integer(input.bucketSimulationMilliseconds, day) >= 3600000 && input.evaluationSimulationMilliseconds % input.bucketSimulationMilliseconds === 0,
        'Evaluation buckets must be whole hours up to one day and divide evaluation duration');
    check(integer(input.cadenceSimulationMilliseconds, 3600000) >= 60000 && input.bucketSimulationMilliseconds >= input.cadenceSimulationMilliseconds * 2,
        'Invalid long experiment cadence');
    check(integer(input.maximumGapSimulationMilliseconds, 3600000) >= input.cadenceSimulationMilliseconds, 'Invalid observation gap bound');
    check(integer(input.maximumWaveWallMilliseconds, day) >= 1000 && integer(input.maximumWallMilliseconds, 366 * day) >= input.maximumWaveWallMilliseconds,
        'Invalid finite wall deadlines');
    check(Math.ceil((input.warmupSimulationMilliseconds + input.evaluationSimulationMilliseconds) / input.cadenceSimulationMilliseconds) <= 10000,
        'Long experiment exceeds 10000 cohort waves');
    return structuredClone(input);
}
export const longPlanDigest = (input: LongExperimentPlan) => digest(validateLongExperimentPlan(input));
export function waveId(sessionId: string, planDigest: string, index: number): string {
    const hex = digest({sessionId,planDigest,index}); return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
