import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { SkillDefinition, SkillDefinitionResolver, SkillRunResult, SkillStep, SkillValue } from './types';
import { resolveSkillParameters, skillReferenceKey, validateSkillDefinition } from './validation';

export interface SkillVerificationCheck {
    id: string;
    passed: boolean;
    message: string;
}

export interface SkillVerificationReport {
    id: string;
    createdAt: string;
    verifierId: string;
    draft: { id: string; version: string };
    targetVersion: string;
    passed: boolean;
    checks: SkillVerificationCheck[];
    evidenceRunIds: string[];
    evidenceUsernames: string[];
    promoted?: SkillDefinition;
}

export interface SkillVerificationOptions {
    targetVersion: string;
    parameters?: Record<string, unknown>;
    minimumSuccessfulRuns?: number;
    now?: string;
    resolveDefinition?: SkillDefinitionResolver;
}

export const SKILL_VERIFIER_ID = 'deterministic-skill-verifier';

function versionParts(version: string): [number, number, number] {
    const parts = version.split('.').map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function versionIsNewer(candidate: string, existing: string): boolean {
    const left = versionParts(candidate);
    const right = versionParts(existing);
    return left[0] > right[0]
        || (left[0] === right[0] && left[1] > right[1])
        || (left[0] === right[0] && left[1] === right[1] && left[2] > right[2]);
}

function resolveValue(value: SkillValue, parameters: Record<string, string | number | boolean>): unknown {
    if (Array.isArray(value)) return value.map(entry => resolveValue(entry, parameters));
    if (value && typeof value === 'object') {
        if (Object.keys(value).length === 1 && 'parameter' in value && typeof value.parameter === 'string') {
            if (parameters[value.parameter] === undefined) throw new Error(`Parameter "${value.parameter}" has no value`);
            return parameters[value.parameter];
        }
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveValue(entry, parameters)]));
    }
    return value;
}

function operationCount(steps: SkillStep[], resolveDefinition: SkillDefinitionResolver | undefined,
    stack: string[], parameters: Record<string, string | number | boolean>): number {
    return steps.reduce((total, step) => {
        if (step.kind === 'operation') return total + (step.maxAttempts ?? 1);
        if (step.kind === 'repeat') {
            return total + step.maxIterations * operationCount(step.steps, resolveDefinition, stack, parameters);
        }
        const key = skillReferenceKey(step.skill);
        if (!resolveDefinition) throw new Error(`No resolver is available for composed dependency ${key}`);
        const input = resolveDefinition(step.skill);
        if (input === null || input === undefined) throw new Error(`Composed dependency ${key} was not found or is not visible`);
        const child = validateSkillDefinition(input);
        if (child.id !== step.skill.id || child.version !== step.skill.version) {
            throw new Error(`Resolver returned a different skill for ${key}`);
        }
        if (child.status !== 'verified') throw new Error(`Composed dependency ${key} is not verified`);
        if (stack.includes(key)) throw new Error(`Composition cycle detected: ${[...stack, key].join(' -> ')}`);
        if (stack.length > 8) throw new Error('Composition exceeds 8 nested skill calls');
        const childArguments = resolveValue(step.arguments, parameters) as Record<string, unknown>;
        const childParameters = resolveSkillParameters(child, childArguments);
        return total + operationCount(child.steps, resolveDefinition, [...stack, key], childParameters);
    }, 0);
}

function sameParameters(
    actual: Record<string, string | number | boolean> | undefined,
    expected: Record<string, string | number | boolean>
): boolean {
    if (!actual) return false;
    const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
    const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

export function verifyAndPromoteSkill(
    draftInput: unknown,
    evidence: SkillRunResult[],
    options: SkillVerificationOptions
): SkillVerificationReport {
    const draft = validateSkillDefinition(draftInput);
    const verifierId = SKILL_VERIFIER_ID;
    const minimumSuccessfulRuns = Math.max(2, Math.min(10, Math.trunc(options.minimumSuccessfulRuns ?? 2)));
    const createdAt = options.now ?? new Date().toISOString();
    const checks: SkillVerificationCheck[] = [];
    const check = (id: string, passed: boolean, message: string) => checks.push({ id, passed, message });

    check('agent-draft', draft.status === 'draft' && draft.provenance.authorKind === 'agent',
        'Only an agent-authored draft can enter automatic promotion.');
    check('shared-visibility', draft.sharing.visibility === 'shared',
        'Automatic promotion only publishes drafts explicitly shared by their author.');
    check('new-version', /^\d+\.\d+\.\d+$/.test(options.targetVersion) && versionIsNewer(options.targetVersion, draft.version),
        'The promoted version must be a newer semantic version.');

    let parameters: Record<string, string | number | boolean> = {};
    try {
        parameters = resolveSkillParameters(draft, options.parameters);
        check('parameters', true, 'Verification parameters resolve against the draft schema.');
    } catch (error) {
        check('parameters', false, error instanceof Error ? error.message : String(error));
    }

    let nominalOperations = 0;
    try {
        nominalOperations = operationCount(draft.steps, options.resolveDefinition,
            [`${draft.id}@${draft.version}`], parameters);
        check('composition-graph', true, 'Every composed dependency is exact-versioned, verified, visible and acyclic.');
    } catch (error) {
        check('composition-graph', false, error instanceof Error ? error.message : String(error));
    }
    check('operation-budget', nominalOperations > 0 && nominalOperations <= draft.limits.maxOperations,
        `Nominal bounded path requires ${nominalOperations} of ${draft.limits.maxOperations} allowed operations.`);

    const uniqueEvidence = [...new Map(evidence.map(run => [run.runId, run])).values()];
    check('independent-runs', uniqueEvidence.length >= minimumSuccessfulRuns,
        `${uniqueEvidence.length} unique run(s) supplied; ${minimumSuccessfulRuns} required.`);
    const matching = uniqueEvidence.filter(run => run.skill.id === draft.id && run.skill.version === draft.version);
    check('matching-draft', matching.length === uniqueEvidence.length,
        'Every evidence run must reference the exact immutable draft version.');
    check('successful-live-runs', uniqueEvidence.length >= minimumSuccessfulRuns && uniqueEvidence.every(run =>
        run.status === 'completed'
        && typeof run.username === 'string' && /^[a-zA-Z0-9]{1,12}$/.test(run.username)
        && run.operations > 0
        && run.events.some(event => event.type === 'skill.completed'
            && event.runId === run.runId
            && event.skill.id === draft.id && event.skill.version === draft.version
            && Date.parse(event.timestamp) >= Date.parse(draft.provenance.createdAt))
    ), 'Every evidence item must be a completed, attributed live run with executed operations.');
    check('matching-parameters', uniqueEvidence.length >= minimumSuccessfulRuns
        && uniqueEvidence.every(run => sameParameters(run.parameters, parameters)),
    'Every live run must record the same resolved parameters used by verification.');

    const passed = checks.every(item => item.passed);
    const report: SkillVerificationReport = {
        id: crypto.randomUUID(), createdAt, verifierId,
        draft: { id: draft.id, version: draft.version }, targetVersion: options.targetVersion,
        passed, checks, evidenceRunIds: uniqueEvidence.map(run => run.runId),
        evidenceUsernames: [...new Set(uniqueEvidence.flatMap(run => run.username ? [run.username.toLowerCase()] : []))]
    };
    if (!passed) return report;

    report.promoted = validateSkillDefinition({
        ...structuredClone(draft),
        version: options.targetVersion,
        status: 'verified',
        provenance: {
            authorKind: 'system',
            authorId: verifierId,
            createdAt,
            derivedFrom: { id: draft.id, version: draft.version },
            notes: `Automatically promoted from ${draft.id}@${draft.version}; evidence runs: ${report.evidenceRunIds.join(', ')}.`
        }
    });
    return report;
}

export class FileSkillVerificationJournal {
    private readonly root: string;

    constructor(root: string) {
        this.root = resolve(root);
    }

    async save(report: SkillVerificationReport): Promise<string> {
        if (!/^[0-9a-f-]{36}$/i.test(report.id)) throw new Error('Invalid verification report ID');
        await mkdir(this.root, { recursive: true });
        const destination = resolve(this.root, `${report.id}.json`);
        if (!destination.startsWith(`${this.root}${sep}`)) throw new Error('Verification path escapes journal root');
        await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        return destination;
    }
}
