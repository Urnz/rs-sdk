import { randomUUID } from 'node:crypto';
import type {
    SkillDefinition,
    SkillEvent,
    SkillExecutionOptions,
    SkillOperationStep,
    SkillRunResult,
    SkillRunStatus,
    SkillRuntime,
    SkillStep,
    SkillValue
} from './types';
import { resolveSkillParameters, validateSkillDefinition } from './validation';

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
    constructor(private readonly runtime: SkillRuntime) {}

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
            emit({ type: 'skill.started', message: `Starting ${definition.name}` });

            const checkAbort = () => {
                if (!controller.signal.aborted) return;
                const timedOut = controller.signal.reason === 'timeout';
                throw new SkillRunError(timedOut ? 'limit-reached' : 'cancelled', timedOut ? 'timeout' : 'cancelled', timedOut ? 'Skill timeout reached' : 'Skill cancelled');
            };

            for (const precondition of definition.preconditions) {
                checkAbort();
                const args = resolveValue(precondition.arguments, parameters) as Record<string, unknown>;
                if (!await this.runtime.test(precondition.condition, args, controller.signal)) {
                    throw new SkillRunError('failed', 'precondition-failed', `Precondition "${precondition.condition}" is not satisfied`);
                }
            }

            const runOperation = async (step: SkillOperationStep): Promise<void> => {
                const attempts = step.maxAttempts ?? 1;
                const args = resolveValue(step.arguments, parameters) as Record<string, unknown>;
                for (let attempt = 1; attempt <= attempts; attempt++) {
                    checkAbort();
                    if (operations >= definition.limits.maxOperations) {
                        throw new SkillRunError('limit-reached', 'operation-limit', 'Skill operation limit reached', step.id);
                    }
                    operations++;
                    emit({ type: 'step.started', stepId: step.id, operation: step.operation, attempt });
                    const result = await this.runtime.execute(step.operation, args, controller.signal);
                    checkAbort();
                    if (result.success) {
                        emit({ type: 'step.succeeded', stepId: step.id, operation: step.operation, attempt, code: result.code, message: result.message, data: result.data });
                        return;
                    }
                    emit({ type: 'step.failed', stepId: step.id, operation: step.operation, attempt, code: result.code, message: result.message, data: result.data });
                    if (attempt === attempts) {
                        if (step.onFailure === 'continue') return;
                        throw new SkillRunError('failed', result.code ?? 'operation-failed', result.message, step.id);
                    }
                }
            };

            const runSteps = async (steps: SkillStep[]): Promise<void> => {
                for (const step of steps) {
                    checkAbort();
                    if (step.kind === 'operation') {
                        await runOperation(step);
                        continue;
                    }
                    const conditionArgs = resolveValue(step.until.arguments, parameters) as Record<string, unknown>;
                    let satisfied = await this.runtime.test(step.until.condition, conditionArgs, controller.signal);
                    for (let iteration = 0; !satisfied && iteration < step.maxIterations; iteration++) {
                        await runSteps(step.steps);
                        checkAbort();
                        satisfied = await this.runtime.test(step.until.condition, conditionArgs, controller.signal);
                    }
                    if (!satisfied) throw new SkillRunError('failed', 'repeat-condition-not-met', `Repeat step "${step.id}" reached its iteration limit`, step.id);
                }
            };

            await runSteps(definition.steps);
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
