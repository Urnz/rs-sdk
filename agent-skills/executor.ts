import { randomUUID } from 'node:crypto';
import type {
    SkillCallStep,
    SkillDefinition,
    SkillDefinitionResolver,
    SkillEvent,
    SkillExecutionOptions,
    SkillOperationStep,
    SkillRunResult,
    SkillRunStatus,
    SkillRuntime,
    SkillStep,
    SkillValue
} from './types';
import { resolveSkillParameters, skillReferenceKey, validateSkillDefinition } from './validation';

const MAX_CALL_DEPTH = 8;

class SkillRunError extends Error {
    constructor(
        public readonly status: SkillRunStatus,
        public readonly reason: string,
        message: string,
        public readonly stepId?: string
    ) {
        super(message);
    }
}

function resolveValue(value: SkillValue, parameters: Record<string, string | number | boolean>): unknown {
    if (Array.isArray(value)) return value.map(entry => resolveValue(entry, parameters));
    if (value && typeof value === 'object') {
        if (Object.keys(value).length === 1 && 'parameter' in value && typeof value.parameter === 'string') {
            const parameter = parameters[value.parameter];
            if (parameter === undefined) throw new SkillRunError('failed', 'invalid-parameters', `Parameter "${value.parameter}" has no value`);
            return parameter;
        }
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveValue(entry, parameters)]));
    }
    return value;
}

export class SkillExecutor {
    constructor(private readonly runtime: SkillRuntime, private readonly resolveDefinition?: SkillDefinitionResolver) {}

    async execute(input: unknown, options: SkillExecutionOptions = {}): Promise<SkillRunResult> {
        const definition = validateSkillDefinition(input);
        const reference = { id: definition.id, version: definition.version };
        const runId = randomUUID();
        const events: SkillEvent[] = [];
        const started = Date.now();
        let operations = 0;
        let resolvedParameters: Record<string, string | number | boolean> = {};
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort('timeout'), definition.limits.timeoutMs);
        const externalAbort = () => controller.abort(options.signal?.reason ?? 'cancelled');
        if (options.signal?.aborted) externalAbort();
        else options.signal?.addEventListener('abort', externalAbort, { once: true });

        const emit = (event: Omit<SkillEvent, 'runId' | 'timestamp' | 'skill'>) => {
            const complete: SkillEvent = {
                runId,
                timestamp: new Date().toISOString(),
                skill: reference,
                ...event
            };
            events.push(complete);
            options.onEvent?.(complete);
        };

        const finish = (status: SkillRunStatus, reason: string, message: string): SkillRunResult => ({
            runId,
            skill: reference,
            status,
            reason,
            message,
            operations,
            durationMs: Date.now() - started,
            parameters: resolvedParameters,
            events
        });

        try {
            if (definition.status === 'deprecated') throw new SkillRunError('failed', 'deprecated', 'Deprecated skills cannot be executed');
            if (definition.status === 'draft' && !options.allowDraft) throw new SkillRunError('failed', 'draft-not-allowed', 'Draft skills require explicit allowDraft');
            const parameters = resolveSkillParameters(definition, options.parameters);
            resolvedParameters = parameters;

            const resolvedDefinitions = new Map<string, SkillDefinition>();
            const resolveCall = (step: SkillCallStep): SkillDefinition => {
                const key = skillReferenceKey(step.skill);
                const cached = resolvedDefinitions.get(key);
                if (cached) return cached;
                if (!this.resolveDefinition) {
                    throw new SkillRunError('failed', 'composition-unavailable',
                        `Skill "${key}" requires a procedure resolver`, step.id);
                }
                const resolved = this.resolveDefinition(step.skill);
                if (resolved === null || resolved === undefined) {
                    throw new SkillRunError('failed', 'procedure-not-found',
                        `Called skill "${key}" was not found or is not visible`, step.id);
                }
                const child = validateSkillDefinition(resolved);
                if (child.id !== step.skill.id || child.version !== step.skill.version) {
                    throw new SkillRunError('failed', 'procedure-reference-mismatch',
                        `Resolver returned a different skill for "${key}"`, step.id);
                }
                resolvedDefinitions.set(key, child);
                return child;
            };

            const callsIn = (steps: SkillStep[]): SkillCallStep[] => steps.flatMap(step =>
                step.kind === 'call' ? [step] : step.kind === 'repeat' ? callsIn(step.steps) : []);
            const preflight = (current: SkillDefinition, currentParameters: Record<string, string | number | boolean>,
                stack: string[]): void => {
                if (stack.length > MAX_CALL_DEPTH + 1) {
                    throw new SkillRunError('failed', 'procedure-depth-limit',
                        `Skill composition exceeds ${MAX_CALL_DEPTH} nested calls`);
                }
                for (const call of callsIn(current.steps)) {
                    const child = resolveCall(call);
                    const childKey = skillReferenceKey(child);
                    if (stack.includes(childKey)) {
                        throw new SkillRunError('failed', 'procedure-cycle',
                            `Skill composition cycle detected: ${[...stack, childKey].join(' -> ')}`, call.id);
                    }
                    if (child.status === 'deprecated') {
                        throw new SkillRunError('failed', 'deprecated-procedure',
                            `Called skill "${childKey}" is deprecated`, call.id);
                    }
                    if (child.status === 'draft' && !options.allowDraft) {
                        throw new SkillRunError('failed', 'draft-procedure-not-allowed',
                            `Called draft skill "${childKey}" requires explicit allowDraft`, call.id);
                    }
                    const childArguments = resolveValue(call.arguments, currentParameters) as Record<string, unknown>;
                    const childParameters = resolveSkillParameters(child, childArguments);
                    preflight(child, childParameters, [...stack, childKey]);
                }
            };
            preflight(definition, parameters, [skillReferenceKey(reference)]);
            emit({ type: 'skill.started', message: `Starting ${definition.name}` });

            const checkAbort = () => {
                if (!controller.signal.aborted) return;
                const timedOut = controller.signal.reason === 'timeout';
                throw new SkillRunError(timedOut ? 'limit-reached' : 'cancelled', timedOut ? 'timeout' : 'cancelled', timedOut ? 'Skill timeout reached' : 'Skill cancelled');
            };

            const runOperation = async (step: SkillOperationStep,
                frameParameters: Record<string, string | number | boolean>, stepId: string): Promise<void> => {
                const attempts = step.maxAttempts ?? 1;
                const args = resolveValue(step.arguments, frameParameters) as Record<string, unknown>;
                for (let attempt = 1; attempt <= attempts; attempt++) {
                    checkAbort();
                    if (operations >= definition.limits.maxOperations) {
                        throw new SkillRunError('limit-reached', 'operation-limit', 'Skill operation limit reached', stepId);
                    }
                    operations++;
                    emit({ type: 'step.started', stepId, operation: step.operation, attempt });
                    const result = await this.runtime.execute(step.operation, args, controller.signal);
                    checkAbort();
                    if (result.success) {
                        emit({ type: 'step.succeeded', stepId, operation: step.operation, attempt, code: result.code, message: result.message, data: result.data });
                        return;
                    }
                    emit({ type: 'step.failed', stepId, operation: step.operation, attempt, code: result.code, message: result.message, data: result.data });
                    if (attempt === attempts) {
                        if (step.onFailure === 'continue') return;
                        throw new SkillRunError('failed', result.code ?? 'operation-failed', result.message, stepId);
                    }
                }
            };

            const runDefinition = async (current: SkillDefinition,
                frameParameters: Record<string, string | number | boolean>, prefix: string): Promise<void> => {
                for (const precondition of current.preconditions) {
                    checkAbort();
                    const args = resolveValue(precondition.arguments, frameParameters) as Record<string, unknown>;
                    if (!await this.runtime.test(precondition.condition, args, controller.signal)) {
                        throw new SkillRunError('failed', 'precondition-failed',
                            `Precondition "${precondition.condition}" is not satisfied`, prefix || undefined);
                    }
                }
                await runSteps(current.steps, frameParameters, prefix);
            };

            const runSteps = async (steps: SkillStep[], frameParameters: Record<string, string | number | boolean>,
                prefix: string): Promise<void> => {
                for (const step of steps) {
                    checkAbort();
                    const stepId = `${prefix}${step.id}`;
                    if (step.kind === 'operation') {
                        await runOperation(step, frameParameters, stepId);
                        continue;
                    }
                    if (step.kind === 'call') {
                        const child = resolveCall(step);
                        const childArguments = resolveValue(step.arguments, frameParameters) as Record<string, unknown>;
                        const childParameters = resolveSkillParameters(child, childArguments);
                        await runDefinition(child, childParameters, `${stepId}/`);
                        continue;
                    }
                    const conditionArgs = resolveValue(step.until.arguments, frameParameters) as Record<string, unknown>;
                    let satisfied = await this.runtime.test(step.until.condition, conditionArgs, controller.signal);
                    for (let iteration = 0; !satisfied && iteration < step.maxIterations; iteration++) {
                        await runSteps(step.steps, frameParameters, prefix);
                        checkAbort();
                        satisfied = await this.runtime.test(step.until.condition, conditionArgs, controller.signal);
                    }
                    if (!satisfied) throw new SkillRunError('failed', 'repeat-condition-not-met',
                        `Repeat step "${step.id}" reached its iteration limit`, stepId);
                }
            };

            await runDefinition(definition, parameters, '');
            emit({ type: 'skill.completed', message: `${definition.name} completed` });
            return finish('completed', 'completed', `${definition.name} completed`);
        } catch (error) {
            const runError = error instanceof SkillRunError
                ? error
                : new SkillRunError('failed', 'runtime-error', error instanceof Error ? error.message : String(error));
            const type = runError.status === 'cancelled'
                ? 'skill.cancelled'
                : runError.status === 'limit-reached' ? 'skill.limit-reached' : 'skill.failed';
            emit({ type, stepId: runError.stepId, code: runError.reason, message: runError.message });
            return finish(runError.status, runError.reason, runError.message);
        } finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', externalAbort);
        }
    }
}
