import type { AgentSkillParameterBinding, AgentSkillParameterSourceKind,
    AgentSkillReference } from '../../../agent-state/types.js';
import { createSkillParameterBinding } from '../../../agent-state/skill-binding.js';
import type { SkillDefinition } from '../../../agent-skills/types.js';
import { validateAdminSkillParameters } from './skill-catalog.js';

export interface AutonomousSkillParameterCandidate {
    sourceKind: AgentSkillParameterSourceKind;
    sourceId: string;
    skill: AgentSkillReference;
    parameters: unknown;
}

/**
 * Selects parameters only from an exact, persisted authority source. Validation is
 * performed against the selected reviewed skill before the digest is calculated.
 */
export function bindAutonomousSkillParameters(definition: SkillDefinition,
    candidates: readonly AutonomousSkillParameterCandidate[]): AgentSkillParameterBinding {
    const exact = candidates.find(candidate => candidate.skill.id === definition.id
        && candidate.skill.version === definition.version);
    if (!exact) throw new Error('Autonomous skill has no exact persisted parameter source');
    const parameters = validateAdminSkillParameters(definition, exact.parameters);
    return createSkillParameterBinding({ sourceKind: exact.sourceKind, sourceId: exact.sourceId, parameters });
}

export type SkillFailureDisposition = Exclude<import('../../../agent-state/types.js').AgentSkillRunOutcomeClassification,
    'completed'>;

export type AutonomousExecutionGapKind = 'procedure' | 'parameter-binding' | 'context' | 'policy'
    | 'lifecycle' | 'input-shortage' | 'transient';

export interface AutonomousExecutionFailure {
    gapKind: AutonomousExecutionGapKind;
    disposition: SkillFailureDisposition;
}

/**
 * Separates a missing reusable procedure from failures that must be repaired by
 * authoritative parameters, refreshed context, policy/lifecycle changes, or
 * bounded input acquisition. Only `procedure` is eligible for Skill Builder.
 */
export function classifyAutonomousExecutionFailure(code: string | undefined,
    detail: string): AutonomousExecutionFailure {
    const value = `${code ?? ''} ${detail}`.toLowerCase();
    if (/parameter|binding|digest|exact persisted .*source|unknown argument|missing required/.test(value)) {
        return { gapKind: 'parameter-binding', disposition: 'authorization' };
    }
    if (/authori[sz]|permission|approval|forbidden|policy|not allowed|draft|allowlist/.test(value)) {
        return { gapKind: 'policy', disposition: 'authorization' };
    }
    if (/employment|contract .*expired|expired contract|inactive (goal|request)|already (completed|cancelled|rejected)|terminal request/.test(value)) {
        return { gapKind: 'lifecycle', disposition: 'authorization' };
    }
    if (/stale|authoritative context|context blocker|snapshot|revision mismatch|changed since/.test(value)) {
        return { gapKind: 'context', disposition: 'retry' };
    }
    if (/procedure-not-found|unknown skill|skill not found|unsupported operation|missing .*capability|no .*capability/.test(value)) {
        return { gapKind: 'procedure', disposition: 'capability-gap' };
    }
    if (/inventory|missing item|requires? .*item|tool required|insufficient (item|resource|coins|gp)|shortage/.test(value)) {
        return { gapKind: 'input-shortage', disposition: 'acquire-input' };
    }
    return { gapKind: 'transient', disposition: 'retry' };
}

/** Fail-closed routing for terminal/precondition failures. */
export function classifySkillFailure(code: string | undefined, detail: string): SkillFailureDisposition {
    return classifyAutonomousExecutionFailure(code, detail).disposition;
}
