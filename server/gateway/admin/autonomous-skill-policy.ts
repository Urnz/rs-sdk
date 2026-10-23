import type { LlmAutonomousExecutionConfig } from '../../../llm-runtime/types.js';
import type { SkillDefinition, SkillOperationName, SkillStep } from '../../../agent-skills/types.js';

export const ROUTINE_AUTONOMOUS_OPERATIONS: SkillOperationName[] = ['walk-to', 'wait-for-area', 'talk-to-npc',
    'navigate-dialog', 'interact-loc', 'interact-npc', 'gather-loc', 'gather-npc', 'smith-at-anvil',
    'open-shop', 'sell-to-shop', 'close-shop', 'open-bank', 'deposit-item', 'withdraw-item', 'close-bank',
    'wait-ticks'];

export function evaluateAutonomousSkillPolicy(config: LlmAutonomousExecutionConfig,
    definition: SkillDefinition): { allowed: boolean; reason: string;
        authorization?: LlmAutonomousExecutionConfig['allowedSkills'][number] } {
    const reference = `${definition.id}@${definition.version}`;
    if (!config.enabled) return { allowed: false, reason: 'Autonomous execution is disabled.' };
    const authorization = config.allowedSkills.find(skill => skill.id === definition.id
        && skill.version === definition.version);
    if (!authorization) {
        return { allowed: false, reason: `${reference} is not on the exact autonomous allowlist.` };
    }
    if (definition.status !== 'verified') return { allowed: false, reason: `${reference} is not verified.` };
    if (definition.limits.maxOperations > config.maxOperations || definition.limits.timeoutMs > config.maxTimeoutMs) {
        return { allowed: false, reason: `${reference} exceeds the autonomous operation or time limit.` };
    }
    const allowedOperations = new Set(authorization.operations ?? ROUTINE_AUTONOMOUS_OPERATIONS);
    const inspect = (steps: SkillStep[]): string | null => {
        for (const step of steps) {
            if (step.kind === 'call') return 'Composed skill calls are not allowed in the initial autonomous policy.';
            if (step.kind === 'repeat') { const nested = inspect(step.steps); if (nested) return nested; continue; }
            if (!allowedOperations.has(step.operation)) {
                return `Operation ${step.operation} is outside the exact autonomous authorization.`;
            }
        }
        return null;
    };
    const unsafe = inspect(definition.steps);
    return unsafe ? { allowed: false, reason: unsafe } : { allowed: true,
        reason: `${reference} passed autonomous policy.`, authorization };
}
