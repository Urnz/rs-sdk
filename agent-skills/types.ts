export const SKILL_SCHEMA_VERSION = 1 as const;

export type SkillStatus = 'draft' | 'verified' | 'deprecated';
export type SkillVisibility = 'shared' | 'private';
export type SkillAuthorKind = 'human' | 'agent' | 'system';
export type SkillSharingMode = 'shared-library' | 'isolated-discovery';

export interface SkillParameterReference {
    parameter: string;
}

export type SkillValue =
    | string
    | number
    | boolean
    | null
    | SkillParameterReference
    | SkillValue[]
    | { [key: string]: SkillValue };

export type SkillArguments = Record<string, SkillValue>;

export interface SkillParameterDefinition {
    type: 'string' | 'number' | 'boolean';
    description: string;
    required?: boolean;
    default?: string | number | boolean;
    enum?: Array<string | number | boolean>;
    minimum?: number;
    maximum?: number;
}

export interface SkillProvenance {
    authorKind: SkillAuthorKind;
    authorId: string;
    createdAt: string;
    derivedFrom?: SkillReference;
    notes?: string;
}

export interface SkillSharing {
    visibility: SkillVisibility;
    ownerAgentId?: string;
}

export interface SkillLimits {
    timeoutMs: number;
    maxOperations: number;
}

export type SkillOperationName =
    | 'walk-to'
    | 'wait-for-area'
    | 'talk-to-npc'
    | 'navigate-dialog'
    | 'interact-loc'
    | 'interact-npc'
    | 'gather-loc'
    | 'gather-npc'
    | 'smith-at-anvil'
    | 'open-shop'
    | 'buy-from-shop'
    | 'sell-to-shop'
    | 'close-shop'
    | 'trade-give-item'
    | 'open-bank'
    | 'deposit-item'
    | 'withdraw-item'
    | 'close-bank'
    | 'wait-ticks';

export type SkillConditionName =
    | 'inventory-full'
    | 'inventory-contains'
    | 'inventory-free-slots-at-most'
    | 'inventory-free-slots-at-least'
    | 'skill-level-at-least';

export interface SkillOperationStep {
    kind: 'operation';
    id: string;
    operation: SkillOperationName;
    arguments: SkillArguments;
    maxAttempts?: number;
    onFailure?: 'stop' | 'continue';
}

export interface SkillCondition {
    condition: SkillConditionName;
    arguments: SkillArguments;
}

export interface SkillRepeatStep {
    kind: 'repeat';
    id: string;
    until: SkillCondition;
    maxIterations: number;
    steps: SkillStep[];
}

export type SkillStep = SkillOperationStep | SkillRepeatStep;

export interface SkillDefinition {
    schemaVersion: typeof SKILL_SCHEMA_VERSION;
    id: string;
    version: string;
    name: string;
    description: string;
    status: SkillStatus;
    tags: string[];
    parameters: Record<string, SkillParameterDefinition>;
    provenance: SkillProvenance;
    sharing: SkillSharing;
    limits: SkillLimits;
    preconditions: SkillCondition[];
    steps: SkillStep[];
}

export interface SkillReference {
    id: string;
    version: string;
}

export interface RegisteredSkill {
    definition: SkillDefinition;
    checksum: string;
}

export interface SkillOperationResult {
    success: boolean;
    message: string;
    code?: string;
    data?: Record<string, unknown>;
}

export interface SkillRuntime {
    execute(operation: SkillOperationName, args: Record<string, unknown>, signal: AbortSignal): Promise<SkillOperationResult>;
    test(condition: SkillConditionName, args: Record<string, unknown>, signal: AbortSignal): Promise<boolean>;
}

export type SkillEventType =
    | 'skill.started'
    | 'step.started'
    | 'step.succeeded'
    | 'step.failed'
    | 'skill.completed'
    | 'skill.failed'
    | 'skill.cancelled'
    | 'skill.limit-reached';

export interface SkillEvent {
    runId: string;
    type: SkillEventType;
    timestamp: string;
    skill: SkillReference;
    stepId?: string;
    operation?: SkillOperationName;
    attempt?: number;
    code?: string;
    message?: string;
}

export type SkillRunStatus = 'completed' | 'failed' | 'cancelled' | 'limit-reached';

export interface SkillRunResult {
    runId: string;
    username?: string;
    skill: SkillReference;
    status: SkillRunStatus;
    reason: string;
    message: string;
    operations: number;
    durationMs: number;
    events: SkillEvent[];
}

export interface SkillExecutionOptions {
    parameters?: Record<string, unknown>;
    signal?: AbortSignal;
    allowDraft?: boolean;
    onEvent?: (event: SkillEvent) => void;
}
