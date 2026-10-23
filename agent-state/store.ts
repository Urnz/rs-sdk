import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { generatePopulationEntry, populationEntryId, populationEntryDigest, validatePopulationEntryRequest,
    type PopulationEntryEnvironment, type PopulationEntryPlan, type PopulationEntryReceipt } from '../population-lifecycle/entry.js';
import { installPopulationEntrySchema, readPopulationEntry, verifyPopulationEntryHistory } from './population-entry.js';
import { PlayerHealthEvidenceStore } from '../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { createPopulationDeathEvidence, createStarvationDeathEvidence, populationDeathMembershipDigest, validatePopulationDeathEvidence,
    type PopulationDeathRecord } from '../population-lifecycle/death.js';
import { healthDigest } from '../population-health/policy.js';
import { installMemoryArchiveSchema, verifyMemoryHistory, archivePopulationMemory, readPopulationMemoryArchive } from './memory-archive.js';
import { previewMemoryTransfer, executeMemoryTransfer, type MemoryTransferPolicy, type MemoryTransferSelection, type MemoryTransferRequest } from './memory-transfer.js';
import type { BoundSimulationEventStamp } from '../simulation-clock/types.js';
import { SimulationClockStore } from '../simulation-clock/store.js';
import { characterAgeAt, evaluatePopulationAge, type PopulationAgePolicy,
    type PopulationAgeObservation } from '../population-lifecycle/age.js';
import { evaluatePopulationMortality, type PopulationMortalityPolicy,
    type PopulationMortalityObservation } from '../population-lifecycle/mortality.js';
import { AGENT_STATE_SCHEMA_VERSION, type AgentGoal, type AgentGoalEvent, type AgentGoalProposal, type AgentIdentity, type AgentSnapshot,
    type AgentCharacterLifecycle, type AgentCharacterLifecycleOrigin, type AgentPopulationMember,
    type AgentPopulationMembershipStatus, type BindAgentPopulationMember,
    type AgentAutonomyControl, type AgentAutonomyEnrollment, type AgentAutonomyStatus, type AgentControlProfile,
    type AgentDecisionRecord, type AgentDecisionTrigger, type AgentGoalExecution, type AgentSkillDispatch,
    type AgentSkillRunOutcome, type AgentSkillRunOutcomeClassification,
    type AgentPlayerActionManualStatus, type AgentPlayerActionRequest, type AgentPlayerActionStatus,
    type AgentCommitment, type AgentCommitmentStatus, type AgentEpisode, type AgentEpisodeListOptions,
    type AgentEpisodeProtectionReason, type AgentEpisodePruneResult, type AgentEpisodeRetentionPreview,
    type AgentConsolidationEvidence, type AgentEconomicActorLink, type AgentKnowledge,
    type AgentKnowledgeListOptions, type AgentRelationship,
    type AgentSkillKnowledge, type AgentSkillKnowledgeStatus,
    type AgentSkillReference, type AgentWorkingMemory, type CreateAgentCommitment,
    type CreateAgentConsolidationEvidence, type CreateAgentEpisode,
    type CreateAgentGoal, type CreateAgentGoalProposal, type CreateAgentIdentity, type CreateAgentKnowledge,
    type CreateAgentPlayerActionRequest, type GoalStatus,
    type RecordAgentDecision, type SetAgentAutonomyEnrollment, type SetAgentControlProfile,
    type SetAgentEconomicActorLink, type SetAgentRelationship, type SetAgentWorkingMemory,
    type UpdateAgentIdentity } from './types.js';
import { createSkillParameterBinding } from './skill-binding.js';
import { installStateGoalSchema, evaluateStateObjective, STATE_GOAL_POLICY,
    type StateObjective, type StateGoalEvaluation } from './state-objectives.js';
import type { EconomicObservation } from './economic-context.js';
import { installPlayerStrategySchema, readPlayerStrategy, PLAYER_STRATEGY_POLICY,
    type PlayerStrategyRequest, type PlayerStrategyRun } from './player-strategy.js';
import type { LlmPlanResult } from '../llm-runtime/types.js';
import {installEconomicActionSchema,readEconomicAction,type EconomicActionRequest,type EconomicActionRun} from './economic-action.js';
import { installInstitutionStrategySchema, readInstitutionStrategy,
    type InstitutionStrategyRequest, type InstitutionStrategyRun } from './institution-strategy.js';
import { installLivelihoodJournal, readLivelihoodJournal, writeLivelihoodJournal,
    type LivelihoodJournalEntry } from './livelihood.js';
import { expectedParentHorizon, normalizeAgentId, validateCreateGoal, validateCreateIdentity,
    normalizeActorKey, normalizeEconomicActorId, normalizeSkillReference, validateCreateCommitment, validateCreateEpisode,
    validateCreateKnowledge, validateIdentityPatch, validateRelationship, validateSkillKnowledgeStatus,
    validateAutonomyEnrollment, validateControlProfile, validateCreatePlayerActionRequest, validateEconomicActorLink,
    validateWorkingMemory } from './validation.js';

interface IdentityRow {
    agent_id: string; player_username: string | null; display_name: string; background: string;
    personality_traits: string; agent_values: string; created_at: string; updated_at: string; revision: number;
}
interface CharacterLifecycleRow {
    agent_id: string; origin: AgentCharacterLifecycleOrigin; created_at_simulation_time: string;
    birth_at_simulation_time: string | null; age_at_observation_ms: number;
    age_observed_at_simulation_time: string; status: AgentCharacterLifecycle['status'];
    status_changed_at_simulation_time: string; created_at: string; updated_at: string; revision: number;
}
interface PopulationMemberRow {
    agent_id:string;player_username:string;world_profile_id:string;world_profile_version:string;
    world_profile_digest:string;lifecycle_policy_id:string;lifecycle_policy_version:string;
    lifecycle_policy_digest:string;lifecycle_policy_kind:'finite';simulation_clock_id:string;
    simulation_clock_profile_digest:string;joined_at_simulation_time:string;source_result_id:string;
    source_result_digest:string;status:AgentPopulationMembershipStatus;reset_at_simulation_time:string|null;
    created_at:string;updated_at:string;revision:number;
}
interface GoalRow {
    goal_id: string; agent_id: string; parent_goal_id: string | null; horizon: AgentGoal['horizon'];
    title: string; description: string; status: GoalStatus; priority: number; created_at: string;
    skill_id: string | null; skill_version: string | null; updated_at: string; completed_at: string | null; revision: number;
}
interface GoalEventRow {
    sequence: number; goal_id: string; agent_id: string; kind: AgentGoalEvent['kind'];
    previous_status: GoalStatus | null; status: GoalStatus; previous_revision: number | null;
    revision: number; skill_id: string | null; skill_version: string | null; occurred_at: string;
    simulation_clock_id: string | null; simulation_sequence: number | null;
    simulation_time: string | null; simulation_binding_wall_time: string | null;
    simulation_engine_tick: number | null; simulation_profile_digest: string | null;
    simulation_clock_status: 'running' | 'paused' | null; simulation_clock_revision: number | null;
    simulation_source_digest: string | null;
}

export interface AgentStateSimulationClock {
    store: SimulationClockStore;
    clockId: string;
    engineTick?: () => number | undefined;
}
interface GoalProposalRow {
    proposal_id: string; run_id: string; agent_id: string; anchor_goal_id: string; anchor_goal_revision: number;
    goals: string; skill_id: string | null; skill_version: string | null; reason: string;
    status: AgentGoalProposal['status']; approval_id: string | null; approval_expires_at: string | null;
    skill_run_id: string | null; response_note: string; created_at: string; updated_at: string;
    approved_at: string | null; started_at: string | null; resolved_at: string | null; revision: number;
}
interface WorkingMemoryRow {
    agent_id: string; summary: string; current_activity: string | null; location: string | null;
    observations: string; observed_at: string; updated_at: string; revision: number;
}
interface SkillKnowledgeRow {
    agent_id: string; skill_id: string; skill_version: string; status: AgentSkillKnowledgeStatus;
    learned_at: string; updated_at: string; revision: number;
}
interface EpisodeRow {
    episode_id: string; agent_id: string; kind: AgentEpisode['kind']; summary: string; details: string;
    importance: number; goal_ids: string; actors: string; tags: string; source: AgentEpisode['source'];
    trust: AgentEpisode['trust']; external_key: string | null; occurred_at: string; expires_at: string | null;
    created_at: string;
}
interface KnowledgeRow {
    knowledge_id: string; agent_id: string; kind: AgentKnowledge['kind']; subject: string; predicate: string;
    object: string; summary: string; confidence: number; goal_ids: string; tags: string;
    evidence_episode_ids: string; source: AgentKnowledge['source']; status: AgentKnowledge['status'];
    supersedes_id: string | null; external_key: string | null; valid_from: string; valid_until: string | null;
    created_at: string; updated_at: string; revision: number;
}
interface RelationshipRow {
    agent_id: string; actor_key: string; display_name: string; trust: number; affinity: number; familiarity: number;
    agent_owes_gp: number; actor_owes_gp: number; notes: string; tags: string; evidence_episode_ids: string;
    last_interaction_at: string | null; created_at: string; updated_at: string; revision: number;
}
interface CommitmentRow {
    commitment_id: string; agent_id: string; actor_key: string; direction: AgentCommitment['direction'];
    description: string; status: AgentCommitmentStatus; value_gp: number | null; due_at: string | null;
    evidence_episode_ids: string; created_at: string; updated_at: string; resolved_at: string | null; revision: number;
}
interface EconomicActorLinkRow {
    agent_id: string; actor_kind: AgentEconomicActorLink['actorKind']; actor_id: string;
    role: AgentEconomicActorLink['role']; source: AgentEconomicActorLink['source'];
    created_at: string; updated_at: string; revision: number;
}
interface ControlProfileRow {
    agent_id: string; role: AgentControlProfile['role']; subject_kind: AgentControlProfile['subjectKind'];
    subject_id: string; avatar_player_username: string | null; decision_interval_ms: number;
    max_decisions_per_day: number; daily_llm_budget_micros: number; daily_operational_budget_gp: number;
    last_decision_at: string | null; next_decision_at: string | null; created_at: string; updated_at: string;
    revision: number;
}
interface AutonomyEnrollmentRow {
    agent_id: string; status: AgentAutonomyStatus; policy_id: string; policy_version: string;
    next_wakeup_at: string | null; lease_owner: string | null; lease_expires_at: string | null;
    failure_count: number; last_failure_fingerprint: string | null; quarantine_reason: string | null;
    created_at: string; updated_at: string; revision: number;
}
interface AutonomyControlRow {
    emergency_stop: number; reason: string | null; activated_at: string | null;
    updated_at: string; revision: number;
}
interface DecisionRecordRow {
    decision_id: string; agent_id: string; trigger: AgentDecisionTrigger; llm_cost_micros: number;
    operational_budget_gp: number; occurred_at: string; profile_revision: number; context_digest: string | null;
}
interface GoalExecutionRow {
    goal_id: string; execution_policy: AgentGoalExecution['policy']; required_successful_runs: number;
    successful_runs: number; cooldown_ms: number; next_eligible_at: string | null; last_run_id: string | null;
    parameter_source_kind: AgentGoalExecution['binding']['sourceKind']; parameter_source_id: string;
    parameters: string; parameter_digest: string; created_at: string; updated_at: string; revision: number;
}
interface SkillDispatchRow {
    run_id: string; decision_id: string; agent_id: string; goal_id: string; skill_id: string; skill_version: string;
    parameter_source_kind: AgentSkillDispatch['binding']['sourceKind']; parameter_source_id: string;
    parameters: string; parameter_digest: string; policy_id: string; policy_version: string; created_at: string;
}
interface SkillOutcomeRow {
    run_id: string; status: AgentSkillRunOutcome['status']; classification: AgentSkillRunOutcomeClassification;
    detail: string; occurred_at: string;
}
interface PlayerActionRequestRow {
    request_id: string; requester_agent_id: string; assignee_agent_id: string;
    skill_id: string; skill_version: string; parameters: string; objective: string; reward_gp: number;
    status: AgentPlayerActionStatus; response_note: string; requested_at: string; updated_at: string;
    accepted_at: string | null; approval_id: string | null; approval_expires_at: string | null;
    approved_at: string | null; started_at: string | null; run_id: string | null;
    settlement_id: string | null; settlement_started_at: string | null; settled_at: string | null;
    resolved_at: string | null; revision: number;
}
interface ConsolidationEvidenceRow {
    agent_id: string; rule_key: string; evidence_key: string; episode_id: string;
    occurred_at: string; created_at: string;
}
interface EpisodeRetentionRow extends EpisodeRow {
    semantic_ref: number; relationship_ref: number; commitment_ref: number; consolidation_ref: number;
}

function identity(row: IdentityRow): AgentIdentity {
    return { schemaVersion: AGENT_STATE_SCHEMA_VERSION, agentId: row.agent_id, playerUsername: row.player_username,
        displayName: row.display_name, background: row.background,
        personalityTraits: JSON.parse(row.personality_traits) as string[], values: JSON.parse(row.agent_values) as string[],
        createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision };
}
function characterLifecycle(row: CharacterLifecycleRow, atSimulationTime: string): AgentCharacterLifecycle {
    const currentAgeSimulationMilliseconds = characterAgeAt({ birthAtSimulationTime: row.birth_at_simulation_time,
        ageAtObservationMilliseconds: row.age_at_observation_ms,
        ageObservedAtSimulationTime: row.age_observed_at_simulation_time, status: row.status,
        statusChangedAtSimulationTime: row.status_changed_at_simulation_time }, atSimulationTime);
    return { agentId: row.agent_id, origin: row.origin,
        createdAtSimulationTime: row.created_at_simulation_time,
        birthAtSimulationTime: row.birth_at_simulation_time,
        ageAtObservationMilliseconds: row.age_at_observation_ms,
        ageObservedAtSimulationTime: row.age_observed_at_simulation_time,
        currentAgeSimulationMilliseconds, status: row.status,
        statusChangedAtSimulationTime: row.status_changed_at_simulation_time,
        createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision };
}
function populationMember(row:PopulationMemberRow,lifecycle:AgentCharacterLifecycle):AgentPopulationMember{
    return{agentId:row.agent_id,playerUsername:row.player_username,
        worldProfile:{profileId:row.world_profile_id,version:row.world_profile_version,digest:row.world_profile_digest},
        lifecyclePolicy:{policyId:row.lifecycle_policy_id,version:row.lifecycle_policy_version,
            digest:row.lifecycle_policy_digest,kind:row.lifecycle_policy_kind},
        simulationClock:{clockId:row.simulation_clock_id,profileDigest:row.simulation_clock_profile_digest},
        joinedAtSimulationTime:row.joined_at_simulation_time,sourceResultId:row.source_result_id,
        sourceResultDigest:row.source_result_digest,status:row.status,resetAtSimulationTime:row.reset_at_simulation_time,
        characterLifecycle:lifecycle,createdAt:row.created_at,updatedAt:row.updated_at,revision:row.revision};
}
const POPULATION_ID=/^[a-z0-9][a-z0-9._:-]{0,127}$/;const SEMVER=/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const SHA256=/^[0-9a-f]{64}$/;const POPULATION_RESULT=/^(genesis|entry)-[0-9a-f]{24}$/;
function populationKey(value:string,label:string,maximum=127):string{
    const normalized=value.trim().toLowerCase();
    if(normalized.length>maximum||!POPULATION_ID.test(normalized))throw new Error(`${label} is invalid`);
    return normalized;
}
function populationVersion(value:string,label:string):string{
    const normalized=value.trim();if(!SEMVER.test(normalized))throw new Error(`${label} is invalid`);return normalized;
}
function populationDigest(value:string,label:string):string{
    const normalized=value.trim().toLowerCase();if(!SHA256.test(normalized))throw new Error(`${label} is invalid`);return normalized;
}
function populationTimestamp(value:string,label:string):string{
    if(Number.isNaN(Date.parse(value))||new Date(value).toISOString()!==value)throw new Error(`${label} must be canonical UTC`);
    return value;
}
function goal(row: GoalRow): AgentGoal {
    return { goalId: row.goal_id, agentId: row.agent_id, parentGoalId: row.parent_goal_id, horizon: row.horizon,
        title: row.title, description: row.description, status: row.status, priority: row.priority,
        skill: row.skill_id && row.skill_version ? { id: row.skill_id, version: row.skill_version } : null,
        createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, revision: row.revision };
}
function goalExecution(row: GoalExecutionRow): AgentGoalExecution {
    return { goalId: row.goal_id, policy: row.execution_policy,
        completion: { kind: 'successful-skill-runs', required: row.required_successful_runs },
        progress: { successfulRuns: row.successful_runs }, cooldownMs: row.cooldown_ms,
        nextEligibleAt: row.next_eligible_at, lastRunId: row.last_run_id,
        binding: { sourceKind: row.parameter_source_kind, sourceId: row.parameter_source_id,
            parameters: JSON.parse(row.parameters) as Record<string, string | number | boolean>,
            digest: row.parameter_digest }, createdAt: row.created_at, updatedAt: row.updated_at,
        revision: row.revision };
}
function skillDispatch(row: SkillDispatchRow): AgentSkillDispatch {
    return { runId: row.run_id, decisionId: row.decision_id, agentId: row.agent_id, goalId: row.goal_id,
        skill: { id: row.skill_id, version: row.skill_version },
        binding: { sourceKind: row.parameter_source_kind, sourceId: row.parameter_source_id,
            parameters: JSON.parse(row.parameters) as Record<string, string | number | boolean>,
            digest: row.parameter_digest }, policyId: row.policy_id, policyVersion: row.policy_version,
        createdAt: row.created_at };
}
function skillOutcome(row: SkillOutcomeRow): AgentSkillRunOutcome {
    return { runId: row.run_id, status: row.status, classification: row.classification,
        detail: row.detail, occurredAt: row.occurred_at };
}
function goalEvent(row: GoalEventRow): AgentGoalEvent {
    const stampValues = [row.simulation_clock_id, row.simulation_sequence, row.simulation_time,
        row.simulation_binding_wall_time, row.simulation_profile_digest, row.simulation_clock_status,
        row.simulation_clock_revision, row.simulation_source_digest];
    const hasStamp = stampValues.some(value => value !== null);
    if (hasStamp && stampValues.some(value => value === null)) {
        throw new Error(`Agent goal event simulation stamp is incomplete for sequence ${row.sequence}`);
    }
    const simulationStamp: BoundSimulationEventStamp | null = hasStamp ? {
        clockId: row.simulation_clock_id!, domain: 'agent-goal-event',
        sourceId: `${row.agent_id}:${row.goal_id}:${row.revision}:${row.kind}`,
        sourceDigest: row.simulation_source_digest!, sequence: row.simulation_sequence!,
        simulationTime: row.simulation_time!, wallTime: row.simulation_binding_wall_time!,
        engineTick: row.simulation_engine_tick, profileDigest: row.simulation_profile_digest!,
        status: row.simulation_clock_status!, revision: row.simulation_clock_revision!
    } : null;
    return { sequence: row.sequence, goalId: row.goal_id, agentId: row.agent_id, kind: row.kind,
        previousStatus: row.previous_status, status: row.status, previousRevision: row.previous_revision,
        revision: row.revision,
        skill: row.skill_id && row.skill_version ? { id: row.skill_id, version: row.skill_version } : null,
        occurredAt: row.occurred_at, simulationStamp };
}
function goalProposal(row: GoalProposalRow): AgentGoalProposal {
    return { proposalId: row.proposal_id, runId: row.run_id, agentId: row.agent_id,
        anchorGoalId: row.anchor_goal_id, anchorGoalRevision: row.anchor_goal_revision,
        goals: JSON.parse(row.goals) as AgentGoalProposal['goals'],
        skill: row.skill_id && row.skill_version ? { id: row.skill_id, version: row.skill_version } : null,
        reason: row.reason, status: row.status, approvalId: row.approval_id,
        approvalExpiresAt: row.approval_expires_at, skillRunId: row.skill_run_id,
        responseNote: row.response_note, createdAt: row.created_at, updatedAt: row.updated_at,
        approvedAt: row.approved_at, startedAt: row.started_at, resolvedAt: row.resolved_at,
        revision: row.revision };
}
function skillKnowledge(row: SkillKnowledgeRow): AgentSkillKnowledge {
    return { agentId: row.agent_id, skill: { id: row.skill_id, version: row.skill_version }, status: row.status,
        learnedAt: row.learned_at, updatedAt: row.updated_at, revision: row.revision };
}
function workingMemory(row: WorkingMemoryRow): AgentWorkingMemory {
    return { agentId: row.agent_id, summary: row.summary, currentActivity: row.current_activity,
        location: row.location ? JSON.parse(row.location) as AgentWorkingMemory['location'] : null,
        observations: JSON.parse(row.observations) as string[], observedAt: row.observed_at,
        updatedAt: row.updated_at, revision: row.revision };
}
function episode(row: EpisodeRow): AgentEpisode {
    return { episodeId: row.episode_id, agentId: row.agent_id, kind: row.kind, summary: row.summary,
        details: row.details, importance: row.importance, goalIds: JSON.parse(row.goal_ids) as string[],
        actors: JSON.parse(row.actors) as string[], tags: JSON.parse(row.tags) as string[], source: row.source,
        trust: row.trust, externalKey: row.external_key, occurredAt: row.occurred_at,
        expiresAt: row.expires_at, createdAt: row.created_at };
}
function knowledge(row: KnowledgeRow): AgentKnowledge {
    return { knowledgeId: row.knowledge_id, agentId: row.agent_id, kind: row.kind, subject: row.subject,
        predicate: row.predicate, object: row.object, summary: row.summary, confidence: row.confidence,
        goalIds: JSON.parse(row.goal_ids) as string[], tags: JSON.parse(row.tags) as string[],
        evidenceEpisodeIds: JSON.parse(row.evidence_episode_ids) as string[], source: row.source, status: row.status,
        supersedesId: row.supersedes_id, externalKey: row.external_key, validFrom: row.valid_from,
        validUntil: row.valid_until, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision };
}
function relationship(row: RelationshipRow): AgentRelationship {
    return { agentId: row.agent_id, actorKey: row.actor_key, displayName: row.display_name, trust: row.trust,
        affinity: row.affinity, familiarity: row.familiarity, agentOwesGp: row.agent_owes_gp,
        actorOwesGp: row.actor_owes_gp, notes: row.notes, tags: JSON.parse(row.tags) as string[],
        evidenceEpisodeIds: JSON.parse(row.evidence_episode_ids) as string[],
        lastInteractionAt: row.last_interaction_at, createdAt: row.created_at, updatedAt: row.updated_at,
        revision: row.revision };
}
function commitment(row: CommitmentRow): AgentCommitment {
    return { commitmentId: row.commitment_id, agentId: row.agent_id, actorKey: row.actor_key,
        direction: row.direction, description: row.description, status: row.status, valueGp: row.value_gp,
        dueAt: row.due_at, evidenceEpisodeIds: JSON.parse(row.evidence_episode_ids) as string[],
        createdAt: row.created_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at, revision: row.revision };
}
function economicActorLink(row: EconomicActorLinkRow): AgentEconomicActorLink {
    return { agentId: row.agent_id, actorKind: row.actor_kind, actorId: row.actor_id, role: row.role,
        source: row.source, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision };
}
function controlProfile(row: ControlProfileRow): AgentControlProfile {
    return { agentId: row.agent_id, role: row.role, subjectKind: row.subject_kind, subjectId: row.subject_id,
        avatarPlayerUsername: row.avatar_player_username, decisionIntervalMs: row.decision_interval_ms,
        maxDecisionsPerDay: row.max_decisions_per_day, dailyLlmBudgetMicros: row.daily_llm_budget_micros,
        dailyOperationalBudgetGp: row.daily_operational_budget_gp, lastDecisionAt: row.last_decision_at,
        nextDecisionAt: row.next_decision_at, createdAt: row.created_at, updatedAt: row.updated_at,
        revision: row.revision };
}
function autonomyEnrollment(row: AutonomyEnrollmentRow): AgentAutonomyEnrollment {
    return { agentId: row.agent_id, status: row.status, policyId: row.policy_id,
        policyVersion: row.policy_version, nextWakeupAt: row.next_wakeup_at, leaseOwner: row.lease_owner,
        leaseExpiresAt: row.lease_expires_at, failureCount: row.failure_count,
        lastFailureFingerprint: row.last_failure_fingerprint, quarantineReason: row.quarantine_reason,
        createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision };
}
function autonomyControl(row: AutonomyControlRow): AgentAutonomyControl {
    return { emergencyStop: row.emergency_stop === 1, reason: row.reason,
        activatedAt: row.activated_at, updatedAt: row.updated_at, revision: row.revision };
}
function decisionRecord(row: DecisionRecordRow): AgentDecisionRecord {
    return { decisionId: row.decision_id, agentId: row.agent_id, trigger: row.trigger,
        llmCostMicros: row.llm_cost_micros, operationalBudgetGp: row.operational_budget_gp,
        occurredAt: row.occurred_at, profileRevision: row.profile_revision, contextDigest: row.context_digest };
}
function playerActionRequest(row: PlayerActionRequestRow): AgentPlayerActionRequest {
    return { requestId: row.request_id, requesterAgentId: row.requester_agent_id,
        assigneeAgentId: row.assignee_agent_id, skill: { id: row.skill_id, version: row.skill_version },
        parameters: JSON.parse(row.parameters) as AgentPlayerActionRequest['parameters'], objective: row.objective,
        rewardGp: row.reward_gp, status: row.status, responseNote: row.response_note,
        requestedAt: row.requested_at, updatedAt: row.updated_at, acceptedAt: row.accepted_at,
        approvalId: row.approval_id, approvalExpiresAt: row.approval_expires_at,
        approvedAt: row.approved_at, startedAt: row.started_at, runId: row.run_id,
        settlementId: row.settlement_id, settlementStartedAt: row.settlement_started_at,
        settledAt: row.settled_at,
        resolvedAt: row.resolved_at, revision: row.revision };
}
function consolidationEvidence(row: ConsolidationEvidenceRow): AgentConsolidationEvidence {
    return { agentId: row.agent_id, ruleKey: row.rule_key, evidenceKey: row.evidence_key,
        episodeId: row.episode_id, occurredAt: row.occurred_at, createdAt: row.created_at };
}

export class AgentStateStore {
    private readonly database: Database;
    private readonly ownedStatements = new Set<{ finalize(): void }>();

    constructor(path: string, private readonly simulationClock?: AgentStateSimulationClock, readonly readOnly = false) {
        if (!readOnly) mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, readOnly ? { readonly: true, strict: true } : { create: true, strict: true });
        // Cached statements must not retain a zombie SQLite connection after a short-lived admin read.
        this.database.query = new Proxy(this.database.query, { apply: (target, receiver, argumentsList) => {
            const statement = Reflect.apply(target, receiver, argumentsList);
            this.ownedStatements.add(statement);
            return statement;
        } });
        try {
            this.database.run('PRAGMA busy_timeout=5000');
            this.database.run('PRAGMA foreign_keys = ON');
            if (readOnly) {
                const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
                if (version !== AGENT_STATE_SCHEMA_VERSION) throw new Error('Read-only AgentState requires the current schema; migration is pending or unsupported');
            } else {
                this.database.run('PRAGMA journal_mode = WAL');
                this.migrate();
            }
            verifyMemoryHistory(this.database);
            verifyPopulationEntryHistory(this.database);
            if (simulationClock && !readOnly) this.backfillGoalEventSimulationStamps();
            if (simulationClock && !readOnly) this.backfillCharacterLifecycles();
        } catch (error) {
            this.close();
            throw error;
        }
    }

    listLivelihoodJournal(agentId: string): LivelihoodJournalEntry[] {
        if (!this.readOnly) installLivelihoodJournal(this.database);
        let entries!: LivelihoodJournalEntry[];
        this.database.transaction(() => { entries = readLivelihoodJournal(this.database, normalizeAgentId(agentId)); }).deferred();
        return entries;
    }

    /** Borrow the existing enrollment lease for a bilateral native operation, never another controller. */
    claimLivelihoodParticipant(actorId: string, peerId: string, actionId: string, now = new Date().toISOString()): void {
        this.database.transaction(() => {
            const actor = this.getAutonomyEnrollment(actorId), peer = this.getAutonomyEnrollment(peerId);
            const owner = `livelihood:${normalizeAgentId(actionId)}`;
            if (!actor || actor.status !== 'running' || !actor.leaseExpiresAt || actor.leaseExpiresAt <= now
                || actor.policyId !== 'society-livelihood' || actor.policyVersion !== '1.0.0' || actorId === peerId
                || this.getAutonomyControl().emergencyStop || !peer || peer.policyId !== actor.policyId || peer.policyVersion !== actor.policyVersion)
                throw new Error('Bilateral routine needs exact live enrollments');
            if (peer.status === 'running' && peer.leaseOwner === owner && peer.leaseExpiresAt && peer.leaseExpiresAt > now) return;
            if (peer.status !== 'desired') throw new Error('Routine participant is busy, paused or quarantined');
            if (peer.failureCount > 0 && peer.nextWakeupAt && peer.nextWakeupAt > now)
                throw new Error('Routine participant backoff has not expired');
            const due = this.setAutonomyEnrollment(peerId, peer.revision, { ...peer, nextWakeupAt: now }, now);
            this.claimAutonomyEnrollment(peerId, due.revision, owner, actor.leaseExpiresAt, now);
        }).immediate();
    }

    releaseLivelihoodParticipants(actionId: string, now = new Date().toISOString()): void {
        this.database.transaction(() => {
            for (const peer of this.listAutonomyEnrollments('running').filter(e => e.leaseOwner === `livelihood:${actionId}`))
                this.setAutonomyEnrollment(peer.agentId, peer.revision, { ...peer, status: 'desired', leaseOwner: null,
                    leaseExpiresAt: null, nextWakeupAt: new Date(Date.parse(now) + 30000).toISOString() }, now);
        }).immediate();
    }

    writeLivelihoodJournal(entry: LivelihoodJournalEntry, expectedRevision: number | null): LivelihoodJournalEntry {
        if (!this.getIdentity(entry.agentId)) throw new Error('Livelihood agent is unavailable');
        installLivelihoodJournal(this.database);
        return writeLivelihoodJournal(this.database, entry, expectedRevision);
    }

    close(): void {
        for (const statement of this.ownedStatements) statement.finalize();
        this.ownedStatements.clear();
        this.database.close(true);
    }

    readSnapshot<T>(read: () => T): T {
        if (!this.readOnly) throw new Error('Read snapshots require a read-only AgentState connection');
        let result!: T;
        this.database.transaction(() => { verifyMemoryHistory(this.database); verifyPopulationEntryHistory(this.database); result = read(); }).deferred();
        return result;
    }

    private bindGoalEventRow(row: GoalEventRow): void {
        if (!this.simulationClock || row.simulation_clock_id !== null) return;
        const clock = this.simulationClock.store.get(this.simulationClock.clockId);
        if (!clock) throw new Error(`Simulation clock ${this.simulationClock.clockId} does not exist`);
        const sourceId = `${row.agent_id}:${row.goal_id}:${row.revision}:${row.kind}`;
        const sourceDigest = createHash('sha256').update(JSON.stringify({ schemaVersion: 1,
            goalId: row.goal_id, agentId: row.agent_id, kind: row.kind,
            previousStatus: row.previous_status, status: row.status,
            previousRevision: row.previous_revision, revision: row.revision,
            skill: row.skill_id && row.skill_version ? { id: row.skill_id, version: row.skill_version } : null,
            occurredAt: row.occurred_at })).digest('hex');
        const wallTime = row.occurred_at < clock.lastObservedWallTime
            ? clock.lastObservedWallTime : row.occurred_at;
        const stamp = this.simulationClock.store.bindEventAtHead({ clockId: this.simulationClock.clockId,
            domain: 'agent-goal-event', sourceId, sourceDigest, wallTime,
            engineTick: this.simulationClock.engineTick?.() }).stamp;
        this.database.run(`UPDATE agent_goal_event SET simulation_clock_id=?2,
            simulation_sequence=?3,simulation_time=?4,simulation_binding_wall_time=?5,
            simulation_engine_tick=?6,simulation_profile_digest=?7,simulation_clock_status=?8,
            simulation_clock_revision=?9,simulation_source_digest=?10
            WHERE sequence=?1 AND simulation_clock_id IS NULL`, [row.sequence, stamp.clockId,
            stamp.sequence, stamp.simulationTime, stamp.wallTime, stamp.engineTick,
            stamp.profileDigest, stamp.status, stamp.revision, stamp.sourceDigest]);
    }

    private bindGoalEvent(goalId: string, revision: number, kind: AgentGoalEvent['kind']): void {
        if (!this.simulationClock) return;
        const row = this.database.query(`SELECT * FROM agent_goal_event
            WHERE goal_id=?1 AND revision=?2 AND kind=?3`).get(goalId, revision, kind) as GoalEventRow | null;
        if (!row) throw new Error('Persisted goal event could not be rebound to simulation time');
        this.bindGoalEventRow(row);
    }

    private backfillGoalEventSimulationStamps(): void {
        const table = this.database.query(`SELECT 1 AS found FROM sqlite_master
            WHERE type='table' AND name='agent_goal_event'`).get();
        if (!table) return;
        const rows = this.database.query(`SELECT * FROM agent_goal_event
            WHERE simulation_clock_id IS NULL ORDER BY occurred_at,sequence`).all() as GoalEventRow[];
        for (const row of rows) this.bindGoalEventRow(row);
    }

    private simulationTime(): string {
        if (!this.simulationClock) throw new Error('Character lifecycle requires the shared simulation clock');
        const clock = this.simulationClock.store.get(this.simulationClock.clockId);
        if (!clock) throw new Error(`Simulation clock ${this.simulationClock.clockId} does not exist`);
        return clock.lastSimulationTime;
    }

    private observeSimulationTime(wallTime: string): string {
        if (!this.simulationClock) throw new Error('Character lifecycle requires the shared simulation clock');
        return this.simulationClock.store.observeAtHead(this.simulationClock.clockId, wallTime,
            this.simulationClock.engineTick?.()).simulationTime;
    }

    private insertCharacterLifecycle(agentId: string, origin: AgentCharacterLifecycleOrigin,
        simulationTime: string, now: string): void {
        this.database.run(`INSERT OR IGNORE INTO agent_character_lifecycle
            (agent_id,origin,created_at_simulation_time,birth_at_simulation_time,
            age_at_observation_ms,age_observed_at_simulation_time,status,
            status_changed_at_simulation_time,created_at,updated_at,revision)
            VALUES(?1,?2,?3,NULL,0,?3,'active',?3,?4,?4,1)`,
        [agentId, origin, simulationTime, now]);
    }

    private backfillCharacterLifecycles(): void {
        const simulationTime = this.simulationTime();
        const rows = this.database.query(`SELECT i.agent_id,i.created_at FROM agent_identity i
            JOIN agent_control_profile p ON p.agent_id=i.agent_id
            LEFT JOIN agent_character_lifecycle l ON l.agent_id=i.agent_id
            WHERE p.role='player' AND l.agent_id IS NULL ORDER BY i.agent_id`)
            .all() as Array<{ agent_id: string; created_at: string }>;
        const transaction = this.database.transaction(() => {
            for (const row of rows) this.insertCharacterLifecycle(row.agent_id, 'imported', simulationTime, row.created_at);
        });
        transaction.immediate();
    }

    createIdentity(input: CreateAgentIdentity, now = new Date().toISOString()): AgentIdentity {
        const value = validateCreateIdentity(input);
        const profile = value.controlProfile ?? validateControlProfile({ role: 'player', subjectKind: 'player',
            subjectId: value.playerUsername!, avatarPlayerUsername: value.playerUsername,
            decisionIntervalMs: 300000, maxDecisionsPerDay: 96,
            dailyLlmBudgetMicros: 0, dailyOperationalBudgetGp: 0 });
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO agent_identity
                (agent_id, player_username, display_name, background, personality_traits, agent_values, created_at, updated_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 1)`,
            [value.agentId, value.playerUsername ?? null, value.displayName, value.background, JSON.stringify(value.personalityTraits),
                JSON.stringify(value.values ?? []), now]);
            if (profile.subjectKind === 'player' || profile.subjectKind === 'business'
                || profile.subjectKind === 'faction') {
                this.database.run(`INSERT INTO agent_economic_actor_link
                    (agent_id, actor_kind, actor_id, role, source, created_at, updated_at, revision)
                    VALUES (?1, ?2, ?3, 'self', 'identity', ?4, ?4, 1)`,
                [value.agentId, profile.subjectKind, profile.subjectId, now]);
            }
            this.database.run(`INSERT INTO agent_control_profile
                (agent_id, role, subject_kind, subject_id, avatar_player_username, decision_interval_ms,
                max_decisions_per_day, daily_llm_budget_micros, daily_operational_budget_gp,
                last_decision_at, next_decision_at, created_at, updated_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, ?10, ?10, 1)`,
            [value.agentId, profile.role, profile.subjectKind, profile.subjectId,
                profile.avatarPlayerUsername ?? null, profile.decisionIntervalMs, profile.maxDecisionsPerDay,
                profile.dailyLlmBudgetMicros, profile.dailyOperationalBudgetGp, now]);
            if (profile.role === 'player' && this.simulationClock) {
                this.insertCharacterLifecycle(value.agentId, 'created', this.simulationTime(), now);
            }
        });
        transaction.immediate();
        return this.requireIdentity(value.agentId);
    }

    updateIdentity(agentId: string, expectedRevision: number, patch: UpdateAgentIdentity,
        now = new Date().toISOString()): AgentIdentity {
        const current = this.requireIdentity(agentId);
        const value = validateIdentityPatch(patch);
        const next = { ...current, ...value };
        const transaction = this.database.transaction(() => {
            const member = this.getPopulationMember(current.agentId);
            if (member && next.playerUsername?.toLowerCase() !== member.playerUsername)
                throw new Error('Population avatar identity cannot be rebound');
            const result = this.database.run(`UPDATE agent_identity SET player_username = ?3, display_name = ?4,
                background = ?5, personality_traits = ?6, agent_values = ?7, updated_at = ?8, revision = revision + 1
                WHERE agent_id = ?1 AND revision = ?2`, [current.agentId, expectedRevision, next.playerUsername,
                next.displayName, next.background, JSON.stringify(next.personalityTraits), JSON.stringify(next.values), now]);
            if (result.changes !== 1) throw new Error('Agent identity changed before update; refresh and try again');
            if (next.playerUsername !== current.playerUsername) {
                if (!current.playerUsername || !next.playerUsername) {
                    throw new Error('A non-player identity cannot be rebound through the identity editor');
                }
                this.database.run(`UPDATE agent_economic_actor_link SET actor_id = ?2, updated_at = ?3,
                    revision = revision + 1 WHERE agent_id = ?1 AND source = 'identity' AND actor_kind = 'player'`,
                [current.agentId, normalizeEconomicActorId(next.playerUsername, 'playerUsername'), now]);
                this.database.run(`UPDATE agent_control_profile SET subject_id = ?2, avatar_player_username = ?3,
                    updated_at = ?4, revision = revision + 1
                    WHERE agent_id = ?1 AND role = 'player' AND subject_kind = 'player'`,
                [current.agentId, normalizeEconomicActorId(next.playerUsername, 'playerUsername'),
                    next.playerUsername, now]);
            }
        });
        transaction.immediate();
        return this.requireIdentity(current.agentId);
    }

    getIdentity(agentId: string): AgentIdentity | null {
        const normalized = normalizeAgentId(agentId);
        const row = this.database.query('SELECT * FROM agent_identity WHERE agent_id = ?1').get(normalized);
        return row ? identity(row as IdentityRow) : null;
    }

    listIdentities(): AgentIdentity[] {
        return (this.database.query('SELECT * FROM agent_identity ORDER BY agent_id').all() as IdentityRow[]).map(identity);
    }

    getCharacterLifecycle(agentId: string): AgentCharacterLifecycle | null {
        const normalized = normalizeAgentId(agentId);
        const row = this.database.query(`SELECT * FROM agent_character_lifecycle WHERE agent_id=?1`)
            .get(normalized) as CharacterLifecycleRow | null;
        return row ? characterLifecycle(row, this.simulationClock ? this.simulationTime()
            : row.age_observed_at_simulation_time) : null;
    }

    setCharacterBirth(agentId: string, expectedRevision: number, birthAtSimulationTime: string,
        origin: Extract<AgentCharacterLifecycleOrigin, 'born' | 'imported'> = 'born',
        now = new Date().toISOString()): AgentCharacterLifecycle {
        const normalized = normalizeAgentId(agentId), current = this.getCharacterLifecycle(normalized);
        if (!current) throw new Error('Character lifecycle is not initialized for this player agent');
        if (current.birthAtSimulationTime !== null) throw new Error('Character birth time is immutable once recorded');
        if (current.status !== 'active') throw new Error('Character birth registration requires an active lifecycle');
        if (origin !== 'born' && origin !== 'imported') throw new Error('Character birth origin is invalid');
        const birth = new Date(birthAtSimulationTime).toISOString();
        if (birth !== birthAtSimulationTime) throw new Error('Character birth time must be canonical UTC ISO');
        const observed = this.observeSimulationTime(now), age = Date.parse(observed) - Date.parse(birth);
        if (!Number.isSafeInteger(age) || age < 0) throw new Error('Character birth time cannot follow observation time');
        const result = this.database.run(`UPDATE agent_character_lifecycle SET origin=?3,
            birth_at_simulation_time=?4,age_at_observation_ms=?5,age_observed_at_simulation_time=?6,
            updated_at=?7,revision=revision+1 WHERE agent_id=?1 AND revision=?2
            AND birth_at_simulation_time IS NULL AND status='active'`,
        [normalized, expectedRevision, origin, birth, age, observed, now]);
        if (result.changes !== 1) throw new Error('Character lifecycle changed before birth registration');
        return this.getCharacterLifecycle(normalized)!;
    }

    observeCharacterAge(agentId: string, expectedRevision: number,
        now = new Date().toISOString()): AgentCharacterLifecycle {
        const normalized = normalizeAgentId(agentId), current = this.getCharacterLifecycle(normalized);
        if (!current) throw new Error('Character lifecycle is not initialized for this player agent');
        const observed = this.observeSimulationTime(now);
        const age = characterAgeAt(current, observed);
        const result = this.database.run(`UPDATE agent_character_lifecycle SET age_at_observation_ms=?3,
            age_observed_at_simulation_time=?4,updated_at=?5,revision=revision+1
            WHERE agent_id=?1 AND revision=?2`, [normalized, expectedRevision, age, observed, now]);
        if (result.changes !== 1) throw new Error('Character lifecycle changed before age observation');
        return this.getCharacterLifecycle(normalized)!;
    }

    getPopulationAge(agentId: string, policy: PopulationAgePolicy, now?: string): PopulationAgeObservation | null {
        const member = this.getPopulationMember(agentId);
        if (!member) return null;
        if (!this.simulationClock) throw new Error('Population age requires the shared simulation clock');
        const clock = this.simulationClock.store.get(this.simulationClock.clockId);
        if (!clock || member.simulationClock.clockId !== clock.clockId
            || member.simulationClock.profileDigest !== clock.profileDigest) {
            throw new Error('Population age requires the exact shared simulation clock');
        }
        const simulationTime = now === undefined ? clock.lastSimulationTime : this.observeSimulationTime(now);
        return evaluatePopulationAge(member, { clockId: clock.clockId, profileDigest: clock.profileDigest,
            simulationTime, wallTime: now ?? clock.lastObservedWallTime, engineTick: null,
            status: clock.status, revision: clock.revision }, policy);
    }

    getPopulationMortality(agentId: string, agePolicy: PopulationAgePolicy,
        mortalityPolicy: PopulationMortalityPolicy, now?: string): PopulationMortalityObservation | null {
        // Reuse the authoritative read/clock binding and optional wall-time observation.
        const age = this.getPopulationAge(agentId, agePolicy, now);
        if (!age) return null;
        const member = this.getPopulationMember(agentId)!;
        const clock = this.simulationClock!.store.get(this.simulationClock!.clockId)!;
        return evaluatePopulationMortality(member, { clockId: clock.clockId, profileDigest: clock.profileDigest,
            simulationTime: clock.lastSimulationTime, wallTime: clock.lastObservedWallTime, engineTick: null,
            status: clock.status, revision: clock.revision }, agePolicy, mortalityPolicy);
    }

    bindPopulationMember(input:BindAgentPopulationMember,now=new Date().toISOString()):AgentPopulationMember{
        if(!this.simulationClock)throw new Error('Population membership requires the shared simulation clock');
        const agentId=normalizeAgentId(input.agentId),identity=this.requireIdentity(agentId),profile=this.getControlProfile(agentId),
            lifecycle=this.getCharacterLifecycle(agentId);
        const playerUsername=input.playerUsername.trim().toLowerCase();
        if(!/^[a-z0-9]{1,12}$/.test(playerUsername)||identity.playerUsername?.toLowerCase()!==playerUsername
            ||profile?.role!=='player'||profile.subjectKind!=='player'||profile.subjectId.toLowerCase()!==playerUsername
            ||profile.avatarPlayerUsername?.toLowerCase()!==playerUsername)
            throw new Error('PopulationMember requires the exact player-controlled avatar identity');
        if(!lifecycle||lifecycle.status!=='active')throw new Error('PopulationMember requires an active character lifecycle');
        if(input.lifecyclePolicy.kind!=='finite')throw new Error('PopulationMember requires the finite lifecycle policy');
        const worldProfile={profileId:populationKey(input.worldProfile.profileId,'World profile id',63),
            version:populationVersion(input.worldProfile.version,'World profile version'),
            digest:populationDigest(input.worldProfile.digest,'World profile digest')};
        const lifecyclePolicy={policyId:populationKey(input.lifecyclePolicy.policyId,'Lifecycle policy id',63),
            version:populationVersion(input.lifecyclePolicy.version,'Lifecycle policy version'),
            digest:populationDigest(input.lifecyclePolicy.digest,'Lifecycle policy digest'),kind:'finite' as const};
        const simulationClock={clockId:populationKey(input.simulationClock.clockId,'Simulation clock id',63),
            profileDigest:populationDigest(input.simulationClock.profileDigest,'Simulation clock profile digest')};
        const joinedAtSimulationTime=populationTimestamp(input.joinedAtSimulationTime,'Population join time');
        const sourceResultId=input.sourceResultId.trim().toLowerCase(),sourceResultDigest=populationDigest(input.sourceResultDigest,
            'Population source result digest');
        if(!POPULATION_RESULT.test(sourceResultId))throw new Error('Population source result id is invalid');
        if(sourceResultId.startsWith('entry-')){
            const receipt=readPopulationEntry(this.database,sourceResultId),plan=receipt?.plan;
            if(!plan||plan.digest!==sourceResultDigest||!plan.entrants.some(item=>item.identity.agentId===agentId
                &&item.identity.playerUsername===playerUsername)||JSON.stringify(plan.worldProfile)!==JSON.stringify(worldProfile)
                ||JSON.stringify(plan.lifecyclePolicy)!==JSON.stringify(lifecyclePolicy)
                ||JSON.stringify(plan.simulationClock)!==JSON.stringify(simulationClock)||plan.joinedAtSimulationTime!==joinedAtSimulationTime)
                throw new Error('Population entry requires its exact persisted admission receipt');
        }
        const clock=this.simulationClock.store.get(this.simulationClock.clockId);
        if(!clock||simulationClock.clockId!==this.simulationClock.clockId||simulationClock.profileDigest!==clock.profileDigest)
            throw new Error('Population membership simulation clock binding is invalid');
        if(joinedAtSimulationTime<lifecycle.createdAtSimulationTime||joinedAtSimulationTime>clock.lastSimulationTime)
            throw new Error('Population join time is outside the character lifecycle');
        const expected={agentId,playerUsername,worldProfile,lifecyclePolicy,simulationClock,joinedAtSimulationTime,
            sourceResultId,sourceResultDigest};
        const existing=this.getPopulationMember(agentId);
        if(existing){
            const actual={agentId:existing.agentId,playerUsername:existing.playerUsername,worldProfile:existing.worldProfile,
                lifecyclePolicy:existing.lifecyclePolicy,simulationClock:existing.simulationClock,
                joinedAtSimulationTime:existing.joinedAtSimulationTime,sourceResultId:existing.sourceResultId,
                sourceResultDigest:existing.sourceResultDigest};
            if(existing.status==='active'&&JSON.stringify(actual)===JSON.stringify(expected))return existing;
            throw new Error('Agent already has a different or reset population membership');
        }
        this.database.run(`INSERT INTO agent_population_member
            (agent_id,player_username,world_profile_id,world_profile_version,world_profile_digest,
            lifecycle_policy_id,lifecycle_policy_version,lifecycle_policy_digest,lifecycle_policy_kind,
            simulation_clock_id,simulation_clock_profile_digest,joined_at_simulation_time,
            source_result_id,source_result_digest,status,reset_at_simulation_time,created_at,updated_at,revision)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'finite',?9,?10,?11,?12,?13,'active',NULL,?14,?14,1)`,
        [agentId,playerUsername,worldProfile.profileId,worldProfile.version,worldProfile.digest,lifecyclePolicy.policyId,
            lifecyclePolicy.version,lifecyclePolicy.digest,simulationClock.clockId,simulationClock.profileDigest,
            joinedAtSimulationTime,sourceResultId,sourceResultDigest,now]);
        return this.getPopulationMember(agentId)!;
    }

    getPopulationEntry(entryId: string): PopulationEntryReceipt | null {
        return readPopulationEntry(this.database, entryId);
    }

    previewPopulationEntry(raw: unknown, environment: PopulationEntryEnvironment): PopulationEntryPlan {
        const request = validatePopulationEntryRequest(raw);
        if (!this.simulationClock) throw new Error('Population entry requires the shared simulation clock');
        const clock = this.simulationClock.store.get(this.simulationClock.clockId);
        if (!clock) throw new Error('Population entry clock is unavailable');
        const binding = { clockId: clock.clockId, profileDigest: clock.profileDigest };
        const prior = this.getPopulationEntry(populationEntryId(request, binding));
        if (prior) {
            if (JSON.stringify(prior.plan.request) !== JSON.stringify(request)) throw new Error('Population entry batch conflicts with its recorded request');
            return prior.plan; // Historical receipt; never reactivate dead/reset members on replay.
        }
        if (clock.status !== 'paused') throw new Error('New population entry requires a paused simulation clock');
        const anchor = this.getPopulationMember(request.anchorAgentId);
        if (!anchor || JSON.stringify(anchor.simulationClock) !== JSON.stringify(binding)) throw new Error('Population entry genesis clock binding is invalid');
        const plan = generatePopulationEntry(request, anchor, clock.lastSimulationTime, environment);
        const members = this.listPopulationMembers().filter(item => item.simulationClock.clockId === clock.clockId
            && item.simulationClock.profileDigest === clock.profileDigest);
        const active = members.filter(item => item.status === 'active');
        // A shared world clock cannot silently combine two genesis populations.
        for (const member of active) {
            const source = member.sourceResultId.startsWith('entry-') ? this.getPopulationEntry(member.sourceResultId)?.plan.genesis
                : { resultId: member.sourceResultId, resultDigest: member.sourceResultDigest };
            if (JSON.stringify(member.worldProfile) !== JSON.stringify(plan.worldProfile)
                || JSON.stringify(source) !== JSON.stringify(plan.genesis)) throw new Error('Population entry world contains conflicting genesis bindings');
        }
        const profile = environment.profiles.profiles.find(item => item.profileId === plan.worldProfile.profileId)!;
        const alive = active.filter(item => item.characterLifecycle.status === 'active').length;
        if (alive + request.count > Math.min(profile.population.maximumAgents, plan.policy.maximumActiveMembers))
            throw new Error('Population entry active member limit exceeded');
        const admitted = this.database.query(`SELECT COALESCE(SUM(entrant_count),0) AS count FROM agent_population_entry
            WHERE clock_id=?1 AND clock_profile_digest=?2`).get(clock.clockId, clock.profileDigest) as { count: number };
        if (admitted.count + request.count > plan.policy.maximumAdmissionsPerClock) throw new Error('Population entry lifetime clock quota exceeded');
        for (const { identity } of plan.entrants) {
            const conflict = this.database.query(`SELECT agent_id FROM agent_identity WHERE agent_id=?1 OR LOWER(player_username)=?2
                UNION SELECT agent_id FROM agent_control_profile WHERE LOWER(avatar_player_username)=?2 OR (subject_kind='player' AND LOWER(subject_id)=?2)
                UNION SELECT agent_id FROM agent_population_member WHERE player_username=?2`).get(identity.agentId, identity.playerUsername!);
            if (conflict) throw new Error('Population entry identity or avatar is already reserved');
        }
        return plan;
    }

    /** Identity, birth, finite membership and audit receipt share one AgentState commit. */
    applyPopulationEntry(raw: unknown, environment: PopulationEntryEnvironment, expectedPlanDigest: string, reason: string,
        assertUnusedAvatar: (username: string) => void, now = new Date().toISOString()): PopulationEntryReceipt {
        if (!SHA256.test(expectedPlanDigest) || typeof reason !== 'string' || !reason.trim() || reason.length > 1000
            || new Date(now).toISOString() !== now) throw new Error('Population entry approval digest, reason or audit time is invalid');
        let result!: PopulationEntryReceipt;
        this.database.transaction(() => {
            const plan = this.previewPopulationEntry(raw, environment);
            if (plan.digest !== expectedPlanDigest) throw new Error('Population entry preview changed; refresh before apply');
            const prior = this.getPopulationEntry(plan.entryId);
            if (prior) { result = prior; return; }
            for (const item of plan.entrants) assertUnusedAvatar(item.identity.playerUsername!);
            const body = { plan, reason: reason.trim(), appliedAt: now };
            const receipt: PopulationEntryReceipt = { ...body, digest: populationEntryDigest(body) };
            this.database.run(`INSERT INTO agent_population_entry VALUES(?1,?2,?3,?4,?5,?6)`,
                [plan.entryId, plan.simulationClock.clockId, plan.simulationClock.profileDigest,
                    plan.entrants.length, JSON.stringify(receipt), receipt.digest]);
            for (const item of plan.entrants) {
                this.createIdentity(item.identity, now);
                // This is a generated adult arrival, not a reproduction/birth event or a legacy backfill.
                this.database.run(`UPDATE agent_character_lifecycle SET origin='imported',created_at_simulation_time=?2,
                    birth_at_simulation_time=?3,age_at_observation_ms=?4,age_observed_at_simulation_time=?2,
                    status_changed_at_simulation_time=?2 WHERE agent_id=?1`, [item.identity.agentId, plan.joinedAtSimulationTime,
                    item.birthAtSimulationTime, Date.parse(plan.joinedAtSimulationTime) - Date.parse(item.birthAtSimulationTime)]);
                this.bindPopulationMember({ agentId: item.identity.agentId, playerUsername: item.identity.playerUsername!,
                    worldProfile: plan.worldProfile, lifecyclePolicy: plan.lifecyclePolicy, simulationClock: plan.simulationClock,
                    joinedAtSimulationTime: plan.joinedAtSimulationTime, sourceResultId: plan.entryId, sourceResultDigest: plan.digest }, now);
            }
            const clock = this.simulationClock!.store.get(this.simulationClock!.clockId)!;
            if (clock.status !== 'paused' || clock.lastSimulationTime !== plan.joinedAtSimulationTime
                || clock.profileDigest !== plan.simulationClock.profileDigest) throw new Error('Population entry clock changed during admission');
            result = receipt;
        }).immediate();
        return result;
    }

    getPopulationMember(agentId:string):AgentPopulationMember|null{
        const normalized=normalizeAgentId(agentId),row=this.database.query('SELECT * FROM agent_population_member WHERE agent_id=?1')
            .get(normalized) as PopulationMemberRow|null;if(!row)return null;
        const lifecycle=this.getCharacterLifecycle(normalized);if(!lifecycle)throw new Error('PopulationMember lifecycle source is missing');
        return populationMember(row,lifecycle);
    }

    getPopulationDeath(agentId: string): PopulationDeathRecord | null {
        const query = this.database.prepare('SELECT event_json,event_digest FROM agent_population_death WHERE agent_id=?1');
        let row: { event_json: string; event_digest: string } | null;
        try { row = query.get(normalizeAgentId(agentId)) as { event_json: string; event_digest: string } | null; }
        finally { query.finalize(); }
        if (!row) return null;
        const record = JSON.parse(row.event_json) as PopulationDeathRecord;
        const { sequence: _sequence, eventDigest: _digest, ...event } = record;
        validatePopulationDeathEvidence(event);
        if (record.agentId !== normalizeAgentId(agentId) || healthDigest(record) !== row.event_digest
            || healthDigest(event) !== record.eventDigest)
            throw new Error('Population death history was altered');
        return record;
    }

    /** Only a verified read-only engine journal entry can terminate a character. */
    consumePopulationDeath(source: PlayerHealthEvidenceStore, eventId: string, agePolicy: PopulationAgePolicy,
        mortalityPolicy: PopulationMortalityPolicy): PopulationDeathRecord {
        if (!(source instanceof PlayerHealthEvidenceStore) || !source.readOnly || source.schemaVersion < 2)
            throw new Error('Population death requires the read-only engine authority');
        const record = source.listDeaths().find(event => event.eventId === eventId);
        if (!record) throw new Error('Authoritative population death is missing');
        this.database.transaction(() => {
            const existing = this.getPopulationDeath(record.agentId);
            if (existing) {
                if (existing.eventDigest !== record.eventDigest) throw new Error('Population death replay conflicts');
                const lifecycle = this.getCharacterLifecycle(record.agentId);
                if (lifecycle?.status !== 'deceased' || lifecycle.statusChangedAtSimulationTime !== record.atSimulationTime)
                    throw new Error('Terminal character lifecycle was altered');
                archivePopulationMemory(this.database,record,new Date().toISOString(),'late-reconciliation');
                return;
            }
            const member = this.getPopulationMember(record.agentId);
            if (!member || member.status !== 'active' || member.characterLifecycle.status !== 'active'
                || member.revision !== record.memberRevision || member.characterLifecycle.revision !== record.lifecycleRevision
                || populationDeathMembershipDigest(member) !== record.membershipDigest) throw new Error('Population death membership changed');
            if (!this.simulationClock) throw new Error('Death requires the shared simulation clock');
            const clock = this.simulationClock.store.get(this.simulationClock.clockId);
            if (!clock || clock.clockId !== record.clock.clockId || clock.profileDigest !== record.clock.profileDigest
                || clock.lastSimulationTime < record.clock.simulationTime || record.recordedAt < member.createdAt)
                throw new Error('Population death clock/source binding is invalid');
            const expected = record.cause.kind === 'starvation'
                ? createStarvationDeathEvidence(member, record.clock, agePolicy, record.cause, record.atSimulationTime)
                : createPopulationDeathEvidence(member, record.clock, agePolicy, mortalityPolicy,
                record.cause.kind === 'engine-hp-zero' ? { damageEventId: record.cause.damageEventId,
                    sessionId: record.cause.sessionId, engineTick: record.cause.engineTick } : undefined);
            const { sequence: _sequence, eventDigest: _digest, ...event } = record;
            if (healthDigest(expected) !== healthDigest(event)) throw new Error('Population death evidence conflicts with its policy');
            const age = characterAgeAt(member.characterLifecycle, record.atSimulationTime);
            this.database.run(`INSERT INTO agent_population_death(agent_id,event_id,event_json,event_digest)
                VALUES(?1,?2,?3,?4)`, [member.agentId,record.eventId,JSON.stringify(record),healthDigest(record)]);
            const changed = this.database.run(`UPDATE agent_character_lifecycle SET status='deceased',
                status_changed_at_simulation_time=?3,age_at_observation_ms=?4,age_observed_at_simulation_time=?3,
                updated_at=?5,revision=revision+1 WHERE agent_id=?1 AND revision=?2 AND status='active'`,
                [member.agentId,record.lifecycleRevision,record.atSimulationTime,age,record.recordedAt]);
            if (changed.changes !== 1) throw new Error('Population death lifecycle revision conflict');
            this.database.run(`UPDATE agent_autonomy_enrollment SET status='paused',lease_owner=NULL,lease_expires_at=NULL,
                next_wakeup_at=NULL,updated_at=?2,revision=revision+1 WHERE agent_id=?1`, [member.agentId,record.recordedAt]);
            archivePopulationMemory(this.database,record,new Date().toISOString(),'death-admission');
        }).immediate();
        return record;
    }

    assertCharacterCanAct(agentId: string): void {
        const member = this.getPopulationMember(agentId), lifecycle = this.getCharacterLifecycle(agentId);
        if (lifecycle?.status === 'deceased' || member?.status === 'reset') throw new Error('Character lifecycle is closed to physical actions');
    }

    getPopulationMemoryArchive(agentId: string) { return readPopulationMemoryArchive(this.database,normalizeAgentId(agentId)); }

    ensurePopulationMemoryArchive(source:PlayerHealthEvidenceStore,agentId:string) {
        if (!(source instanceof PlayerHealthEvidenceStore) || !source.readOnly || source.schemaVersion<2) throw new Error('Memory archive requires read-only engine death authority');
        this.database.transaction(()=>{
            const death=this.getPopulationDeath(agentId), proof=source.listDeaths().find(row=>row.agentId===agentId);
            if (!death || !proof || healthDigest(death)!==healthDigest(proof) || this.getCharacterLifecycle(agentId)?.status!=='deceased')
                throw new Error('Memory archive requires exact verified death');
            archivePopulationMemory(this.database,death,new Date().toISOString(),'late-reconciliation');
        }).immediate();
        return this.getPopulationMemoryArchive(agentId)!;
    }

    private withArchivedMemoryAuthority<T>(enginePath:string,agentId:string,run:(source:PlayerHealthEvidenceStore)=>T):T {
        if(!existsSync(enginePath))throw new Error('Memory transfer engine authority unavailable');
        let result!:T;
        this.database.transaction(()=>{
            const writer=new Database(enginePath,{strict:true});
            try {writer.transaction(()=>{
                const source=new PlayerHealthEvidenceStore(enginePath,true);
                try {this.ensurePopulationMemoryArchive(source,agentId);result=run(source);}finally{source.close();}
            }).immediate();}finally{writer.close(true);}
        }).immediate();
        return result;
    }

    previewArchivedKnowledge(enginePath:string,policy:MemoryTransferPolicy,input:MemoryTransferSelection,now=new Date().toISOString()) {
        return this.withArchivedMemoryAuthority(enginePath,input.sourceAgentId,source=>previewMemoryTransfer(this.database,policy,input,
            new Set(source.listDeaths().map(death=>death.playerUsername)),now));
    }

    transferArchivedKnowledge(enginePath:string,policy:MemoryTransferPolicy,input:MemoryTransferRequest,now=new Date().toISOString()) {
        return this.withArchivedMemoryAuthority(enginePath,input.sourceAgentId,source=>executeMemoryTransfer(this.database,policy,input,
            new Set(source.listDeaths().map(death=>death.playerUsername)),now,(agentId,episode,knowledge)=>{
                this.createEpisode(agentId,episode,now);this.createKnowledge(agentId,knowledge,now);
            }));
    }

    listPopulationMembers(status?:AgentPopulationMembershipStatus):AgentPopulationMember[]{
        if(status!==undefined&&status!=='active'&&status!=='reset')throw new Error('Population membership status is invalid');
        const rows=(status===undefined?this.database.query('SELECT * FROM agent_population_member ORDER BY agent_id').all()
            :this.database.query('SELECT * FROM agent_population_member WHERE status=?1 ORDER BY agent_id').all(status)) as PopulationMemberRow[];
        return rows.map(row=>{const lifecycle=this.getCharacterLifecycle(row.agent_id);
            if(!lifecycle)throw new Error('PopulationMember lifecycle source is missing');return populationMember(row,lifecycle)});
    }

    resetPopulationMember(agentId:string,sourceResultDigest:string,expectedRevision:number,
        now=new Date().toISOString()):AgentPopulationMember{
        if(!this.simulationClock)throw new Error('Population membership requires the shared simulation clock');
        const normalized=normalizeAgentId(agentId),digest=populationDigest(sourceResultDigest,'Population source result digest'),
            current=this.getPopulationMember(normalized);
        if(!current||current.sourceResultDigest!==digest)throw new Error('Exact genesis PopulationMember binding is missing');
        if(current.status==='reset')return current;
        const resetAtSimulationTime=this.simulationTime();
        const result=this.database.run(`UPDATE agent_population_member SET status='reset',reset_at_simulation_time=?4,
            updated_at=?5,revision=revision+1 WHERE agent_id=?1 AND source_result_digest=?2 AND revision=?3 AND status='active'`,
        [normalized,digest,expectedRevision,resetAtSimulationTime,now]);
        if(result.changes!==1)throw new Error('Population membership changed before reset');
        return this.getPopulationMember(normalized)!;
    }

    /** Closes descendants admitted after the original genesis rollback token was captured. */
    resetPopulationGenesisMembers(resultId: string, resultDigest: string, originalAgentIds: string[],
        now = new Date().toISOString()): AgentPopulationMember[] {
        if (!/^genesis-[0-9a-f]{24}$/.test(resultId) || !SHA256.test(resultDigest)) throw new Error('Population genesis reset source is invalid');
        const reset: AgentPopulationMember[] = [];
        this.database.transaction(() => {
            const targets = new Map<string, AgentPopulationMember>();
            for (const id of originalAgentIds) {
                const member = this.getPopulationMember(id);
                if (!member) continue;
                if (member.sourceResultId !== resultId || member.sourceResultDigest !== resultDigest)
                    throw new Error(`PopulationMember changed before reset: ${id}`);
                targets.set(id, member);
            }
            for (const member of this.listPopulationMembers()) {
                if (!member.sourceResultId.startsWith('entry-')) continue;
                const genesis = this.getPopulationEntry(member.sourceResultId)?.plan.genesis;
                if (!genesis) throw new Error('Population entry reset receipt is unavailable');
                if (genesis.resultId === resultId && genesis.resultDigest === resultDigest) targets.set(member.agentId, member);
            }
            for (const member of targets.values()) reset.push(this.resetPopulationMember(member.agentId,
                member.sourceResultDigest, member.revision, now));
        }).immediate();
        return reset;
    }

    getControlProfile(agentId: string): AgentControlProfile | null {
        const normalized = normalizeAgentId(agentId);
        const row = this.database.query('SELECT * FROM agent_control_profile WHERE agent_id = ?1').get(normalized);
        return row ? controlProfile(row as ControlProfileRow) : null;
    }

    getAutonomyEnrollment(agentId: string): AgentAutonomyEnrollment | null {
        const normalized = normalizeAgentId(agentId);
        const row = this.database.query('SELECT * FROM agent_autonomy_enrollment WHERE agent_id = ?1')
            .get(normalized);
        return row ? autonomyEnrollment(row as AutonomyEnrollmentRow) : null;
    }

    listAutonomyEnrollments(status?: AgentAutonomyStatus): AgentAutonomyEnrollment[] {
        if (status !== undefined && !['desired', 'running', 'paused', 'quarantined'].includes(status)) {
            throw new Error('Autonomy enrollment status is invalid');
        }
        const rows = status === undefined
            ? this.database.query(`SELECT * FROM agent_autonomy_enrollment
                ORDER BY COALESCE(next_wakeup_at, '9999-12-31T23:59:59.999Z'), agent_id`).all()
            : this.database.query(`SELECT * FROM agent_autonomy_enrollment WHERE status = ?1
                ORDER BY COALESCE(next_wakeup_at, '9999-12-31T23:59:59.999Z'), agent_id`).all(status);
        return (rows as AutonomyEnrollmentRow[]).map(autonomyEnrollment);
    }

    getAutonomyControl(): AgentAutonomyControl {
        const row = this.database.query(`SELECT emergency_stop, reason, activated_at, updated_at, revision
            FROM agent_autonomy_control WHERE control_key = 'global'`).get() as AutonomyControlRow | null;
        if (!row) throw new Error('Global autonomy control is missing');
        return autonomyControl(row);
    }

    setAutonomyEmergencyStop(expectedRevision: number, active: boolean, reason: string,
        now = new Date().toISOString()): AgentAutonomyControl {
        const current = this.getAutonomyControl();
        const normalizedReason = reason.trim();
        if (!normalizedReason) throw new Error('Autonomy emergency-stop reason is required');
        if (Number.isNaN(Date.parse(now))) throw new Error('Autonomy control time must be an ISO timestamp');
        if (current.emergencyStop === active) return current;
        const result = this.database.run(`UPDATE agent_autonomy_control SET emergency_stop = ?2,
            reason = ?3, activated_at = ?4, updated_at = ?5, revision = revision + 1
            WHERE control_key = 'global' AND revision = ?1`,
        [expectedRevision, active ? 1 : 0, active ? normalizedReason : null, active ? now : null, now]);
        if (result.changes !== 1) throw new Error('Global autonomy control changed before update; refresh and try again');
        return this.getAutonomyControl();
    }

    pauseAutonomyEnrollment(agentId: string, expectedRevision: number,
        now = new Date().toISOString()): AgentAutonomyEnrollment {
        const current = this.getAutonomyEnrollment(agentId);
        if (!current) throw new Error(`Agent autonomy is not enrolled: ${normalizeAgentId(agentId)}`);
        if (current.status === 'paused') return current;
        return this.setAutonomyEnrollment(agentId, expectedRevision, { ...current, status: 'paused',
            nextWakeupAt: null, leaseOwner: null, leaseExpiresAt: null, quarantineReason: null }, now);
    }

    resumeAutonomyEnrollment(agentId: string, expectedRevision: number,
        now = new Date().toISOString()): AgentAutonomyEnrollment {
        const current = this.getAutonomyEnrollment(agentId);
        if (!current) throw new Error(`Agent autonomy is not enrolled: ${normalizeAgentId(agentId)}`);
        if (current.status === 'desired') return current;
        if (current.status !== 'paused') throw new Error('Only a paused autonomy enrollment can be resumed');
        return this.setAutonomyEnrollment(agentId, expectedRevision, { ...current, status: 'desired',
            nextWakeupAt: now, leaseOwner: null, leaseExpiresAt: null, quarantineReason: null }, now);
    }

    releaseAutonomyQuarantine(agentId: string, expectedRevision: number,
        now = new Date().toISOString()): AgentAutonomyEnrollment {
        const current = this.getAutonomyEnrollment(agentId);
        if (!current) throw new Error(`Agent autonomy is not enrolled: ${normalizeAgentId(agentId)}`);
        if (current.status === 'paused') return current;
        if (current.status !== 'quarantined') throw new Error('Only a quarantined autonomy enrollment can be released');
        return this.setAutonomyEnrollment(agentId, expectedRevision, { ...current, status: 'paused',
            nextWakeupAt: null, leaseOwner: null, leaseExpiresAt: null, failureCount: 0,
            lastFailureFingerprint: null, quarantineReason: null }, now);
    }

    createAutonomyEnrollment(agentId: string, input: SetAgentAutonomyEnrollment,
        now = new Date().toISOString()): AgentAutonomyEnrollment {
        const normalized = normalizeAgentId(agentId);
        const value = validateAutonomyEnrollment(input);
        if (value.status === 'desired') this.assertCharacterCanAct(normalized);
        if (value.status === 'running') throw new Error('Use claimAutonomyEnrollment to enter running state');
        const nowTime = Date.parse(now);
        if (Number.isNaN(nowTime)) throw new Error('Autonomy enrollment time must be an ISO timestamp');
        if (value.leaseExpiresAt && Date.parse(value.leaseExpiresAt) <= nowTime) {
            throw new Error('Autonomy lease must expire after the enrollment time');
        }
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalized);
            if (this.getAutonomyEnrollment(normalized)) throw new Error(`Agent autonomy is already enrolled: ${normalized}`);
            this.database.run(`INSERT INTO agent_autonomy_enrollment
                (agent_id, status, policy_id, policy_version, next_wakeup_at, lease_owner, lease_expires_at,
                failure_count, last_failure_fingerprint, quarantine_reason, created_at, updated_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, 1)`,
            [normalized, value.status, value.policyId, value.policyVersion, value.nextWakeupAt ?? null,
                value.leaseOwner ?? null, value.leaseExpiresAt ?? null, value.failureCount ?? 0,
                value.lastFailureFingerprint ?? null, value.quarantineReason ?? null, now]);
        });
        transaction.immediate();
        return this.getAutonomyEnrollment(normalized)!;
    }

    setAutonomyEnrollment(agentId: string, expectedRevision: number, input: SetAgentAutonomyEnrollment,
        now = new Date().toISOString()): AgentAutonomyEnrollment {
        const normalized = normalizeAgentId(agentId);
        const value = validateAutonomyEnrollment(input);
        if (value.status === 'desired') this.assertCharacterCanAct(normalized);
        if (value.status === 'running') throw new Error('Use claimAutonomyEnrollment to enter running state');
        const nowTime = Date.parse(now);
        if (Number.isNaN(nowTime)) throw new Error('Autonomy enrollment time must be an ISO timestamp');
        if (value.leaseExpiresAt && Date.parse(value.leaseExpiresAt) <= nowTime) {
            throw new Error('Autonomy lease must expire after the update time');
        }
        const result = this.database.run(`UPDATE agent_autonomy_enrollment SET status = ?3,
            policy_id = ?4, policy_version = ?5, next_wakeup_at = ?6, lease_owner = ?7,
            lease_expires_at = ?8, failure_count = ?9, last_failure_fingerprint = ?10,
            quarantine_reason = ?11, updated_at = ?12, revision = revision + 1
            WHERE agent_id = ?1 AND revision = ?2`,
        [normalized, expectedRevision, value.status, value.policyId, value.policyVersion,
            value.nextWakeupAt ?? null, value.leaseOwner ?? null, value.leaseExpiresAt ?? null,
            value.failureCount ?? 0, value.lastFailureFingerprint ?? null, value.quarantineReason ?? null, now]);
        if (result.changes !== 1) throw new Error('Agent autonomy enrollment changed before update; refresh and try again');
        return this.getAutonomyEnrollment(normalized)!;
    }

    claimAutonomyEnrollment(agentId: string, expectedRevision: number, leaseOwner: string,
        leaseExpiresAt: string, now = new Date().toISOString()): AgentAutonomyEnrollment {
        const normalized = normalizeAgentId(agentId);
        const current = this.getAutonomyEnrollment(normalized);
        if (!current || current.revision !== expectedRevision || current.status !== 'desired') {
            throw new Error('Agent autonomy enrollment is not claimable; refresh and try again');
        }
        const value = validateAutonomyEnrollment({ ...current, status: 'running', leaseOwner, leaseExpiresAt });
        const nowTime = Date.parse(now);
        if (Number.isNaN(nowTime)) throw new Error('Autonomy claim time must be an ISO timestamp');
        if (current.nextWakeupAt && Date.parse(current.nextWakeupAt) > nowTime) {
            throw new Error('Agent autonomy enrollment is not due yet');
        }
        if (Date.parse(leaseExpiresAt) <= nowTime) throw new Error('Autonomy lease must expire after the claim time');
        const result = this.database.run(`UPDATE agent_autonomy_enrollment SET status = 'running',
            next_wakeup_at = NULL, lease_owner = ?3, lease_expires_at = ?4, updated_at = ?5,
            revision = revision + 1 WHERE agent_id = ?1 AND revision = ?2 AND status = 'desired'
            AND (next_wakeup_at IS NULL OR next_wakeup_at <= ?5)`,
        [normalized, expectedRevision, value.leaseOwner!, value.leaseExpiresAt!, now]);
        if (result.changes !== 1) throw new Error('Agent autonomy enrollment was claimed concurrently');
        return this.getAutonomyEnrollment(normalized)!;
    }

    renewAutonomyLease(agentId: string, expectedRevision: number, leaseOwner: string,
        leaseExpiresAt: string, now = new Date().toISOString()): AgentAutonomyEnrollment {
        const normalized = normalizeAgentId(agentId);
        const current = this.getAutonomyEnrollment(normalized);
        if (!current || current.revision !== expectedRevision || current.status !== 'running'
            || current.leaseOwner !== leaseOwner) {
            throw new Error('Agent autonomy lease ownership changed; refresh and reconcile');
        }
        const value = validateAutonomyEnrollment({ ...current, leaseExpiresAt });
        const nowTime = Date.parse(now);
        if (Number.isNaN(nowTime) || Date.parse(leaseExpiresAt) <= nowTime) {
            throw new Error('Autonomy lease renewal must expire after the update time');
        }
        const result = this.database.run(`UPDATE agent_autonomy_enrollment SET lease_expires_at = ?4,
            updated_at = ?5, revision = revision + 1
            WHERE agent_id = ?1 AND revision = ?2 AND status = 'running' AND lease_owner = ?3`,
        [normalized, expectedRevision, leaseOwner, value.leaseExpiresAt!, now]);
        if (result.changes !== 1) throw new Error('Agent autonomy lease ownership changed; refresh and reconcile');
        return this.getAutonomyEnrollment(normalized)!;
    }

    releaseAutonomyLease(agentId: string, expectedRevision: number, leaseOwner: string,
        nextWakeupAt: string | null, now = new Date().toISOString()): AgentAutonomyEnrollment {
        const normalized = normalizeAgentId(agentId);
        const current = this.getAutonomyEnrollment(normalized);
        if (!current || current.revision !== expectedRevision || current.status !== 'running'
            || current.leaseOwner !== leaseOwner) {
            throw new Error('Agent autonomy lease ownership changed; refresh and reconcile');
        }
        const value = validateAutonomyEnrollment({ ...current, status: 'desired', nextWakeupAt,
            leaseOwner: null, leaseExpiresAt: null });
        if (Number.isNaN(Date.parse(now))) throw new Error('Autonomy release time must be an ISO timestamp');
        const result = this.database.run(`UPDATE agent_autonomy_enrollment SET status = 'desired',
            next_wakeup_at = ?4, lease_owner = NULL, lease_expires_at = NULL,
            updated_at = ?5, revision = revision + 1
            WHERE agent_id = ?1 AND revision = ?2 AND status = 'running' AND lease_owner = ?3`,
        [normalized, expectedRevision, leaseOwner, value.nextWakeupAt ?? null, now]);
        if (result.changes !== 1) throw new Error('Agent autonomy lease ownership changed; refresh and reconcile');
        return this.getAutonomyEnrollment(normalized)!;
    }

    recoverExpiredAutonomyLeases(now = new Date().toISOString()): AgentAutonomyEnrollment[] {
        if (Number.isNaN(Date.parse(now))) throw new Error('Autonomy recovery time must be an ISO timestamp');
        const expiredRows = this.database.query(`SELECT * FROM agent_autonomy_enrollment
            WHERE status = 'running' AND lease_expires_at <= ?1 ORDER BY agent_id`).all(now) as AutonomyEnrollmentRow[];
        const expired = expiredRows.map(autonomyEnrollment);
        if (expired.length === 0) return [];
        const transaction = this.database.transaction(() => {
            for (const enrollment of expired) {
                this.database.run(`UPDATE agent_autonomy_enrollment SET status = 'desired',
                    next_wakeup_at = ?3, lease_owner = NULL, lease_expires_at = NULL,
                    updated_at = ?3, revision = revision + 1
                    WHERE agent_id = ?1 AND revision = ?2 AND status = 'running' AND lease_expires_at <= ?3`,
                [enrollment.agentId, enrollment.revision, now]);
            }
        });
        transaction.immediate();
        return expired.flatMap(enrollment => {
            const recovered = this.getAutonomyEnrollment(enrollment.agentId);
            return recovered?.status === 'desired' && recovered.revision === enrollment.revision + 1 ? [recovered] : [];
        });
    }

    setControlProfile(agentId: string, expectedRevision: number, input: SetAgentControlProfile,
        now = new Date().toISOString()): AgentControlProfile {
        const normalized = normalizeAgentId(agentId);
        const value = validateControlProfile(input);
        const member = this.getPopulationMember(normalized);
        if (member && (value.role !== 'player' || value.subjectKind !== 'player'
            || value.subjectId.toLowerCase() !== member.playerUsername || value.avatarPlayerUsername?.toLowerCase() !== member.playerUsername))
            throw new Error('Population avatar control binding cannot be changed');
        if (Number.isNaN(Date.parse(now))) throw new Error('Control profile time must be an ISO timestamp');
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalized);
            const current = this.getControlProfile(normalized);
            if (!current || current.revision !== expectedRevision) {
                throw new Error('Agent control profile changed before update; refresh and try again');
            }
            const result = this.database.run(`UPDATE agent_control_profile SET role = ?3, subject_kind = ?4,
                subject_id = ?5, avatar_player_username = ?6, decision_interval_ms = ?7,
                max_decisions_per_day = ?8, daily_llm_budget_micros = ?9,
                daily_operational_budget_gp = ?10, updated_at = ?11, revision = revision + 1
                WHERE agent_id = ?1 AND revision = ?2`, [normalized, expectedRevision, value.role,
                value.subjectKind, value.subjectId, value.avatarPlayerUsername ?? null, value.decisionIntervalMs,
                value.maxDecisionsPerDay, value.dailyLlmBudgetMicros, value.dailyOperationalBudgetGp, now]);
            if (result.changes !== 1) throw new Error('Agent control profile changed before update; refresh and try again');
            this.database.run(`DELETE FROM agent_economic_actor_link WHERE agent_id = ?1 AND source = 'identity'`,
                [normalized]);
            if (value.subjectKind === 'player' || value.subjectKind === 'business' || value.subjectKind === 'faction') {
                this.database.run(`INSERT INTO agent_economic_actor_link
                    (agent_id, actor_kind, actor_id, role, source, created_at, updated_at, revision)
                    VALUES (?1, ?2, ?3, 'self', 'identity', ?4, ?4, 1)
                    ON CONFLICT(agent_id, actor_kind, actor_id) DO UPDATE SET
                        role = 'self', source = 'identity', updated_at = excluded.updated_at,
                        revision = agent_economic_actor_link.revision + 1`,
                [normalized, value.subjectKind, value.subjectId, now]);
            }
        });
        transaction.immediate();
        return this.getControlProfile(normalized)!;
    }

    recordDecision(agentId: string, expectedProfileRevision: number, input: RecordAgentDecision,
        now = new Date().toISOString()): { profile: AgentControlProfile; decision: AgentDecisionRecord } {
        const normalized = normalizeAgentId(agentId);
        const decisionId = normalizeAgentId(input.decisionId, 'decisionId');
        if (!['scheduled', 'event', 'admin'].includes(input.trigger)) throw new Error('Decision trigger is invalid');
        const llmCost = input.llmCostMicros ?? 0;
        const operationalBudget = input.operationalBudgetGp ?? 0;
        const contextDigest = input.contextDigest ?? null;
        if (!Number.isSafeInteger(llmCost) || llmCost < 0) throw new Error('Decision LLM cost is invalid');
        if (!Number.isSafeInteger(operationalBudget) || operationalBudget < 0) {
            throw new Error('Decision operational budget is invalid');
        }
        if (contextDigest !== null && !/^[0-9a-f]{64}$/.test(contextDigest)) {
            throw new Error('Decision context digest must be a lowercase SHA-256 digest');
        }
        const currentTime = Date.parse(now);
        if (Number.isNaN(currentTime)) throw new Error('Decision time must be an ISO timestamp');
        const day = now.slice(0, 10);
        let record: AgentDecisionRecord | null = null;
        const transaction = this.database.transaction(() => {
            const profile = this.getControlProfile(normalized);
            if (!profile || profile.revision !== expectedProfileRevision) {
                throw new Error('Agent control profile changed before decision admission; refresh and try again');
            }
            if (input.trigger === 'scheduled' && profile.nextDecisionAt
                && currentTime < Date.parse(profile.nextDecisionAt)) throw new Error('Scheduled decision is not due yet');
            const totals = this.database.query(`SELECT COUNT(*) AS count,
                COALESCE(SUM(llm_cost_micros), 0) AS llm_cost,
                COALESCE(SUM(operational_budget_gp), 0) AS operational_budget
                FROM agent_decision_ledger WHERE agent_id = ?1 AND substr(occurred_at, 1, 10) = ?2`)
                .get(normalized, day) as { count: number; llm_cost: number; operational_budget: number };
            if (totals.count >= profile.maxDecisionsPerDay) throw new Error('Agent daily decision limit reached');
            if (totals.llm_cost + llmCost > profile.dailyLlmBudgetMicros) {
                throw new Error('Agent daily LLM budget exceeded');
            }
            if (totals.operational_budget + operationalBudget > profile.dailyOperationalBudgetGp) {
                throw new Error('Agent daily operational budget exceeded');
            }
            this.database.run(`INSERT INTO agent_decision_ledger
                (decision_id, agent_id, trigger, llm_cost_micros, operational_budget_gp, occurred_at,
                profile_revision, context_digest)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
            [decisionId, normalized, input.trigger, llmCost, operationalBudget, now, profile.revision, contextDigest]);
            const next = new Date(currentTime + profile.decisionIntervalMs).toISOString();
            const updated = this.database.run(`UPDATE agent_control_profile SET last_decision_at = ?3,
                next_decision_at = ?4, updated_at = ?3, revision = revision + 1
                WHERE agent_id = ?1 AND revision = ?2`, [normalized, profile.revision, now, next]);
            if (updated.changes !== 1) throw new Error('Agent control profile changed during decision admission');
            record = { decisionId, agentId: normalized, trigger: input.trigger, llmCostMicros: llmCost,
                operationalBudgetGp: operationalBudget, occurredAt: now, profileRevision: profile.revision,
                contextDigest };
        });
        transaction.immediate();
        return { profile: this.getControlProfile(normalized)!, decision: record! };
    }

    listDecisions(agentId: string, day?: string): AgentDecisionRecord[] {
        const normalized = normalizeAgentId(agentId);
        if (day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Decision day is invalid');
        const rows = day
            ? this.database.query(`SELECT * FROM agent_decision_ledger WHERE agent_id = ?1
                AND substr(occurred_at, 1, 10) = ?2 ORDER BY occurred_at, decision_id`).all(normalized, day)
            : this.database.query(`SELECT * FROM agent_decision_ledger WHERE agent_id = ?1
                ORDER BY occurred_at DESC, decision_id`).all(normalized);
        return (rows as DecisionRecordRow[]).map(decisionRecord);
    }

    reserveDecisionOperationalBudget(decisionIdInput: string, amountGp: number, authorizationDailyLimitGp: number,
        now = new Date().toISOString()): AgentDecisionRecord {
        const decisionId = normalizeAgentId(decisionIdInput, 'decisionId');
        if (!Number.isSafeInteger(amountGp) || amountGp < 0 || !Number.isSafeInteger(authorizationDailyLimitGp)
            || authorizationDailyLimitGp < amountGp) throw new Error('Decision operational reservation is invalid');
        const transaction = this.database.transaction(() => {
            const row = this.database.query('SELECT * FROM agent_decision_ledger WHERE decision_id = ?1')
                .get(decisionId) as DecisionRecordRow | null;
            if (!row) throw new Error('Unknown decision for operational reservation');
            if (row.operational_budget_gp === amountGp) return;
            if (row.operational_budget_gp !== 0) throw new Error('Decision operational reservation cannot be changed');
            const profile = this.getControlProfile(row.agent_id);
            if (!profile) throw new Error('Decision agent has no control profile');
            const totals = this.database.query(`SELECT COALESCE(SUM(operational_budget_gp), 0) AS total
                FROM agent_decision_ledger WHERE agent_id = ?1 AND decision_id != ?2
                AND substr(occurred_at, 1, 10) = ?3`).get(row.agent_id, decisionId, row.occurred_at.slice(0, 10)) as { total: number };
            if (totals.total + amountGp > profile.dailyOperationalBudgetGp
                || totals.total + amountGp > authorizationDailyLimitGp) {
                throw new Error('Decision operational reservation exceeds a daily GP limit');
            }
            this.database.run(`UPDATE agent_decision_ledger SET operational_budget_gp = ?2
                WHERE decision_id = ?1 AND operational_budget_gp = 0`, [decisionId, amountGp]);
        });
        transaction.immediate();
        return this.listDecisions((this.database.query(`SELECT agent_id FROM agent_decision_ledger
            WHERE decision_id = ?1`).get(decisionId) as { agent_id: string }).agent_id)
            .find(item => item.decisionId === decisionId)!;
    }

    createPlayerActionRequest(requesterAgentId: string, input: CreateAgentPlayerActionRequest,
        now = new Date().toISOString()): AgentPlayerActionRequest {
        const requesterId = normalizeAgentId(requesterAgentId, 'requesterAgentId');
        const value = validateCreatePlayerActionRequest(input);
        if (Number.isNaN(Date.parse(now))) throw new Error('Player action request time must be an ISO timestamp');
        const transaction = this.database.transaction(() => {
            if (requesterId === value.assigneeAgentId) throw new Error('An agent cannot request work from itself');
            const requester = this.getControlProfile(requesterId);
            if (!requester || requester.role !== 'institution'
                || (requester.subjectKind !== 'business' && requester.subjectKind !== 'faction')) {
                throw new Error('Only a business or faction institution may request a player action');
            }
            const committed = this.database.query(`SELECT COALESCE(SUM(reward_gp), 0) AS total
                FROM agent_player_action_request WHERE requester_agent_id = ?1
                AND substr(requested_at, 1, 10) = ?2
                AND status IN ('pending', 'accepted', 'approved', 'running', 'settling', 'completed')`)
                .get(requesterId, now.slice(0, 10)) as { total: number };
            if (committed.total + value.rewardGp > requester.dailyOperationalBudgetGp) {
                throw new Error('Player action rewards exceed the requester daily operational budget');
            }
            const assignee = this.getControlProfile(value.assigneeAgentId);
            if (!assignee || assignee.role !== 'player' || assignee.subjectKind !== 'player'
                || !assignee.avatarPlayerUsername) {
                throw new Error('Player action assignee must be an exact avatar-bound player agent');
            }
            const knowledge = this.getSkillKnowledge(value.assigneeAgentId, value.skill);
            if (!knowledge || (knowledge.status !== 'known' && knowledge.status !== 'preferred')) {
                throw new Error('Player action assignee must already know the exact requested skill');
            }
            this.database.run(`INSERT INTO agent_player_action_request
                (request_id, requester_agent_id, assignee_agent_id, skill_id, skill_version, parameters,
                objective, reward_gp, status, response_note, requested_at, updated_at,
                accepted_at, approval_id, approval_expires_at, approved_at, started_at, run_id,
                settlement_id, settlement_started_at, settled_at,
                resolved_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', '', ?9, ?9,
                    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1)`,
            [value.requestId, requesterId, value.assigneeAgentId, value.skill.id, value.skill.version,
                JSON.stringify(value.parameters), value.objective, value.rewardGp, now]);
        });
        transaction.immediate();
        return this.getPlayerActionRequest(value.requestId)!;
    }

    getPlayerActionRequest(requestId: string): AgentPlayerActionRequest | null {
        const normalized = normalizeAgentId(requestId, 'requestId');
        const row = this.database.query('SELECT * FROM agent_player_action_request WHERE request_id = ?1')
            .get(normalized);
        return row ? playerActionRequest(row as PlayerActionRequestRow) : null;
    }

    getPlayerActionRequestBySettlementId(settlementId: string): AgentPlayerActionRequest | null {
        const normalized = normalizeAgentId(settlementId, 'settlementId');
        const row = this.database.query(`SELECT * FROM agent_player_action_request
            WHERE settlement_id = ?1`).get(normalized);
        return row ? playerActionRequest(row as PlayerActionRequestRow) : null;
    }

    listPlayerActionRequests(agentId: string, direction: 'incoming' | 'outgoing' | 'all' = 'all'):
        AgentPlayerActionRequest[] {
        const normalized = normalizeAgentId(agentId);
        if (!['incoming', 'outgoing', 'all'].includes(direction)) throw new Error('Player action direction is invalid');
        const clause = direction === 'incoming' ? 'assignee_agent_id = ?1'
            : direction === 'outgoing' ? 'requester_agent_id = ?1'
                : '(requester_agent_id = ?1 OR assignee_agent_id = ?1)';
        return (this.database.query(`SELECT * FROM agent_player_action_request WHERE ${clause}
            ORDER BY requested_at DESC, request_id`).all(normalized) as PlayerActionRequestRow[])
            .map(playerActionRequest);
    }

    setPlayerActionRequestStatus(requestId: string, actorAgentId: string, expectedRevision: number,
        status: AgentPlayerActionManualStatus, responseNote = '',
        now = new Date().toISOString()): AgentPlayerActionRequest {
        const normalizedRequestId = normalizeAgentId(requestId, 'requestId');
        const actorId = normalizeAgentId(actorAgentId, 'actorAgentId');
        const note = responseNote.trim();
        if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error('Player action revision is invalid');
        if (!['accepted', 'rejected', 'cancelled'].includes(status)) {
            throw new Error('Player action status is invalid');
        }
        if (note.length > 500) throw new Error('Player action response note must be at most 500 characters');
        if (status === 'rejected' && !note) {
            throw new Error(`${status} player actions require a response note`);
        }
        if (Number.isNaN(Date.parse(now))) throw new Error('Player action status time must be an ISO timestamp');
        const transaction = this.database.transaction(() => {
            const current = this.getPlayerActionRequest(normalizedRequestId);
            if (!current || current.revision !== expectedRevision) {
                throw new Error('Player action request changed before update; refresh and try again');
            }
            const assigneeAction = actorId === current.assigneeAgentId;
            const requesterAction = actorId === current.requesterAgentId;
            if (!assigneeAction && !requesterAction) throw new Error('Agent is not a party to this player action request');
            const allowed = current.status === 'pending'
                ? (assigneeAction && (status === 'accepted' || status === 'rejected'))
                    || (requesterAction && status === 'cancelled')
                : current.status === 'accepted' && assigneeAction && status === 'cancelled';
            if (!allowed) throw new Error(`Invalid player action transition: ${current.status} -> ${status}`);
            const result = this.database.run(`UPDATE agent_player_action_request SET status = ?3,
                response_note = ?4, updated_at = ?5,
                accepted_at = CASE WHEN ?3 = 'accepted' THEN ?5 ELSE accepted_at END,
                resolved_at = CASE WHEN ?3 IN ('rejected', 'cancelled', 'completed', 'failed') THEN ?5 ELSE NULL END,
                revision = revision + 1 WHERE request_id = ?1 AND revision = ?2`,
            [normalizedRequestId, expectedRevision, status, note, now]);
            if (result.changes !== 1) {
                throw new Error('Player action request changed before update; refresh and try again');
            }
        });
        transaction.immediate();
        return this.getPlayerActionRequest(normalizedRequestId)!;
    }

    approvePlayerActionRequest(requestId: string, actorAgentId: string, expectedRevision: number,
        approvalId: string, expiresAt: string, now = new Date().toISOString()): AgentPlayerActionRequest {
        const normalizedRequestId = normalizeAgentId(requestId, 'requestId');
        const actorId = normalizeAgentId(actorAgentId, 'actorAgentId');
        const normalizedApprovalId = normalizeAgentId(approvalId, 'approvalId');
        const nowMs = Date.parse(now), expiresMs = Date.parse(expiresAt);
        if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error('Player action revision is invalid');
        if (Number.isNaN(nowMs) || Number.isNaN(expiresMs) || expiresMs <= nowMs || expiresMs - nowMs > 3_600_000) {
            throw new Error('Player action approval must expire within one hour');
        }
        const transaction = this.database.transaction(() => {
            const current = this.getPlayerActionRequest(normalizedRequestId);
            if (!current || current.revision !== expectedRevision) {
                throw new Error('Player action request changed before approval; refresh and try again');
            }
            if (current.status !== 'accepted' || current.assigneeAgentId !== actorId) {
                throw new Error('Only the assigned player may approve an accepted player action');
            }
            const result = this.database.run(`UPDATE agent_player_action_request SET status = 'approved',
                approval_id = ?3, approval_expires_at = ?4, approved_at = ?5, updated_at = ?5,
                revision = revision + 1 WHERE request_id = ?1 AND revision = ?2`,
            [normalizedRequestId, expectedRevision, normalizedApprovalId, expiresAt, now]);
            if (result.changes !== 1) throw new Error('Player action request changed during approval');
        });
        transaction.immediate();
        return this.getPlayerActionRequest(normalizedRequestId)!;
    }

    startApprovedPlayerAction(requestId: string, actorAgentId: string, expectedRevision: number,
        approvalId: string, runId: string, now = new Date().toISOString()): AgentPlayerActionRequest {
        const normalizedRequestId = normalizeAgentId(requestId, 'requestId');
        const actorId = normalizeAgentId(actorAgentId, 'actorAgentId');
        const normalizedApprovalId = normalizeAgentId(approvalId, 'approvalId');
        const normalizedRunId = normalizeAgentId(runId, 'runId');
        const nowMs = Date.parse(now);
        if (Number.isNaN(nowMs)) throw new Error('Player action start time must be an ISO timestamp');
        const transaction = this.database.transaction(() => {
            const current = this.getPlayerActionRequest(normalizedRequestId);
            if (!current || current.revision !== expectedRevision) {
                throw new Error('Player action request changed before start; refresh and try again');
            }
            if (current.status !== 'approved' || current.assigneeAgentId !== actorId
                || current.approvalId !== normalizedApprovalId) throw new Error('Player action approval is invalid or already used');
            if (!current.approvalExpiresAt || nowMs >= Date.parse(current.approvalExpiresAt)) {
                throw new Error('Player action approval has expired');
            }
            const result = this.database.run(`UPDATE agent_player_action_request SET status = 'running',
                started_at = ?3, run_id = ?4, updated_at = ?3, revision = revision + 1
                WHERE request_id = ?1 AND revision = ?2`,
            [normalizedRequestId, expectedRevision, now, normalizedRunId]);
            if (result.changes !== 1) throw new Error('Player action request changed during start');
        });
        transaction.immediate();
        return this.getPlayerActionRequest(normalizedRequestId)!;
    }

    finishPlayerActionRun(runId: string, completed: boolean, responseNote: string,
        now = new Date().toISOString(), settlementId: string | null = null): AgentPlayerActionRequest | null {
        const normalizedRunId = normalizeAgentId(runId, 'runId');
        const normalizedSettlementId = settlementId === null ? null : normalizeAgentId(settlementId, 'settlementId');
        const note = responseNote.trim().slice(0, 500);
        if (Number.isNaN(Date.parse(now))) throw new Error('Player action finish time must be an ISO timestamp');
        let result: AgentPlayerActionRequest | null = null;
        const transaction = this.database.transaction(() => {
            const row = this.database.query(`SELECT * FROM agent_player_action_request
                WHERE run_id = ?1`).get(normalizedRunId) as PlayerActionRequestRow | null;
            if (!row) return;
            const current = playerActionRequest(row);
            if (current.status !== 'running') { result = current; return; }
            if (completed && current.rewardGp > 0 && !normalizedSettlementId) {
                throw new Error('Completed paid player actions require a settlement id');
            }
            const status = completed && current.rewardGp > 0 ? 'settling' : completed ? 'completed' : 'failed';
            const updated = this.database.run(`UPDATE agent_player_action_request SET status = ?3,
                response_note = ?4, updated_at = ?5,
                settlement_id = ?6, settlement_started_at = CASE WHEN ?3 = 'settling' THEN ?5 ELSE NULL END,
                resolved_at = CASE WHEN ?3 IN ('completed', 'failed') THEN ?5 ELSE NULL END,
                revision = revision + 1
                WHERE request_id = ?1 AND revision = ?2 AND status = 'running'`,
            [current.requestId, current.revision, status, note, now, normalizedSettlementId]);
            if (updated.changes !== 1) throw new Error('Player action request changed during run reconciliation');
            result = this.getPlayerActionRequest(current.requestId);
        });
        transaction.immediate();
        return result;
    }

    notePlayerActionRunReconciliation(requestId: string, responseNote: string,
        now = new Date().toISOString()): AgentPlayerActionRequest {
        const current = this.getPlayerActionRequest(requestId);
        if (!current) throw new Error('Player action request does not exist');
        const note = responseNote.trim().slice(0, 500);
        if (current.status === 'running' && current.responseNote !== note) this.database.run(`UPDATE agent_player_action_request
            SET response_note=?2,updated_at=?3,revision=revision+1 WHERE request_id=?1 AND status='running'`, [requestId, note, now]);
        return this.getPlayerActionRequest(requestId)!;
    }

    failUnstartedPlayerAction(requestId: string, responseNote: string, now = new Date().toISOString()): AgentPlayerActionRequest {
        const current = this.getPlayerActionRequest(requestId);
        if (!current || current.runId || current.settlementId || !['pending', 'accepted', 'approved'].includes(current.status)
            || !Number.isFinite(Date.parse(now))) throw new Error('Only unstarted player work may expire before dispatch');
        this.database.run(`UPDATE agent_player_action_request SET status='failed',response_note=?2,updated_at=?3,
            resolved_at=?3,revision=revision+1 WHERE request_id=?1 AND revision=?4 AND run_id IS NULL AND settlement_id IS NULL`,
        [requestId, responseNote.trim().slice(0, 500), now, current.revision]);
        return this.getPlayerActionRequest(requestId)!;
    }

    completePlayerActionSettlement(settlementId: string, responseNote: string,
        now = new Date().toISOString()): AgentPlayerActionRequest | null {
        const normalizedSettlementId = normalizeAgentId(settlementId, 'settlementId');
        const note = responseNote.trim().slice(0, 500);
        if (Number.isNaN(Date.parse(now))) throw new Error('Player action settlement time must be an ISO timestamp');
        let result: AgentPlayerActionRequest | null = null;
        const transaction = this.database.transaction(() => {
            const row = this.database.query(`SELECT * FROM agent_player_action_request
                WHERE settlement_id = ?1`).get(normalizedSettlementId) as PlayerActionRequestRow | null;
            if (!row) return;
            const current = playerActionRequest(row);
            if (current.status !== 'settling') { result = current; return; }
            const updated = this.database.run(`UPDATE agent_player_action_request SET status = 'completed',
                response_note = ?3, updated_at = ?4, settled_at = ?4, resolved_at = ?4,
                revision = revision + 1 WHERE request_id = ?1 AND revision = ?2 AND status = 'settling'`,
            [current.requestId, current.revision, note, now]);
            if (updated.changes !== 1) throw new Error('Player action changed during settlement completion');
            result = this.getPlayerActionRequest(current.requestId);
        });
        transaction.immediate();
        return result;
    }

    notePlayerActionSettlementFailure(settlementId: string, responseNote: string,
        now = new Date().toISOString()): AgentPlayerActionRequest | null {
        const normalizedSettlementId = normalizeAgentId(settlementId, 'settlementId');
        const note = responseNote.trim().slice(0, 500);
        if (!note) throw new Error('Settlement failure requires a response note');
        if (Number.isNaN(Date.parse(now))) throw new Error('Player action settlement time must be an ISO timestamp');
        const row = this.database.query(`SELECT * FROM agent_player_action_request
            WHERE settlement_id = ?1`).get(normalizedSettlementId) as PlayerActionRequestRow | null;
        if (!row) return null;
        const current = playerActionRequest(row);
        if (current.status !== 'settling') return current;
        this.database.run(`UPDATE agent_player_action_request SET response_note = ?3, updated_at = ?4,
            revision = revision + 1 WHERE request_id = ?1 AND revision = ?2 AND status = 'settling'`,
        [current.requestId, current.revision, note, now]);
        return this.getPlayerActionRequest(current.requestId);
    }

    createGoal(agentId: string, input: CreateAgentGoal, now = new Date().toISOString()): AgentGoal {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateCreateGoal(input);
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            if (value.parentGoalId) {
                const parent = this.getGoal(value.parentGoalId);
                if (!parent || parent.agentId !== normalizedAgentId) throw new Error('Goal parent must belong to the same agent');
                if (parent.horizon !== expectedParentHorizon(value.horizon)) {
                    throw new Error(`${value.horizon} goal parent must be a ${expectedParentHorizon(value.horizon)} goal`);
                }
                if (parent.status !== 'active') throw new Error('Goal parent must be active');
            }
            this.database.run(`INSERT INTO agent_goal
                (goal_id, agent_id, parent_goal_id, horizon, title, description, status, priority, skill_id, skill_version,
                created_at, updated_at, completed_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9, ?10, ?10, NULL, 1)`,
            [value.goalId, normalizedAgentId, value.parentGoalId, value.horizon, value.title, value.description,
                value.priority, value.skill?.id ?? null, value.skill?.version ?? null, now]);
            this.database.run(`INSERT INTO agent_goal_event
                (goal_id, agent_id, kind, previous_status, status, previous_revision, revision,
                skill_id, skill_version, occurred_at)
                VALUES (?1, ?2, 'created', NULL, 'active', NULL, 1, ?3, ?4, ?5)`,
            [value.goalId, normalizedAgentId, value.skill?.id ?? null, value.skill?.version ?? null, now]);
            this.bindGoalEvent(value.goalId, 1, 'created');
            if (value.objective) this.database.run(`INSERT INTO agent_state_objective(goal_id,objective_json)
                VALUES (?1,?2)`, [value.goalId, JSON.stringify(value.objective)]);
            if (value.execution) {
                const binding = createSkillParameterBinding(value.execution.binding);
                this.database.run(`INSERT INTO agent_goal_execution
                    (goal_id, execution_policy, required_successful_runs, successful_runs, cooldown_ms,
                    next_eligible_at, last_run_id, parameter_source_kind, parameter_source_id,
                    parameters, parameter_digest, created_at, updated_at, revision)
                    VALUES (?1, ?2, ?3, 0, ?4, NULL, NULL, ?5, ?6, ?7, ?8, ?9, ?9, 1)`,
                [value.goalId, value.execution.policy, value.execution.requiredSuccessfulRuns ?? 1,
                    value.execution.cooldownMs ?? 0, binding.sourceKind, binding.sourceId,
                    JSON.stringify(binding.parameters), binding.digest, now]);
            }
        });
        transaction.immediate();
        return this.requireGoal(value.goalId);
    }

    createGoalProposal(agentId: string, input: CreateAgentGoalProposal,
        now = new Date().toISOString()): AgentGoalProposal {
        const normalizedAgentId = normalizeAgentId(agentId);
        const proposalId = normalizeAgentId(input.proposalId, 'proposalId');
        const runId = normalizeAgentId(input.runId, 'runId');
        const anchorGoalId = normalizeAgentId(input.anchorGoalId, 'anchorGoalId');
        const goals = input.goals.map(validateCreateGoal);
        const skill = input.skill ? normalizeSkillReference(input.skill) : null;
        const reason = input.reason.trim().slice(0, 2000);
        if (!goals.length) throw new Error('Goal proposal must contain at least one goal');
        if (!reason) throw new Error('Goal proposal reason is required');
        if (!Number.isInteger(input.anchorGoalRevision) || input.anchorGoalRevision < 1) {
            throw new Error('Goal proposal anchor revision is invalid');
        }
        let parentId = anchorGoalId;
        const anchor = this.getGoal(anchorGoalId);
        if (!anchor || anchor.agentId !== normalizedAgentId || anchor.status !== 'active'
            || anchor.revision !== input.anchorGoalRevision) throw new Error('Goal proposal anchor is stale or invalid');
        for (const proposed of goals) {
            if (proposed.parentGoalId !== parentId) throw new Error('Goal proposal must form one contiguous hierarchy');
            const parentHorizon = parentId === anchorGoalId ? anchor.horizon
                : goals.find(goal => goal.goalId === parentId)?.horizon;
            if (parentHorizon !== expectedParentHorizon(proposed.horizon)) {
                throw new Error(`Invalid ${proposed.horizon} goal parent in proposal`);
            }
            parentId = proposed.goalId;
        }
        if (skill && goals.at(-1)?.horizon !== 'immediate') {
            throw new Error('A proposed skill requires a final immediate goal');
        }
        this.database.run(`INSERT INTO agent_goal_proposal
            (proposal_id, run_id, agent_id, anchor_goal_id, anchor_goal_revision, goals, skill_id, skill_version,
            reason, status, approval_id, approval_expires_at, skill_run_id, response_note, created_at, updated_at,
            approved_at, started_at, resolved_at, revision)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', NULL, NULL, NULL, '', ?10, ?10,
            NULL, NULL, NULL, 1)`, [proposalId, runId, normalizedAgentId, anchorGoalId, input.anchorGoalRevision,
            JSON.stringify(goals), skill?.id ?? null, skill?.version ?? null, reason, now]);
        return this.getGoalProposal(proposalId)!;
    }

    getGoalProposal(proposalId: string): AgentGoalProposal | null {
        const normalized = normalizeAgentId(proposalId, 'proposalId');
        const row = this.database.query('SELECT * FROM agent_goal_proposal WHERE proposal_id = ?1').get(normalized);
        return row ? goalProposal(row as GoalProposalRow) : null;
    }

    listGoalProposals(agentId: string): AgentGoalProposal[] {
        const rows = this.database.query(`SELECT * FROM agent_goal_proposal WHERE agent_id = ?1
            ORDER BY created_at DESC, proposal_id`).all(normalizeAgentId(agentId));
        return (rows as GoalProposalRow[]).map(goalProposal);
    }

    approveGoalProposal(proposalId: string, expectedRevision: number, approvalId: string, expiresAt: string,
        now = new Date().toISOString()): AgentGoalProposal {
        const normalizedProposalId = normalizeAgentId(proposalId, 'proposalId');
        const normalizedApprovalId = normalizeAgentId(approvalId, 'approvalId');
        if (Number.isNaN(Date.parse(expiresAt)) || expiresAt <= now) throw new Error('Goal proposal approval expiry is invalid');
        const transaction = this.database.transaction(() => {
            const proposal = this.getGoalProposal(normalizedProposalId);
            if (!proposal || proposal.status !== 'pending' || proposal.revision !== expectedRevision) {
                throw new Error('Goal proposal is no longer pending or changed before approval');
            }
            const anchor = this.getGoal(proposal.anchorGoalId);
            if (!anchor || anchor.agentId !== proposal.agentId || anchor.status !== 'active'
                || anchor.revision !== proposal.anchorGoalRevision) throw new Error('Goal proposal anchor changed before approval');
            if (proposal.skill) {
                const knowledge = this.listSkillKnowledge(proposal.agentId).find(item =>
                    item.skill.id === proposal.skill!.id && item.skill.version === proposal.skill!.version);
                if (!knowledge || !['known', 'preferred'].includes(knowledge.status)) {
                    throw new Error('Proposed skill is no longer learned and executable');
                }
            }
            for (const input of proposal.goals) {
                this.createGoal(proposal.agentId, { ...input,
                    skill: input.goalId === proposal.goals.at(-1)?.goalId ? proposal.skill : null }, now);
            }
            const status = proposal.skill ? 'approved' : 'completed';
            const result = this.database.run(`UPDATE agent_goal_proposal SET status = ?3, approval_id = ?4,
                approval_expires_at = ?5, approved_at = ?6, updated_at = ?6,
                resolved_at = CASE WHEN ?3 = 'completed' THEN ?6 ELSE NULL END, revision = revision + 1
                WHERE proposal_id = ?1 AND revision = ?2 AND status = 'pending'`,
            [proposal.proposalId, proposal.revision, status, normalizedApprovalId, expiresAt, now]);
            if (result.changes !== 1) throw new Error('Goal proposal changed during approval');
        });
        transaction.immediate();
        return this.getGoalProposal(normalizedProposalId)!;
    }

    startApprovedGoalProposal(proposalId: string, expectedRevision: number, approvalId: string, skillRunId: string,
        now = new Date().toISOString()): AgentGoalProposal {
        const proposal = this.getGoalProposal(proposalId);
        if (!proposal || proposal.status !== 'approved' || proposal.revision !== expectedRevision
            || proposal.approvalId !== normalizeAgentId(approvalId, 'approvalId')) {
            throw new Error('Goal proposal approval is invalid, changed, or already consumed');
        }
        if (!proposal.skill || !proposal.approvalExpiresAt || proposal.approvalExpiresAt <= now) {
            throw new Error('Goal proposal approval expired or has no executable skill');
        }
        const result = this.database.run(`UPDATE agent_goal_proposal SET status = 'running', skill_run_id = ?4,
            started_at = ?5, updated_at = ?5, revision = revision + 1
            WHERE proposal_id = ?1 AND revision = ?2 AND status = 'approved' AND approval_id = ?3`,
        [proposal.proposalId, proposal.revision, proposal.approvalId, normalizeAgentId(skillRunId, 'skillRunId'), now]);
        if (result.changes !== 1) throw new Error('Goal proposal approval was consumed concurrently');
        return this.getGoalProposal(proposal.proposalId)!;
    }

    finishGoalProposalRun(skillRunId: string, completed: boolean, responseNote: string,
        now = new Date().toISOString()): AgentGoalProposal | null {
        const normalizedRunId = normalizeAgentId(skillRunId, 'skillRunId');
        const current = this.database.query('SELECT * FROM agent_goal_proposal WHERE skill_run_id = ?1')
            .get(normalizedRunId) as GoalProposalRow | null;
        if (!current || current.status !== 'running') return current ? goalProposal(current) : null;
        this.database.run(`UPDATE agent_goal_proposal SET status = ?2, response_note = ?3,
            updated_at = ?4, resolved_at = ?4, revision = revision + 1 WHERE skill_run_id = ?1 AND status = 'running'`,
        [normalizedRunId, completed ? 'completed' : 'failed', responseNote.trim().slice(0, 500), now]);
        return this.getGoalProposal(current.proposal_id);
    }

    setGoalStatus(goalId: string, expectedRevision: number, status: GoalStatus,
        now = new Date().toISOString()): AgentGoal {
        if (!['active', 'completed', 'blocked', 'abandoned'].includes(status)) throw new Error('Invalid goal status');
        let unchanged: AgentGoal | null = null;
        const normalizedGoalId = normalizeAgentId(goalId, 'goalId');
        const transaction = this.database.transaction(() => {
            const current = this.requireGoal(normalizedGoalId);
            if (current.status === status) { unchanged = current; return; }
            if (current.status !== 'active' && status === 'active') throw new Error('Ended goals cannot be reactivated');
            if (status === 'completed' && current.objective) {
                const evidence = this.database.query(`SELECT 1 FROM agent_state_evaluation WHERE goal_id=?1
                    AND goal_revision=?2 AND result='satisfied' AND evaluated_at=?3`).get(current.goalId, current.revision, now);
                if (current.objective.mode !== 'achieve' || !evidence) throw new Error('State goal requires current native predicate evidence');
            }
            if (status !== 'active') {
                const activeChildren = this.database.query(`SELECT COUNT(*) AS count FROM agent_goal
                    WHERE parent_goal_id = ?1 AND status = 'active'`).get(current.goalId) as { count: number };
                if (activeChildren.count > 0) throw new Error('End active child goals before ending their parent');
            }
            const result = this.database.run(`UPDATE agent_goal SET status = ?3, updated_at = ?4,
                completed_at = CASE WHEN ?3 = 'completed' THEN ?4 ELSE NULL END, revision = revision + 1
                WHERE goal_id = ?1 AND revision = ?2`, [current.goalId, expectedRevision, status, now]);
            if (result.changes !== 1) throw new Error('Goal changed before update; refresh and try again');
            this.database.run(`INSERT INTO agent_goal_event
                (goal_id, agent_id, kind, previous_status, status, previous_revision, revision,
                skill_id, skill_version, occurred_at)
                VALUES (?1, ?2, 'status-changed', ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
            [current.goalId, current.agentId, current.status, status, current.revision, current.revision + 1,
                current.skill?.id ?? null, current.skill?.version ?? null, now]);
            this.bindGoalEvent(current.goalId, current.revision + 1, 'status-changed');
        });
        transaction.immediate();
        return unchanged ?? this.requireGoal(normalizedGoalId);
    }

    private withStateObjective(value: AgentGoal): AgentGoal {
        const row = this.database.query('SELECT objective_json FROM agent_state_objective WHERE goal_id=?1')
            .get(value.goalId) as { objective_json: string } | null;
        if (!row) return value;
        const evaluation = this.database.query(`SELECT result,observed_at,digest FROM agent_state_evaluation
            WHERE goal_id=?1 ORDER BY observed_at DESC,rowid DESC LIMIT 1`).get(value.goalId) as
            { result: StateGoalEvaluation['result']; observed_at: string; digest: string } | null;
        const terminal = this.database.query(`SELECT o.occurred_at FROM agent_goal_execution e
            JOIN agent_skill_outcome o ON o.run_id=e.last_run_id WHERE e.goal_id=?1 AND o.status='completed'`)
            .get(value.goalId) as { occurred_at: string } | null;
        return { ...value, objective: JSON.parse(row.objective_json) as StateObjective,
            ...(evaluation ? { stateEvaluation: { result: evaluation.result, observedAt: evaluation.observed_at,
                digest: evaluation.digest, ...(terminal && evaluation.result !== 'satisfied'
                    && evaluation.observed_at >= terminal.occurred_at ? { needsReplan: true } : {}) } } : {}) };
    }

    getPlayerStrategy(eventId: string): PlayerStrategyRun | null { return readPlayerStrategy(this.database, eventId); }

    playerStrategyOperationalSpend(agentId: string, now: string, eventId: string): number {
        return (this.database.query(`SELECT COALESCE(SUM(operational_budget_gp),0) total FROM agent_decision_ledger
            WHERE agent_id=?1 AND substr(occurred_at,1,10)=?2 AND decision_id!=?3`).get(agentId,now.slice(0,10),eventId) as {total:number}).total;
    }

    getEconomicAction(eventId:string):EconomicActionRun|null{return readEconomicAction(this.database,eventId);}
    pendingEconomicAction(agentId:string):EconomicActionRun|null{
        const r=this.database.query("SELECT event_id FROM agent_economic_action WHERE agent_id=?1 AND status IN ('prepared','inferring','decided','applying') ORDER BY rowid LIMIT 1")
            .get(normalizeAgentId(agentId)) as {event_id:string}|null;return r?this.getEconomicAction(r.event_id):null;
    }
    assertEconomicActionAuthority(request:EconomicActionRequest,owner?:string,now=new Date().toISOString()):void{
        const p=this.getControlProfile(request.agentId),e=this.getAutonomyEnrollment(request.agentId);
        if(!p||p.revision!==request.profileRevision||!['player','institution'].includes(p.role)||p.role==='institution'&&p.subjectKind!=='business'
            ||p.role==='player'&&(!p.avatarPlayerUsername||this.getIdentity(request.agentId)?.playerUsername!==p.avatarPlayerUsername)
            ||this.getAutonomyControl().emergencyStop||!e||e.status!=='running'||e.policyId!==request.policyId||e.policyVersion!==request.policyVersion
            ||!e.leaseExpiresAt||Date.parse(e.leaseExpiresAt)<=Date.parse(now)||owner&&e.leaseOwner!==owner)throw new Error('Economic actor/profile/lease/stop authority changed');
        this.assertCharacterCanAct(request.agentId);
    }
    prepareEconomicAction(request:EconomicActionRequest,maxCostMicros:number,owner?:string):EconomicActionRun{
        this.database.transaction(()=>{
            const prior=this.getEconomicAction(request.eventId);if(prior){if(prior.request.agentId!==request.agentId||prior.request.sourceKey!==request.sourceKey)throw new Error('Economic event collision');return;}
            this.assertEconomicActionAuthority(request,owner,request.observedAt);
            if(this.database.query("SELECT 1 FROM agent_economic_action WHERE agent_id=?1 AND (next_eligible_at>?2 OR status IN ('prepared','inferring','decided','applying'))").get(request.agentId,request.observedAt))
                throw new Error('Economic action cooldown or unresolved decision is active');
            const admitted=this.recordDecision(request.agentId,request.profileRevision,{decisionId:request.eventId,trigger:'event',llmCostMicros:maxCostMicros,contextDigest:request.binding},request.observedAt);
            this.database.run("INSERT INTO agent_economic_action VALUES(?1,?2,?3,'prepared',NULL,'',?4,NULL)",[request.eventId,request.agentId,
                JSON.stringify({...request,profileRevision:admitted.profile.revision}),new Date(Date.parse(request.observedAt)+Math.max(60000,admitted.profile.decisionIntervalMs)).toISOString()]);
        }).immediate();return this.getEconomicAction(request.eventId)!;
    }
    claimEconomicInference(eventId:string):boolean{return this.database.run("UPDATE agent_economic_action SET status='inferring' WHERE event_id=?1 AND status='prepared'",[eventId]).changes===1;}
    finishEconomicInference(eventId:string,plan:LlmPlanResult):EconomicActionRun{
        const r=this.getEconomicAction(eventId);if(!r||r.status!=='inferring'||plan.runId!==eventId||plan.agentId!==r.request.agentId)throw new Error('Economic inference identity differs');
        const selected=plan.status==='proposed'&&plan.decision?.kind==='choose-alternative'&&r.request.input.economicAlternatives?.some(o=>o.optionId===(plan.decision as {optionId:string}).optionId);
        this.database.run("UPDATE agent_economic_action SET status=?2,plan_json=?3,reason=?4 WHERE event_id=?1 AND status='inferring'",
            [eventId,selected?'decided':['failed','stopped'].includes(plan.status)?'inferring':'waiting',JSON.stringify(plan),plan.reason.slice(0,1000)]);return this.getEconomicAction(eventId)!;
    }
    beginEconomicApplication(eventId:string,costGp:number,dailyLimit:number,owner?:string):void{
        this.database.transaction(()=>{const r=this.getEconomicAction(eventId);if(!r||!['decided','applying'].includes(r.status))throw new Error('Economic action not applicable');
            this.assertEconomicActionAuthority(r.request,owner);this.reserveDecisionOperationalBudget(eventId,costGp,dailyLimit);
            this.database.run("UPDATE agent_economic_action SET status='applying' WHERE event_id=?1 AND status='decided'",[eventId]);}).immediate();
    }
    settleEconomicAction(eventId:string,status:'applied'|'waiting',reason:string,result:string|null=null):void{
        this.database.run("UPDATE agent_economic_action SET status=?2,reason=?3,result_json=?4 WHERE event_id=?1 AND status IN ('prepared','decided','applying')",[eventId,status,reason.slice(0,1000),result]);
    }

    getInstitutionStrategy(eventId: string): InstitutionStrategyRun | null {
        return readInstitutionStrategy(this.database, eventId);
    }

    pendingInstitutionStrategy(agentId: string): InstitutionStrategyRun | null {
        const row = this.database.query(`SELECT event_id FROM agent_institution_strategy WHERE agent_id=?1
            AND status IN ('prepared','inferring','decided','applying') ORDER BY rowid LIMIT 1`).get(normalizeAgentId(agentId)) as {event_id:string}|null;
        return row ? this.getInstitutionStrategy(row.event_id) : null;
    }

    assertInstitutionStrategyAuthority(request: InstitutionStrategyRequest, owner?: string, now = new Date().toISOString()): void {
        const profile = this.getControlProfile(request.agentId), enrollment = this.getAutonomyEnrollment(request.agentId);
        if (!profile || profile.role !== 'institution' || profile.subjectKind !== 'business' || profile.avatarPlayerUsername
            || profile.subjectId !== request.businessId || profile.revision !== request.profileRevision
            || this.getAutonomyControl().emergencyStop || !enrollment || enrollment.status !== 'running'
            || enrollment.policyId !== request.policyId || enrollment.policyVersion !== request.policyVersion
            || !enrollment.leaseExpiresAt || Date.parse(enrollment.leaseExpiresAt) <= Date.parse(now)
            || owner && enrollment.leaseOwner !== owner) throw new Error('Institution subject/profile/lease/stop authority changed');
    }

    prepareInstitutionStrategy(request: InstitutionStrategyRequest, llmCostMicros: number, owner?: string): InstitutionStrategyRun {
        this.database.transaction(() => {
            const prior = this.getInstitutionStrategy(request.eventId);
            if (prior) {
                if (prior.request.agentId !== request.agentId || prior.request.sourceKey !== request.sourceKey)
                    throw new Error('Institution event identity collision');
                return;
            }
            this.assertInstitutionStrategyAuthority(request, owner, request.observedAt);
            if (this.database.query(`SELECT 1 FROM agent_institution_strategy WHERE agent_id=?1
                AND (next_eligible_at>?2 OR status IN ('prepared','inferring','decided','applying'))`).get(request.agentId,request.observedAt))
                throw new Error('Institution cooldown or unresolved decision is active');
            const admitted = this.recordDecision(request.agentId,request.profileRevision,{decisionId:request.eventId,trigger:'event',
                contextDigest:request.contextDigest,llmCostMicros},request.observedAt);
            const interval = this.getControlProfile(request.agentId)!.decisionIntervalMs;
            this.database.run("INSERT INTO agent_institution_strategy VALUES(?1,?2,?3,'prepared',NULL,'',?4)",
                [request.eventId,request.agentId,JSON.stringify({...request,profileRevision:admitted.profile.revision}),new Date(Date.parse(request.observedAt)+Math.max(60000,interval)).toISOString()]);
        }).immediate();
        return this.getInstitutionStrategy(request.eventId)!;
    }

    claimInstitutionInference(eventId: string): boolean {
        return this.database.run("UPDATE agent_institution_strategy SET status='inferring' WHERE event_id=?1 AND status='prepared'",[eventId]).changes === 1;
    }

    finishInstitutionInference(eventId: string, plan: LlmPlanResult): InstitutionStrategyRun {
        const current = this.getInstitutionStrategy(eventId);
        if (!current || current.status !== 'inferring' || plan.runId !== eventId || plan.agentId !== current.request.agentId)
            throw new Error('Institution inference identity differs');
        const selected = plan.status === 'proposed' && plan.decision?.kind === 'choose-alternative'
            && current.request.input.businessAlternatives?.some(o=>o.optionId === (plan.decision as {optionId:string}).optionId);
        this.database.run("UPDATE agent_institution_strategy SET status=?2,plan_json=?3,reason=?4 WHERE event_id=?1 AND status='inferring'",
            [eventId,selected ? 'decided':plan.status==='failed' || plan.status==='stopped' ? 'inferring':'waiting',JSON.stringify(plan),plan.reason.slice(0,1000)]);
        return this.getInstitutionStrategy(eventId)!;
    }

    beginInstitutionApplication(eventId: string, costGp: number, dailyLimitGp: number, owner?: string, now = new Date().toISOString()): void {
        this.database.transaction(() => {
            const run = this.getInstitutionStrategy(eventId);
            if (!run || !['decided','applying'].includes(run.status)) throw new Error('Institution choice is not applicable');
            this.assertInstitutionStrategyAuthority(run.request,owner,now);
            this.reserveDecisionOperationalBudget(eventId,costGp,dailyLimitGp,now);
            this.database.run("UPDATE agent_institution_strategy SET status='applying' WHERE event_id=?1 AND status='decided'",[eventId]);
        }).immediate();
    }

    settleInstitutionStrategy(eventId: string, status: 'applied'|'waiting', reason: string): void {
        this.database.run(`UPDATE agent_institution_strategy SET status=?2,reason=?3 WHERE event_id=?1
            AND status IN ('prepared','decided','applying')`,[eventId,status,reason.slice(0,1000)]);
    }

    preparePlayerStrategy(request: PlayerStrategyRequest, profileRevision: number, llmCostMicros: number,
        proposalId: string, now: string): PlayerStrategyRun {
        this.database.transaction(() => {
            const prior = this.getPlayerStrategy(request.event.eventId);
            if (prior) {
                if (prior.request.agentId !== request.agentId || prior.request.event.sourceKey !== request.event.sourceKey)
                    throw new Error('Strategy event identity collision');
                return;
            }
            const cooling = this.database.query(`SELECT 1 FROM agent_player_strategy WHERE agent_id=?1 AND next_eligible_at>?2`)
                .get(request.agentId, now);
            if (cooling) throw new Error('Player strategy cooldown is active');
            this.recordDecision(request.agentId, profileRevision, { decisionId: request.event.eventId, trigger: 'event',
                contextDigest: request.contextDigest, llmCostMicros }, now);
            this.database.run(`INSERT INTO agent_player_strategy VALUES (?1,?2,?3,'prepared',NULL,?4,NULL,NULL,'',?5)`,
                [request.event.eventId, request.agentId, JSON.stringify(request), proposalId,
                    new Date(Date.parse(now) + PLAYER_STRATEGY_POLICY.cooldownMs).toISOString()]);
        }).immediate();
        return this.getPlayerStrategy(request.event.eventId)!;
    }

    claimPlayerStrategyInference(eventId: string): boolean {
        return this.database.run(`UPDATE agent_player_strategy SET status='inferring' WHERE event_id=?1 AND status='prepared'`,
            [eventId]).changes === 1;
    }

    finishPlayerStrategyInference(eventId: string, plan: LlmPlanResult): PlayerStrategyRun {
        const current = this.getPlayerStrategy(eventId);
        if (!current || current.status !== 'inferring' || plan.runId !== eventId || plan.agentId !== current.request.agentId)
            throw new Error('Strategy inference has no matching durable claim');
        const selected = plan.status === 'proposed' && plan.decision?.kind === 'choose-alternative'
            && current.request.options.some(o => o.optionId === (plan.decision as { optionId: string }).optionId);
        this.database.run(`UPDATE agent_player_strategy SET status=?2,plan_json=?3,reason=?4 WHERE event_id=?1 AND status='inferring'`,
            [eventId, selected ? 'decided' : 'waiting', JSON.stringify(plan), plan.reason.slice(0,1000)]);
        return this.getPlayerStrategy(eventId)!;
    }

    waitPlayerStrategy(eventId: string, reason: string): void {
        this.database.run(`UPDATE agent_player_strategy SET status='waiting',reason=?2
            WHERE event_id=?1 AND status NOT IN ('adopted','dispatched')`, [eventId, reason.slice(0,1000)]);
    }

    /** Called only by trusted gateway adapters, never with model/client-supplied observations. */
    evaluateGoalStates(agentId: string, observation: EconomicObservation, now = new Date().toISOString()): void {
        const transaction = this.database.transaction(() => {
            if (observation.agentId !== agentId || !/^[a-f0-9]{64}$/.test(observation.binding))
                throw new Error('State evidence agent/binding differs');
            const goals = this.listGoals(agentId, 'active').filter(g => g.objective).reverse();
            for (const g of goals) {
                const result = evaluateStateObjective(g.objective!, observation, now);
                const prior = this.database.query('SELECT source_binding,observed_at FROM agent_state_objective WHERE goal_id=?1')
                    .get(g.goalId) as { source_binding: string | null; observed_at: string | null };
                if ((prior.source_binding && prior.source_binding !== observation.binding)
                    || (prior.observed_at && prior.observed_at > observation.observedAt)) throw new Error('State evidence binding/time regressed');
                const existing = this.database.query(`SELECT 1 FROM agent_state_evaluation WHERE goal_id=?1 AND digest=?2`)
                    .get(g.goalId, result.digest);
                if (!existing) this.database.run(`INSERT INTO agent_state_evaluation
                    (goal_id,goal_revision,digest,result,observed_at,evaluated_at,observation_json) VALUES (?1,?2,?3,?4,?5,?6,?7)`,
                [g.goalId, g.revision, result.digest, result.result, result.observedAt, now, JSON.stringify(observation)]);
                this.database.run('UPDATE agent_state_objective SET source_binding=?2,observed_at=?3 WHERE goal_id=?1',
                    [g.goalId, observation.binding, observation.observedAt]);
                const children = this.listGoals(agentId, 'active').some(child => child.parentGoalId === g.goalId);
                if (!existing && !children && result.result === 'satisfied' && g.objective!.mode === 'achieve')
                    this.setGoalStatus(g.goalId, g.revision, 'completed', now);
            }
        });
        transaction.immediate();
    }

    /** Atomically adopts one bounded immediate plan inside an already-authored current objective.
     * Skill/envelope validation is supplied by the gateway; no new grant is created here. */
    adoptImmediateGoalProposal(proposalId: string, expectedRevision: number, input: {
        decisionId: string; binding: AgentSkillDispatch['binding']; scopeDigest: string;
        reservedGp: number; dailyLimitGp: number; policyId: string; policyVersion: string;
        leaseOwner?: string;
    }, now = new Date().toISOString()): AgentGoal {
        let adoptedGoal: AgentGoal | null = null;
        const transaction = this.database.transaction(() => {
            const prior = this.database.query('SELECT goal_id,scope_digest FROM agent_plan_adoption WHERE proposal_id=?1')
                .get(proposalId) as { goal_id: string; scope_digest: string } | null;
            if (prior) {
                if (prior.scope_digest !== input.scopeDigest) throw new Error('Adopted plan scope changed');
                adoptedGoal = this.requireGoal(prior.goal_id); return;
            }
            const proposal = this.getGoalProposal(proposalId);
            if (!proposal || proposal.status !== 'pending' || proposal.revision !== expectedRevision)
                throw new Error('Plan proposal changed before adoption');
            const parent = this.requireGoal(proposal.anchorGoalId);
            const enrollment = this.getAutonomyEnrollment(proposal.agentId);
            if (this.getAutonomyControl().emergencyStop || !enrollment || enrollment.status !== 'running'
                || !enrollment.leaseExpiresAt || enrollment.leaseExpiresAt <= now
                || (input.leaseOwner && enrollment.leaseOwner !== input.leaseOwner)
                || enrollment.policyId !== input.policyId || enrollment.policyVersion !== input.policyVersion)
                throw new Error('Plan adoption requires the current live autonomy policy lease');
            const age = Date.parse(now) - Date.parse(parent.stateEvaluation?.observedAt ?? '');
            if (parent.agentId !== proposal.agentId || parent.status !== 'active' || parent.horizon !== 'current'
                || parent.revision !== proposal.anchorGoalRevision || !parent.objective
                || parent.stateEvaluation?.result !== 'unsatisfied' || !Number.isFinite(age) || age < 0 || age > 5000)
                throw new Error('Plan parent revision/scope or fresh unsatisfied state changed');
            if (proposal.goals.length !== 1 || proposal.goals[0]!.horizon !== 'immediate'
                || proposal.goals[0]!.parentGoalId !== parent.goalId || !proposal.skill)
                throw new Error('Only one immediate child within the existing parent can be adopted');
            const occupied = this.listGoals(proposal.agentId, 'active').filter(g => g.horizon === 'immediate'
                && (g.parentGoalId === parent.goalId || parent.objective!.purpose !== 'self-care'));
            const replaceable = occupied.filter(g => g.parentGoalId === parent.goalId && g.stateEvaluation?.needsReplan
                && g.stateEvaluation.result === 'unsatisfied' && g.stateEvaluation.digest === parent.stateEvaluation!.digest);
            const strategy = this.getPlayerStrategy(proposal.runId);
            if (strategy?.status === 'decided' && strategy.proposalId === proposalId
                && strategy.request.parent.goalId === parent.goalId && strategy.request.parent.revision === parent.revision
                && strategy.plan?.decision?.kind === 'choose-alternative') {
                const selected = strategy.request.options.find(o => o.optionId === (strategy.plan!.decision as { optionId: string }).optionId);
                if (selected?.skill.id !== proposal.skill.id || selected.skill.version !== proposal.skill.version
                    || selected.binding.digest !== input.binding.digest) throw new Error('Strategy choice differs from adopted skill/binding');
                const previous = occupied.find(g => g.goalId === strategy.request.replaces?.goalId
                    && g.revision === strategy.request.replaces.revision && g.parentGoalId === parent.goalId);
                if (previous && !replaceable.some(g => g.goalId === previous.goalId)) replaceable.push(previous);
            }
            if (occupied.length !== replaceable.length || replaceable.length > 1)
                throw new Error('An active immediate plan already occupies this scope');
            for (const previous of replaceable) {
                if (this.database.query(`SELECT 1 FROM agent_skill_dispatch d LEFT JOIN agent_skill_outcome o
                    ON o.run_id=d.run_id WHERE d.goal_id=?1 AND o.run_id IS NULL`).get(previous.goalId))
                    throw new Error('Cannot replace a plan with an in-flight native run');
            }
            const known = this.getSkillKnowledge(proposal.agentId, proposal.skill);
            if (!known || known.status === 'blocked') throw new Error('Adopted skill is not learned');
            const decision = this.listDecisions(proposal.agentId).find(d => d.decisionId === input.decisionId);
            if (!decision || proposal.runId !== input.decisionId) throw new Error('Plan has no matching admitted decision');
            this.reserveDecisionOperationalBudget(input.decisionId, input.reservedGp, input.dailyLimitGp, now);
            for (const previous of replaceable) this.setGoalStatus(previous.goalId, previous.revision, 'blocked', now);
            const child = proposal.goals[0]!;
            const created = this.createGoal(proposal.agentId, { ...child, skill: proposal.skill,
                objective: { ...parent.objective, mode: 'achieve' },
                execution: { policy: 'one-shot', binding: input.binding } }, now);
            this.database.run(`INSERT INTO agent_plan_adoption VALUES (?1,?2,?3,?4,?5,?6,?7)`,
                [proposalId, created.goalId, input.decisionId, parent.revision, STATE_GOAL_POLICY, input.scopeDigest, now]);
            this.database.run(`UPDATE agent_goal_proposal SET status='completed',updated_at=?2,resolved_at=?2,
                response_note='Bounded immediate plan adopted; goal satisfaction requires native evidence',revision=revision+1
                WHERE proposal_id=?1`, [proposalId, now]);
            if (strategy?.status === 'decided') this.database.run(`UPDATE agent_player_strategy SET status='adopted',goal_id=?2
                WHERE event_id=?1 AND status='decided'`, [proposal.runId, created.goalId]);
            adoptedGoal = created;
        });
        transaction.immediate();
        return adoptedGoal!;
    }

    getGoal(goalId: string): AgentGoal | null {
        const normalized = normalizeAgentId(goalId, 'goalId');
        const row = this.database.query('SELECT * FROM agent_goal WHERE goal_id = ?1').get(normalized);
        return row ? this.withStateObjective(goal(row as GoalRow)) : null;
    }

    listGoals(agentId: string, status?: GoalStatus): AgentGoal[] {
        const normalized = normalizeAgentId(agentId);
        const rows = status
            ? this.database.query(`SELECT * FROM agent_goal WHERE agent_id = ?1 AND status = ?2
                ORDER BY CASE horizon WHEN 'life' THEN 0 WHEN 'long-term' THEN 1 WHEN 'current' THEN 2 ELSE 3 END,
                priority DESC, goal_id`).all(normalized, status)
            : this.database.query(`SELECT * FROM agent_goal WHERE agent_id = ?1
                ORDER BY CASE horizon WHEN 'life' THEN 0 WHEN 'long-term' THEN 1 WHEN 'current' THEN 2 ELSE 3 END,
                priority DESC, goal_id`).all(normalized);
        return (rows as GoalRow[]).map(row => this.withStateObjective(goal(row)));
    }

    getGoalExecution(goalId: string): AgentGoalExecution | null {
        const normalized = normalizeAgentId(goalId, 'goalId');
        const row = this.database.query('SELECT * FROM agent_goal_execution WHERE goal_id = ?1').get(normalized);
        if (!row) return null;
        const execution = goalExecution(row as GoalExecutionRow), objective = this.getGoal(normalized)?.objective;
        return objective ? { ...execution, completion: { kind: 'native-state', objective } } : execution;
    }

    recordSkillDispatch(input: Omit<AgentSkillDispatch, 'createdAt'>,
        now = new Date().toISOString()): AgentSkillDispatch {
        const runId = input.runId.toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId)) {
            throw new Error('Skill dispatch run ID is invalid');
        }
        const decisionId = normalizeAgentId(input.decisionId, 'decisionId');
        const agentId = normalizeAgentId(input.agentId);
        const goalId = normalizeAgentId(input.goalId, 'goalId');
        const skill = normalizeSkillReference(input.skill);
        const binding = createSkillParameterBinding(input.binding);
        if (binding.digest !== input.binding.digest) throw new Error('Skill parameter digest does not match parameters');
        const transaction = this.database.transaction(() => {
            const enrollment = this.getAutonomyEnrollment(agentId);
            const goalState = this.getGoal(goalId);
            const execution = this.getGoalExecution(goalId);
            if (!enrollment || enrollment.policyId !== input.policyId || enrollment.policyVersion !== input.policyVersion) {
                throw new Error('Skill dispatch policy does not match durable enrollment');
            }
            if (!goalState || goalState.agentId !== agentId || goalState.status !== 'active'
                || goalState.skill?.id !== skill.id || goalState.skill.version !== skill.version) {
                throw new Error('Skill dispatch goal is inactive or does not match the exact skill');
            }
            if (!execution) throw new Error('Autonomous skill dispatch requires a persisted goal execution policy');
            const adopted = this.database.query('SELECT parent_revision FROM agent_plan_adoption WHERE goal_id=?1')
                .get(goalId) as { parent_revision: number } | null;
            if (adopted) {
                const parent = goalState.parentGoalId ? this.getGoal(goalState.parentGoalId) : null;
                const pending = this.database.query(`SELECT 1 FROM agent_skill_dispatch d LEFT JOIN agent_skill_outcome o
                    ON o.run_id=d.run_id WHERE d.goal_id=?1 AND o.run_id IS NULL`).get(goalId);
                if (this.getAutonomyControl().emergencyStop || enrollment.status !== 'running'
                    || !enrollment.leaseExpiresAt || enrollment.leaseExpiresAt <= now
                    || !parent || parent.status !== 'active' || parent.revision !== adopted.parent_revision
                    || pending || goalState.stateEvaluation?.needsReplan || execution.binding.digest !== binding.digest)
                    throw new Error('Adopted plan dispatch lease, parent, binding or pending run changed');
            }
            if (execution.nextEligibleAt && execution.nextEligibleAt > now) throw new Error('Goal execution cooldown is active');
            const decision = this.database.query(`SELECT decision_id FROM agent_decision_ledger
                WHERE decision_id = ?1 AND agent_id = ?2`).get(decisionId, agentId);
            if (!decision) throw new Error('Skill dispatch requires an admitted decision record');
            this.database.run(`INSERT INTO agent_skill_dispatch
                (run_id, decision_id, agent_id, goal_id, skill_id, skill_version, parameter_source_kind,
                parameter_source_id, parameters, parameter_digest, policy_id, policy_version, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
            [runId, decisionId, agentId, goalId, skill.id, skill.version, binding.sourceKind, binding.sourceId,
                JSON.stringify(binding.parameters), binding.digest, input.policyId, input.policyVersion, now]);
            const strategy = this.getPlayerStrategy(decisionId);
            if (strategy) {
                if (strategy.status !== 'adopted' || strategy.goalId !== goalId) throw new Error('Strategy dispatch is not bound to its adopted plan');
                this.database.run(`UPDATE agent_player_strategy SET status='dispatched',run_id=?2 WHERE event_id=?1`, [decisionId, runId]);
            }
        });
        transaction.immediate();
        return this.getSkillDispatch(runId)!;
    }

    getSkillDispatch(runId: string): AgentSkillDispatch | null {
        const row = this.database.query('SELECT * FROM agent_skill_dispatch WHERE run_id = ?1').get(runId.toLowerCase());
        return row ? skillDispatch(row as SkillDispatchRow) : null;
    }

    listSkillDispatches(agentId: string, limit = 500): AgentSkillDispatch[] {
        const normalized = normalizeAgentId(agentId);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Skill dispatch limit is invalid');
        return (this.database.query(`SELECT * FROM agent_skill_dispatch WHERE agent_id = ?1
            ORDER BY created_at DESC, run_id DESC LIMIT ?2`).all(normalized, limit) as SkillDispatchRow[])
            .map(skillDispatch);
    }

    getSkillRunOutcome(runId: string): AgentSkillRunOutcome | null {
        const row = this.database.query('SELECT * FROM agent_skill_outcome WHERE run_id = ?1').get(runId.toLowerCase());
        return row ? skillOutcome(row as SkillOutcomeRow) : null;
    }

    listFailedSkillReferencesForGoal(goalId: string, limit = 20): AgentSkillReference[] {
        const normalized = normalizeAgentId(goalId, 'goalId');
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Failed skill history limit is invalid');
        const rows = this.database.query(`SELECT d.skill_id, d.skill_version
            FROM agent_skill_dispatch d JOIN agent_skill_outcome o ON o.run_id = d.run_id
            WHERE d.goal_id = ?1 AND o.classification != 'completed'
            ORDER BY o.occurred_at DESC, d.run_id DESC LIMIT ?2`).all(normalized, limit) as
            Array<{ skill_id: string; skill_version: string }>;
        const seen = new Set<string>();
        return rows.flatMap(row => {
            const key = `${row.skill_id}@${row.skill_version}`;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{ id: row.skill_id, version: row.skill_version }];
        });
    }

    recordSkillRunOutcome(runIdInput: string, status: AgentSkillRunOutcome['status'],
        classification: AgentSkillRunOutcomeClassification, detailInput: string,
        now = new Date().toISOString()): { outcome: AgentSkillRunOutcome; goal: AgentGoal; created: boolean } {
        const runId = runIdInput.toLowerCase();
        const detail = detailInput.replace(/\s+/g, ' ').trim().slice(0, 1_000);
        if (!['completed', 'failed', 'cancelled', 'limit-reached'].includes(status)) throw new Error('Invalid skill outcome status');
        if (!['completed', 'acquire-input', 'retry', 'capability-gap', 'authorization'].includes(classification)) {
            throw new Error('Invalid skill outcome classification');
        }
        if ((status === 'completed') !== (classification === 'completed')) {
            throw new Error('Completed skill status and outcome classification must match');
        }
        let created = false;
        let goalState: AgentGoal | null = null;
        const transaction = this.database.transaction(() => {
            const existing = this.getSkillRunOutcome(runId);
            const dispatch = this.getSkillDispatch(runId);
            if (!dispatch) throw new Error('Skill outcome has no durable dispatch record');
            if (existing) { goalState = this.requireGoal(dispatch.goalId); return; }
            this.database.run(`INSERT INTO agent_skill_outcome
                (run_id, status, classification, detail, occurred_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
            [runId, status, classification, detail, now]);
            created = true;
            const execution = this.getGoalExecution(dispatch.goalId);
            const current = this.requireGoal(dispatch.goalId);
            if (!execution || current.status !== 'active') { goalState = current; return; }
            const successfulRuns = execution.progress.successfulRuns + (status === 'completed' ? 1 : 0);
            const completes = !current.objective && status === 'completed' && execution.policy === 'one-shot'
                && execution.completion.kind === 'successful-skill-runs' && successfulRuns >= execution.completion.required;
            const nextEligibleAt = execution.policy === 'recurring' || current.objective
                ? new Date(Date.parse(now) + Math.max(execution.cooldownMs, current.objective ? 1000 : 0)).toISOString() : null;
            this.database.run(`UPDATE agent_goal_execution SET successful_runs = ?2, next_eligible_at = ?3,
                last_run_id = ?4, updated_at = ?5, revision = revision + 1 WHERE goal_id = ?1`,
            [dispatch.goalId, successfulRuns, nextEligibleAt, runId, now]);
            if (completes) {
                this.database.run(`UPDATE agent_goal SET status = 'completed', updated_at = ?3,
                    completed_at = ?3, revision = revision + 1 WHERE goal_id = ?1 AND revision = ?2`,
                [current.goalId, current.revision, now]);
                this.database.run(`INSERT INTO agent_goal_event
                    (goal_id, agent_id, kind, previous_status, status, previous_revision, revision,
                    skill_id, skill_version, occurred_at)
                    VALUES (?1, ?2, 'status-changed', 'active', 'completed', ?3, ?4, ?5, ?6, ?7)`,
                [current.goalId, current.agentId, current.revision, current.revision + 1,
                    current.skill?.id ?? null, current.skill?.version ?? null, now]);
                this.bindGoalEvent(current.goalId, current.revision + 1, 'status-changed');
            }
            goalState = this.requireGoal(dispatch.goalId);
        });
        transaction.immediate();
        return { outcome: this.getSkillRunOutcome(runId)!, goal: goalState!, created };
    }

    listGoalEvents(agentId: string, since?: string, until?: string): AgentGoalEvent[] {
        const normalized = normalizeAgentId(agentId);
        if (since && Number.isNaN(Date.parse(since))) throw new Error('Goal event start time must be an ISO timestamp');
        if (until && Number.isNaN(Date.parse(until))) throw new Error('Goal event end time must be an ISO timestamp');
        if (since && until && since > until) throw new Error('Goal event time range is invalid');
        const rows = this.database.query(`SELECT * FROM agent_goal_event WHERE agent_id = ?1
            AND (?2 IS NULL OR occurred_at >= ?2) AND (?3 IS NULL OR occurred_at <= ?3)
            ORDER BY occurred_at, sequence`).all(normalized, since ?? null, until ?? null);
        return (rows as GoalEventRow[]).map(goalEvent);
    }

    setGoalSkill(agentId: string, goalId: string, expectedRevision: number,
        skill: AgentSkillReference, now = new Date().toISOString()): AgentGoal {
        const normalizedAgentId = normalizeAgentId(agentId);
        const normalizedGoalId = normalizeAgentId(goalId, 'goalId');
        const normalizedSkill = normalizeSkillReference(skill);
        if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error('Goal revision is invalid');
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            const current = this.getGoal(normalizedGoalId);
            if (!current || current.agentId !== normalizedAgentId) throw new Error('Goal must belong to the same agent');
            if (current.horizon !== 'immediate' || current.status !== 'active') {
                throw new Error('Only an active immediate goal may receive an executable skill');
            }
            const result = this.database.run(`UPDATE agent_goal SET skill_id = ?4, skill_version = ?5,
                updated_at = ?6, revision = revision + 1 WHERE goal_id = ?1 AND agent_id = ?2 AND revision = ?3`,
            [normalizedGoalId, normalizedAgentId, expectedRevision, normalizedSkill.id, normalizedSkill.version, now]);
            if (result.changes !== 1) throw new Error('Agent goal changed before skill assignment; refresh and try again');
            this.database.run(`INSERT INTO agent_goal_event
                (goal_id, agent_id, kind, previous_status, status, previous_revision, revision,
                skill_id, skill_version, occurred_at)
                VALUES (?1, ?2, 'skill-assigned', ?3, ?3, ?4, ?5, ?6, ?7, ?8)`,
            [current.goalId, current.agentId, current.status, current.revision, current.revision + 1,
                normalizedSkill.id, normalizedSkill.version, now]);
            this.bindGoalEvent(current.goalId, current.revision + 1, 'skill-assigned');
        });
        transaction.immediate();
        return this.getGoal(normalizedGoalId)!;
    }

    setWorkingMemory(agentId: string, expectedRevision: number | null, input: SetAgentWorkingMemory,
        now = new Date().toISOString()): AgentWorkingMemory {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateWorkingMemory(input);
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            const existing = this.getWorkingMemory(normalizedAgentId);
            if (!existing) {
                if (expectedRevision !== null) throw new Error('Working memory changed before update; refresh and try again');
                this.database.run(`INSERT INTO agent_working_memory
                    (agent_id, summary, current_activity, location, observations, observed_at, updated_at, revision)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)`, [normalizedAgentId, value.summary,
                    value.currentActivity, value.location ? JSON.stringify(value.location) : null,
                    JSON.stringify(value.observations), value.observedAt, now]);
                return;
            }
            if (expectedRevision === null || existing.revision !== expectedRevision) {
                throw new Error('Working memory changed before update; refresh and try again');
            }
            const result = this.database.run(`UPDATE agent_working_memory SET summary = ?3, current_activity = ?4,
                location = ?5, observations = ?6, observed_at = ?7, updated_at = ?8, revision = revision + 1
                WHERE agent_id = ?1 AND revision = ?2`, [normalizedAgentId, expectedRevision, value.summary,
                value.currentActivity, value.location ? JSON.stringify(value.location) : null,
                JSON.stringify(value.observations), value.observedAt, now]);
            if (result.changes !== 1) throw new Error('Working memory changed before update; refresh and try again');
        });
        transaction.immediate();
        return this.getWorkingMemory(normalizedAgentId)!;
    }

    getWorkingMemory(agentId: string): AgentWorkingMemory | null {
        const normalized = normalizeAgentId(agentId);
        const row = this.database.query('SELECT * FROM agent_working_memory WHERE agent_id = ?1').get(normalized);
        return row ? workingMemory(row as WorkingMemoryRow) : null;
    }

    setSkillKnowledge(agentId: string, skill: AgentSkillReference, status: AgentSkillKnowledgeStatus,
        expectedRevision: number | null, now = new Date().toISOString()): AgentSkillKnowledge {
        const normalizedAgentId = normalizeAgentId(agentId);
        const normalizedSkill = normalizeSkillReference(skill);
        const normalizedStatus = validateSkillKnowledgeStatus(status);
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            const existing = this.getSkillKnowledge(normalizedAgentId, normalizedSkill);
            if (!existing) {
                if (expectedRevision !== null) throw new Error('Agent skill knowledge changed before update; refresh and try again');
                this.database.run(`INSERT INTO agent_skill_knowledge
                    (agent_id, skill_id, skill_version, status, learned_at, updated_at, revision)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?5, 1)`,
                [normalizedAgentId, normalizedSkill.id, normalizedSkill.version, normalizedStatus, now]);
                return;
            }
            if (expectedRevision === null || existing.revision !== expectedRevision) {
                throw new Error('Agent skill knowledge changed before update; refresh and try again');
            }
            const result = this.database.run(`UPDATE agent_skill_knowledge SET status = ?5, updated_at = ?6,
                revision = revision + 1 WHERE agent_id = ?1 AND skill_id = ?2 AND skill_version = ?3 AND revision = ?4`,
            [normalizedAgentId, normalizedSkill.id, normalizedSkill.version, expectedRevision, normalizedStatus, now]);
            if (result.changes !== 1) throw new Error('Agent skill knowledge changed before update; refresh and try again');
        });
        transaction.immediate();
        return this.getSkillKnowledge(normalizedAgentId, normalizedSkill)!;
    }

    getSkillKnowledge(agentId: string, skill: AgentSkillReference): AgentSkillKnowledge | null {
        const normalizedAgentId = normalizeAgentId(agentId);
        const normalizedSkill = normalizeSkillReference(skill);
        const row = this.database.query(`SELECT * FROM agent_skill_knowledge
            WHERE agent_id = ?1 AND skill_id = ?2 AND skill_version = ?3`)
            .get(normalizedAgentId, normalizedSkill.id, normalizedSkill.version);
        return row ? skillKnowledge(row as SkillKnowledgeRow) : null;
    }

    listSkillKnowledge(agentId: string): AgentSkillKnowledge[] {
        const normalized = normalizeAgentId(agentId);
        return (this.database.query(`SELECT * FROM agent_skill_knowledge WHERE agent_id = ?1
            ORDER BY skill_id, skill_version`).all(normalized) as SkillKnowledgeRow[]).map(skillKnowledge);
    }

    createEpisode(agentId: string, input: CreateAgentEpisode,
        createdAt = new Date().toISOString()): AgentEpisode {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateCreateEpisode(input);
        let existing: AgentEpisode | null = null;
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            for (const goalId of value.goalIds) {
                const goal = this.getGoal(goalId);
                if (!goal || goal.agentId !== normalizedAgentId) {
                    throw new Error(`Episode goal must belong to the same agent: ${goalId}`);
                }
            }
            if (value.externalKey) {
                const row = this.database.query(`SELECT * FROM agent_episode
                    WHERE agent_id = ?1 AND external_key = ?2`).get(normalizedAgentId, value.externalKey) as EpisodeRow | null;
                if (row) {
                    existing = episode(row);
                    if (existing.kind !== value.kind || existing.summary !== value.summary
                        || existing.details !== value.details || existing.importance !== value.importance
                        || JSON.stringify(existing.goalIds) !== JSON.stringify(value.goalIds)
                        || JSON.stringify(existing.actors) !== JSON.stringify(value.actors)
                        || JSON.stringify(existing.tags) !== JSON.stringify(value.tags)
                        || existing.source !== value.source || existing.trust !== value.trust
                        || existing.occurredAt !== value.occurredAt || existing.expiresAt !== value.expiresAt) {
                        throw new Error(`Episode external key collision: ${value.externalKey}`);
                    }
                    return;
                }
            }
            this.database.run(`INSERT INTO agent_episode
                (episode_id, agent_id, kind, summary, details, importance, goal_ids, actors, tags, source, trust,
                external_key, occurred_at, expires_at, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
            [value.episodeId, normalizedAgentId, value.kind, value.summary, value.details, value.importance,
                JSON.stringify(value.goalIds), JSON.stringify(value.actors), JSON.stringify(value.tags), value.source,
                value.trust, value.externalKey, value.occurredAt, value.expiresAt, createdAt]);
        });
        transaction.immediate();
        return existing ?? this.requireEpisode(value.episodeId);
    }

    getEpisode(episodeId: string): AgentEpisode | null {
        const normalized = normalizeAgentId(episodeId, 'episodeId');
        const row = this.database.query('SELECT * FROM agent_episode WHERE episode_id = ?1').get(normalized);
        return row ? episode(row as EpisodeRow) : null;
    }

    getEpisodeByExternalKey(agentId: string, externalKey: string): AgentEpisode | null {
        const normalized = normalizeAgentId(agentId);
        if (!externalKey || externalKey.length > 160) throw new Error('Episode external key must contain at most 160 characters');
        const row = this.database.query(`SELECT * FROM agent_episode
            WHERE agent_id = ?1 AND external_key = ?2`).get(normalized, externalKey);
        return row ? episode(row as EpisodeRow) : null;
    }

    listEpisodes(agentId: string, options: AgentEpisodeListOptions = {}): AgentEpisode[] {
        const normalized = normalizeAgentId(agentId);
        const limit = options.limit ?? 100;
        const offset = options.offset ?? 0;
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Episode limit must be from 1 to 500');
        if (!Number.isInteger(offset) || offset < 0) throw new Error('Episode offset must be a non-negative integer');
        const rows = options.kind
            ? this.database.query(`SELECT * FROM agent_episode WHERE agent_id = ?1 AND kind = ?2
                ORDER BY occurred_at DESC, episode_id LIMIT ?3 OFFSET ?4`).all(normalized, options.kind, limit, offset)
            : this.database.query(`SELECT * FROM agent_episode WHERE agent_id = ?1
                ORDER BY occurred_at DESC, episode_id LIMIT ?2 OFFSET ?3`).all(normalized, limit, offset);
        return (rows as EpisodeRow[]).map(episode);
    }

    countEpisodes(agentId: string): number {
        const normalized = normalizeAgentId(agentId);
        return (this.database.query('SELECT COUNT(*) AS count FROM agent_episode WHERE agent_id = ?1')
            .get(normalized) as { count: number }).count;
    }

    previewEpisodeRetention(agentId: string, asOf = new Date().toISOString(), limit = 500): AgentEpisodeRetentionPreview {
        const normalized = normalizeAgentId(agentId);
        if (Number.isNaN(Date.parse(asOf))) throw new Error('Retention cutoff must be an ISO timestamp');
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Retention preview limit must be from 1 to 500');
        this.requireIdentity(normalized);
        const archived = !!this.getPopulationDeath(normalized) || this.getCharacterLifecycle(normalized)?.status==='deceased';
        const expiredCount = (this.database.query(`SELECT COUNT(*) AS count FROM agent_episode
            WHERE agent_id = ?1 AND expires_at IS NOT NULL AND expires_at <= ?2`)
            .get(normalized, asOf) as { count: number }).count;
        const rows = this.database.query(`SELECT e.*,
            EXISTS (SELECT 1 FROM agent_semantic_memory k, json_each(k.evidence_episode_ids) j
                WHERE k.agent_id = e.agent_id AND j.value = e.episode_id) AS semantic_ref,
            EXISTS (SELECT 1 FROM agent_relationship r, json_each(r.evidence_episode_ids) j
                WHERE r.agent_id = e.agent_id AND j.value = e.episode_id) AS relationship_ref,
            EXISTS (SELECT 1 FROM agent_commitment c, json_each(c.evidence_episode_ids) j
                WHERE c.agent_id = e.agent_id AND j.value = e.episode_id) AS commitment_ref,
            EXISTS (SELECT 1 FROM agent_consolidation_evidence ce
                WHERE ce.agent_id = e.agent_id AND ce.episode_id = e.episode_id) AS consolidation_ref
            FROM agent_episode e WHERE e.agent_id = ?1 AND e.expires_at IS NOT NULL AND e.expires_at <= ?2
            ORDER BY e.expires_at, e.episode_id LIMIT ?3`)
            .all(normalized, asOf, limit) as EpisodeRetentionRow[];
        const candidates = rows.map(row => {
            const reasons: AgentEpisodeProtectionReason[] = [];
            if (archived) reasons.push('population-archive');
            if (row.semantic_ref) reasons.push('semantic-evidence');
            if (row.relationship_ref) reasons.push('relationship-evidence');
            if (row.commitment_ref) reasons.push('commitment-evidence');
            if (row.consolidation_ref) reasons.push('consolidation-evidence');
            if (row.external_key) reasons.push('external-source');
            return { episodeId: row.episode_id, occurredAt: row.occurred_at, expiresAt: row.expires_at!,
                protectionReasons: reasons, eligible: reasons.length === 0 };
        });
        const eligibleCount = candidates.filter(candidate => candidate.eligible).length;
        return { agentId: normalized, asOf, expiredCount, eligibleCount,
            protectedCount: candidates.length - eligibleCount, truncated: expiredCount > candidates.length, candidates };
    }

    pruneExpiredEpisodes(agentId: string, asOf = new Date().toISOString(), limit = 500): AgentEpisodePruneResult {
        let preview!: AgentEpisodeRetentionPreview;
        const deletedEpisodeIds: string[] = [];
        const transaction = this.database.transaction(() => {
            preview = this.previewEpisodeRetention(agentId, asOf, limit);
            for (const candidate of preview.candidates) {
                if (!candidate.eligible) continue;
                const result = this.database.run(`DELETE FROM agent_episode
                    WHERE agent_id = ?1 AND episode_id = ?2 AND expires_at IS NOT NULL AND expires_at <= ?3`,
                [preview.agentId, candidate.episodeId, asOf]);
                if (result.changes === 1) deletedEpisodeIds.push(candidate.episodeId);
            }
        });
        transaction.immediate();
        return { ...preview, deletedEpisodeIds };
    }

    recordConsolidationEvidence(agentId: string, input: CreateAgentConsolidationEvidence,
        createdAt = new Date().toISOString()): { evidence: AgentConsolidationEvidence; created: boolean } {
        const normalizedAgentId = normalizeAgentId(agentId);
        if (!input.ruleKey || input.ruleKey.length > 100 || !/^[a-z0-9.-]+$/.test(input.ruleKey)) {
            throw new Error('Consolidation rule key must be a stable identifier of at most 100 characters');
        }
        if (!input.evidenceKey || input.evidenceKey.length > 160) {
            throw new Error('Consolidation evidence key must contain at most 160 characters');
        }
        if (Number.isNaN(Date.parse(input.occurredAt))) throw new Error('Consolidation evidence time must be an ISO timestamp');
        let created = false;
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            const source = this.getEpisode(input.episodeId);
            if (!source || source.agentId !== normalizedAgentId) {
                throw new Error('Consolidation evidence episode must belong to the same agent');
            }
            const row = this.database.query(`SELECT * FROM agent_consolidation_evidence
                WHERE agent_id = ?1 AND rule_key = ?2 AND evidence_key = ?3`)
                .get(normalizedAgentId, input.ruleKey, input.evidenceKey) as ConsolidationEvidenceRow | null;
            if (row) {
                if (row.episode_id !== input.episodeId || row.occurred_at !== input.occurredAt) {
                    throw new Error(`Consolidation evidence key collision: ${input.evidenceKey}`);
                }
                return;
            }
            this.database.run(`INSERT INTO agent_consolidation_evidence
                (agent_id, rule_key, evidence_key, episode_id, occurred_at, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
            [normalizedAgentId, input.ruleKey, input.evidenceKey, input.episodeId, input.occurredAt, createdAt]);
            created = true;
        });
        transaction.immediate();
        const evidence = this.database.query(`SELECT * FROM agent_consolidation_evidence
            WHERE agent_id = ?1 AND rule_key = ?2 AND evidence_key = ?3`)
            .get(normalizedAgentId, input.ruleKey, input.evidenceKey) as ConsolidationEvidenceRow;
        return { evidence: consolidationEvidence(evidence), created };
    }

    listConsolidationEvidence(agentId: string, ruleKey: string, limit = 20): AgentConsolidationEvidence[] {
        const normalized = normalizeAgentId(agentId);
        if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Consolidation evidence limit must be from 1 to 20');
        return (this.database.query(`SELECT * FROM agent_consolidation_evidence
            WHERE agent_id = ?1 AND rule_key = ?2 ORDER BY occurred_at, evidence_key LIMIT ?3`)
            .all(normalized, ruleKey, limit) as ConsolidationEvidenceRow[]).map(consolidationEvidence);
    }

    listRecentConsolidationEvidence(agentId: string, ruleKey: string, limit = 20): AgentConsolidationEvidence[] {
        const normalized = normalizeAgentId(agentId);
        if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Consolidation evidence limit must be from 1 to 20');
        return (this.database.query(`SELECT * FROM agent_consolidation_evidence
            WHERE agent_id = ?1 AND rule_key = ?2 ORDER BY occurred_at DESC, evidence_key DESC LIMIT ?3`)
            .all(normalized, ruleKey, limit) as ConsolidationEvidenceRow[]).map(consolidationEvidence).reverse();
    }

    countConsolidationEvidence(agentId: string, ruleKey: string): number {
        const normalized = normalizeAgentId(agentId);
        return (this.database.query(`SELECT COUNT(*) AS count FROM agent_consolidation_evidence
            WHERE agent_id = ?1 AND rule_key = ?2`).get(normalized, ruleKey) as { count: number }).count;
    }

    hasConsolidationEvidence(agentId: string, ruleKey: string, episodeId: string): boolean {
        const normalized = normalizeAgentId(agentId);
        return !!this.database.query(`SELECT 1 FROM agent_consolidation_evidence
            WHERE agent_id = ?1 AND rule_key = ?2 AND episode_id = ?3 LIMIT 1`).get(normalized, ruleKey, episodeId);
    }

    createKnowledge(agentId: string, input: CreateAgentKnowledge,
        now = new Date().toISOString()): AgentKnowledge {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateCreateKnowledge(input);
        let existing: AgentKnowledge | null = null;
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            if (value.externalKey) {
                const row = this.database.query(`SELECT * FROM agent_semantic_memory
                    WHERE agent_id = ?1 AND external_key = ?2`).get(normalizedAgentId, value.externalKey) as KnowledgeRow | null;
                if (row) {
                    existing = knowledge(row);
                    if (existing.kind !== value.kind || existing.subject !== value.subject
                        || existing.predicate !== value.predicate || existing.object !== value.object
                        || existing.summary !== value.summary || existing.confidence !== value.confidence
                        || JSON.stringify(existing.goalIds) !== JSON.stringify(value.goalIds)
                        || JSON.stringify(existing.tags) !== JSON.stringify(value.tags)
                        || JSON.stringify(existing.evidenceEpisodeIds) !== JSON.stringify(value.evidenceEpisodeIds)
                        || existing.source !== value.source || existing.supersedesId !== value.supersedesId
                        || existing.validFrom !== value.validFrom || existing.validUntil !== value.validUntil) {
                        throw new Error(`Knowledge external key collision: ${value.externalKey}`);
                    }
                    return;
                }
            }
            for (const goalId of value.goalIds) {
                const goal = this.getGoal(goalId);
                if (!goal || goal.agentId !== normalizedAgentId) {
                    throw new Error(`Knowledge goal must belong to the same agent: ${goalId}`);
                }
            }
            for (const episodeId of value.evidenceEpisodeIds) {
                const evidence = this.getEpisode(episodeId);
                if (!evidence || evidence.agentId !== normalizedAgentId) {
                    throw new Error(`Knowledge evidence must belong to the same agent: ${episodeId}`);
                }
            }
            if (value.supersedesId) {
                const previous = this.getKnowledge(value.supersedesId);
                if (!previous || previous.agentId !== normalizedAgentId) {
                    throw new Error('Superseded knowledge must belong to the same agent');
                }
                if (previous.status !== 'active') throw new Error('Only active knowledge can be superseded');
                if (previous.subject.toLocaleLowerCase('en-US') !== value.subject.toLocaleLowerCase('en-US')
                    || previous.predicate.toLocaleLowerCase('en-US') !== value.predicate.toLocaleLowerCase('en-US')) {
                    throw new Error('Superseding knowledge must keep the same subject and predicate');
                }
                const updated = this.database.run(`UPDATE agent_semantic_memory SET status = 'superseded',
                    updated_at = ?2, revision = revision + 1 WHERE knowledge_id = ?1 AND status = 'active'`,
                [previous.knowledgeId, now]);
                if (updated.changes !== 1) throw new Error('Knowledge changed before supersession; refresh and try again');
            }
            this.database.run(`INSERT INTO agent_semantic_memory
                (knowledge_id, agent_id, kind, subject, predicate, object, summary, confidence, goal_ids, tags,
                evidence_episode_ids, source, status, supersedes_id, external_key, valid_from, valid_until,
                created_at, updated_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', ?13, ?14, ?15, ?16, ?17, ?17, 1)`,
            [value.knowledgeId, normalizedAgentId, value.kind, value.subject, value.predicate, value.object,
                value.summary, value.confidence, JSON.stringify(value.goalIds), JSON.stringify(value.tags),
                JSON.stringify(value.evidenceEpisodeIds), value.source, value.supersedesId, value.externalKey,
                value.validFrom, value.validUntil, now]);
        });
        transaction.immediate();
        return existing ?? this.requireKnowledge(value.knowledgeId);
    }

    getKnowledge(knowledgeId: string): AgentKnowledge | null {
        const normalized = normalizeAgentId(knowledgeId, 'knowledgeId');
        const row = this.database.query('SELECT * FROM agent_semantic_memory WHERE knowledge_id = ?1').get(normalized);
        return row ? knowledge(row as KnowledgeRow) : null;
    }

    listKnowledge(agentId: string, options: AgentKnowledgeListOptions = {}): AgentKnowledge[] {
        const normalized = normalizeAgentId(agentId);
        const limit = options.limit ?? 100;
        const offset = options.offset ?? 0;
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Knowledge limit must be from 1 to 500');
        if (!Number.isInteger(offset) || offset < 0) throw new Error('Knowledge offset must be a non-negative integer');
        let rows: unknown[];
        if (options.status && options.kind) rows = this.database.query(`SELECT * FROM agent_semantic_memory
            WHERE agent_id = ?1 AND status = ?2 AND kind = ?3
            ORDER BY updated_at DESC, knowledge_id LIMIT ?4 OFFSET ?5`)
            .all(normalized, options.status, options.kind, limit, offset);
        else if (options.status) rows = this.database.query(`SELECT * FROM agent_semantic_memory
            WHERE agent_id = ?1 AND status = ?2 ORDER BY updated_at DESC, knowledge_id LIMIT ?3 OFFSET ?4`)
            .all(normalized, options.status, limit, offset);
        else if (options.kind) rows = this.database.query(`SELECT * FROM agent_semantic_memory
            WHERE agent_id = ?1 AND kind = ?2 ORDER BY updated_at DESC, knowledge_id LIMIT ?3 OFFSET ?4`)
            .all(normalized, options.kind, limit, offset);
        else rows = this.database.query(`SELECT * FROM agent_semantic_memory WHERE agent_id = ?1
            ORDER BY updated_at DESC, knowledge_id LIMIT ?2 OFFSET ?3`).all(normalized, limit, offset);
        return (rows as KnowledgeRow[]).map(knowledge);
    }

    countKnowledge(agentId: string): number {
        const normalized = normalizeAgentId(agentId);
        return (this.database.query('SELECT COUNT(*) AS count FROM agent_semantic_memory WHERE agent_id = ?1')
            .get(normalized) as { count: number }).count;
    }

    setRelationship(agentId: string, expectedRevision: number | null, input: SetAgentRelationship,
        now = new Date().toISOString()): AgentRelationship {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateRelationship(input);
        const transaction = this.database.transaction(() => {
            const identity = this.requireIdentity(normalizedAgentId);
            if (value.actorKey === identity.agentId || value.actorKey === identity.playerUsername) {
                throw new Error('An agent cannot have a social relationship with itself');
            }
            for (const episodeId of value.evidenceEpisodeIds) {
                const evidence = this.getEpisode(episodeId);
                if (!evidence || evidence.agentId !== normalizedAgentId) {
                    throw new Error(`Relationship evidence must belong to the same agent: ${episodeId}`);
                }
            }
            const current = this.getRelationship(normalizedAgentId, value.actorKey);
            if (!current) {
                if (expectedRevision !== null) throw new Error('Relationship changed before update; refresh and try again');
                this.database.run(`INSERT INTO agent_relationship
                    (agent_id, actor_key, display_name, trust, affinity, familiarity, agent_owes_gp, actor_owes_gp,
                    notes, tags, evidence_episode_ids, last_interaction_at, created_at, updated_at, revision)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, 1)`,
                [normalizedAgentId, value.actorKey, value.displayName, value.trust, value.affinity, value.familiarity,
                    value.agentOwesGp, value.actorOwesGp, value.notes, JSON.stringify(value.tags),
                    JSON.stringify(value.evidenceEpisodeIds), value.lastInteractionAt, now]);
                return;
            }
            if (expectedRevision === null || current.revision !== expectedRevision) {
                throw new Error('Relationship changed before update; refresh and try again');
            }
            const result = this.database.run(`UPDATE agent_relationship SET display_name = ?4, trust = ?5,
                affinity = ?6, familiarity = ?7, agent_owes_gp = ?8, actor_owes_gp = ?9, notes = ?10,
                tags = ?11, evidence_episode_ids = ?12, last_interaction_at = ?13, updated_at = ?14,
                revision = revision + 1 WHERE agent_id = ?1 AND actor_key = ?2 AND revision = ?3`,
            [normalizedAgentId, value.actorKey, expectedRevision, value.displayName, value.trust, value.affinity,
                value.familiarity, value.agentOwesGp, value.actorOwesGp, value.notes, JSON.stringify(value.tags),
                JSON.stringify(value.evidenceEpisodeIds), value.lastInteractionAt, now]);
            if (result.changes !== 1) throw new Error('Relationship changed before update; refresh and try again');
        });
        transaction.immediate();
        return this.getRelationship(normalizedAgentId, value.actorKey)!;
    }

    getRelationship(agentId: string, actorKey: string): AgentRelationship | null {
        const normalizedAgentId = normalizeAgentId(agentId);
        const normalizedActor = normalizeActorKey(actorKey);
        const row = this.database.query(`SELECT * FROM agent_relationship
            WHERE agent_id = ?1 AND actor_key = ?2`).get(normalizedAgentId, normalizedActor);
        return row ? relationship(row as RelationshipRow) : null;
    }

    listRelationships(agentId: string): AgentRelationship[] {
        const normalized = normalizeAgentId(agentId);
        return (this.database.query(`SELECT * FROM agent_relationship WHERE agent_id = ?1
            ORDER BY familiarity DESC, updated_at DESC, actor_key`).all(normalized) as RelationshipRow[]).map(relationship);
    }

    createCommitment(agentId: string, input: CreateAgentCommitment,
        now = new Date().toISOString()): AgentCommitment {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateCreateCommitment(input);
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            if (!this.getRelationship(normalizedAgentId, value.actorKey)) {
                throw new Error('Commitment requires an existing relationship');
            }
            for (const episodeId of value.evidenceEpisodeIds) {
                const evidence = this.getEpisode(episodeId);
                if (!evidence || evidence.agentId !== normalizedAgentId) {
                    throw new Error(`Commitment evidence must belong to the same agent: ${episodeId}`);
                }
            }
            this.database.run(`INSERT INTO agent_commitment
                (commitment_id, agent_id, actor_key, direction, description, status, value_gp, due_at,
                evidence_episode_ids, created_at, updated_at, resolved_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?7, ?8, ?9, ?9, NULL, 1)`,
            [value.commitmentId, normalizedAgentId, value.actorKey, value.direction, value.description,
                value.valueGp, value.dueAt, JSON.stringify(value.evidenceEpisodeIds), now]);
        });
        transaction.immediate();
        return this.requireCommitment(value.commitmentId);
    }

    setCommitmentStatus(commitmentId: string, expectedRevision: number, status: AgentCommitmentStatus,
        now = new Date().toISOString()): AgentCommitment {
        if (!['open', 'fulfilled', 'broken', 'cancelled'].includes(status)) throw new Error('Invalid commitment status');
        const current = this.requireCommitment(commitmentId);
        if (current.status === status) return current;
        if (current.status !== 'open') throw new Error('Resolved commitments cannot change status');
        const result = this.database.run(`UPDATE agent_commitment SET status = ?3, updated_at = ?4,
            resolved_at = CASE WHEN ?3 = 'open' THEN NULL ELSE ?4 END, revision = revision + 1
            WHERE commitment_id = ?1 AND revision = ?2`, [current.commitmentId, expectedRevision, status, now]);
        if (result.changes !== 1) throw new Error('Commitment changed before update; refresh and try again');
        return this.requireCommitment(current.commitmentId);
    }

    getCommitment(commitmentId: string): AgentCommitment | null {
        const normalized = normalizeAgentId(commitmentId, 'commitmentId');
        const row = this.database.query('SELECT * FROM agent_commitment WHERE commitment_id = ?1').get(normalized);
        return row ? commitment(row as CommitmentRow) : null;
    }

    listCommitments(agentId: string, actorKey?: string, status?: AgentCommitmentStatus): AgentCommitment[] {
        const normalized = normalizeAgentId(agentId);
        let rows: unknown[];
        if (actorKey && status) rows = this.database.query(`SELECT * FROM agent_commitment
            WHERE agent_id = ?1 AND actor_key = ?2 AND status = ?3 ORDER BY created_at DESC, commitment_id`)
            .all(normalized, normalizeActorKey(actorKey), status);
        else if (actorKey) rows = this.database.query(`SELECT * FROM agent_commitment
            WHERE agent_id = ?1 AND actor_key = ?2 ORDER BY created_at DESC, commitment_id`)
            .all(normalized, normalizeActorKey(actorKey));
        else if (status) rows = this.database.query(`SELECT * FROM agent_commitment
            WHERE agent_id = ?1 AND status = ?2 ORDER BY created_at DESC, commitment_id`).all(normalized, status);
        else rows = this.database.query(`SELECT * FROM agent_commitment
            WHERE agent_id = ?1 ORDER BY created_at DESC, commitment_id`).all(normalized);
        return (rows as CommitmentRow[]).map(commitment);
    }

    setEconomicActorLink(agentId: string, expectedRevision: number | null, input: SetAgentEconomicActorLink,
        now = new Date().toISOString()): AgentEconomicActorLink {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateEconomicActorLink(input.actorKind, input.actorId, input.role);
        if (value.role === 'self') throw new Error('Only the identity may own the self economic actor link');
        const source = input.source ?? 'admin';
        if (source !== 'admin' && source !== 'system') throw new Error('Economic actor link source must be admin or system');
        const transaction = this.database.transaction(() => {
            this.requireIdentity(normalizedAgentId);
            const current = this.getEconomicActorLink(normalizedAgentId, value.actorKind, value.actorId);
            if (!current) {
                if (expectedRevision !== null) throw new Error('Economic actor link changed before update; refresh and try again');
                this.database.run(`INSERT INTO agent_economic_actor_link
                    (agent_id, actor_kind, actor_id, role, source, created_at, updated_at, revision)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 1)`,
                [normalizedAgentId, value.actorKind, value.actorId, value.role, source, now]);
                return;
            }
            if (current.source === 'identity') throw new Error('The identity economic actor link cannot be edited directly');
            if (expectedRevision === null || current.revision !== expectedRevision) {
                throw new Error('Economic actor link changed before update; refresh and try again');
            }
            const result = this.database.run(`UPDATE agent_economic_actor_link SET role = ?5, source = ?6,
                updated_at = ?7, revision = revision + 1
                WHERE agent_id = ?1 AND actor_kind = ?2 AND actor_id = ?3 AND revision = ?4`,
            [normalizedAgentId, value.actorKind, value.actorId, expectedRevision, value.role, source, now]);
            if (result.changes !== 1) throw new Error('Economic actor link changed before update; refresh and try again');
        });
        transaction.immediate();
        return this.getEconomicActorLink(normalizedAgentId, value.actorKind, value.actorId)!;
    }

    getEconomicActorLink(agentId: string, actorKind: AgentEconomicActorLink['actorKind'], actorId: string): AgentEconomicActorLink | null {
        const normalizedAgentId = normalizeAgentId(agentId);
        const value = validateEconomicActorLink(actorKind, actorId, 'member');
        const row = this.database.query(`SELECT * FROM agent_economic_actor_link
            WHERE agent_id = ?1 AND actor_kind = ?2 AND actor_id = ?3`)
            .get(normalizedAgentId, value.actorKind, value.actorId);
        return row ? economicActorLink(row as EconomicActorLinkRow) : null;
    }

    listEconomicActorLinks(agentId: string): AgentEconomicActorLink[] {
        const normalized = normalizeAgentId(agentId);
        return (this.database.query(`SELECT * FROM agent_economic_actor_link WHERE agent_id = ?1
            ORDER BY CASE role WHEN 'self' THEN 0 WHEN 'owner' THEN 1 WHEN 'manager' THEN 2
                WHEN 'member' THEN 3 ELSE 4 END, actor_kind, actor_id`).all(normalized) as EconomicActorLinkRow[])
            .map(economicActorLink);
    }

    getSnapshot(agentId: string): AgentSnapshot | null {
        const found = this.getIdentity(agentId);
        return found ? { identity: found, characterLifecycle: this.getCharacterLifecycle(found.agentId),
            populationMember: this.getPopulationMember(found.agentId),
            goals: this.listGoals(found.agentId),
            workingMemory: this.getWorkingMemory(found.agentId), knownSkills: this.listSkillKnowledge(found.agentId) } : null;
    }

    private requireIdentity(agentId: string): AgentIdentity {
        const found = this.getIdentity(agentId);
        if (!found) throw new Error(`Unknown agent: ${agentId}`);
        return found;
    }
    private requireGoal(goalId: string): AgentGoal {
        const found = this.getGoal(goalId);
        if (!found) throw new Error(`Unknown goal: ${goalId}`);
        return found;
    }
    private requireEpisode(episodeId: string): AgentEpisode {
        const found = this.getEpisode(episodeId);
        if (!found) throw new Error(`Unknown episode: ${episodeId}`);
        return found;
    }
    private requireKnowledge(knowledgeId: string): AgentKnowledge {
        const found = this.getKnowledge(knowledgeId);
        if (!found) throw new Error(`Unknown knowledge: ${knowledgeId}`);
        return found;
    }
    private requireCommitment(commitmentId: string): AgentCommitment {
        const found = this.getCommitment(commitmentId);
        if (!found) throw new Error(`Unknown commitment: ${commitmentId}`);
        return found;
    }
    private migrate(): void {
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > AGENT_STATE_SCHEMA_VERSION) throw new Error(`Agent state schema ${version} is newer than supported version ${AGENT_STATE_SCHEMA_VERSION}`);
        if (version < 1) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_identity (
                    agent_id TEXT PRIMARY KEY, player_username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
                    background TEXT NOT NULL, personality_traits TEXT NOT NULL, agent_values TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1))`);
                this.database.run(`CREATE TABLE agent_goal (
                    goal_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    parent_goal_id TEXT REFERENCES agent_goal(goal_id) ON DELETE RESTRICT,
                    horizon TEXT NOT NULL CHECK (horizon IN ('life', 'long-term', 'current', 'immediate')),
                    title TEXT NOT NULL, description TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'blocked', 'abandoned')),
                    priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 100), created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL, completed_at TEXT, revision INTEGER NOT NULL CHECK (revision >= 1),
                    CHECK (goal_id != parent_goal_id))`);
                this.database.run(`CREATE UNIQUE INDEX one_active_life_goal_per_agent
                    ON agent_goal(agent_id) WHERE horizon = 'life' AND status = 'active'`);
                this.database.run('CREATE INDEX agent_goal_agent_status ON agent_goal(agent_id, status)');
                this.database.run('PRAGMA user_version = 1');
            });
            transaction.immediate();
        }
        if (version < 2) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_working_memory (
                    agent_id TEXT PRIMARY KEY REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    summary TEXT NOT NULL, current_activity TEXT, location TEXT, observations TEXT NOT NULL,
                    observed_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1))`);
                this.database.run('PRAGMA user_version = 2');
            });
            transaction.immediate();
        }
        if (version < 3) {
            const transaction = this.database.transaction(() => {
                this.database.run('ALTER TABLE agent_goal ADD COLUMN skill_id TEXT');
                this.database.run('ALTER TABLE agent_goal ADD COLUMN skill_version TEXT');
                this.database.run(`CREATE TABLE agent_skill_knowledge (
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    skill_id TEXT NOT NULL, skill_version TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('known', 'preferred', 'blocked')),
                    learned_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    PRIMARY KEY (agent_id, skill_id, skill_version))`);
                this.database.run('PRAGMA user_version = 3');
            });
            transaction.immediate();
        }
        if (version < 4) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_episode (
                    episode_id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    kind TEXT NOT NULL CHECK (kind IN ('observation', 'action', 'outcome', 'interaction', 'discovery', 'economic')),
                    summary TEXT NOT NULL, details TEXT NOT NULL,
                    importance INTEGER NOT NULL CHECK (importance BETWEEN 0 AND 100),
                    goal_ids TEXT NOT NULL, actors TEXT NOT NULL, tags TEXT NOT NULL,
                    source TEXT NOT NULL CHECK (source IN ('manual', 'system', 'skill', 'planner')),
                    trust TEXT NOT NULL CHECK (trust IN ('trusted', 'untrusted')),
                    external_key TEXT, occurred_at TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL)`);
                this.database.run(`CREATE UNIQUE INDEX agent_episode_external_key
                    ON agent_episode(agent_id, external_key) WHERE external_key IS NOT NULL`);
                this.database.run(`CREATE INDEX agent_episode_agent_time
                    ON agent_episode(agent_id, occurred_at DESC)`);
                this.database.run(`CREATE INDEX agent_episode_agent_importance
                    ON agent_episode(agent_id, importance DESC)`);
                this.database.run('PRAGMA user_version = 4');
            });
            transaction.immediate();
        }
        if (version < 5) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_semantic_memory (
                    knowledge_id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    kind TEXT NOT NULL CHECK (kind IN ('world', 'economic', 'route', 'procedure')),
                    subject TEXT NOT NULL COLLATE NOCASE, predicate TEXT NOT NULL COLLATE NOCASE,
                    object TEXT NOT NULL, summary TEXT NOT NULL,
                    confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
                    goal_ids TEXT NOT NULL, tags TEXT NOT NULL, evidence_episode_ids TEXT NOT NULL,
                    source TEXT NOT NULL CHECK (source IN ('manual', 'system', 'consolidation')),
                    status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'disputed')),
                    supersedes_id TEXT REFERENCES agent_semantic_memory(knowledge_id) ON DELETE RESTRICT,
                    external_key TEXT, valid_from TEXT NOT NULL, valid_until TEXT,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    CHECK (knowledge_id != supersedes_id))`);
                this.database.run(`CREATE UNIQUE INDEX agent_semantic_external_key
                    ON agent_semantic_memory(agent_id, external_key) WHERE external_key IS NOT NULL`);
                this.database.run(`CREATE UNIQUE INDEX one_active_semantic_fact
                    ON agent_semantic_memory(agent_id, subject, predicate) WHERE status = 'active'`);
                this.database.run(`CREATE INDEX agent_semantic_agent_status
                    ON agent_semantic_memory(agent_id, status, updated_at DESC)`);
                this.database.run('PRAGMA user_version = 5');
            });
            transaction.immediate();
        }
        if (version < 6) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_relationship (
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    actor_key TEXT NOT NULL COLLATE NOCASE, display_name TEXT NOT NULL,
                    trust INTEGER NOT NULL CHECK (trust BETWEEN -100 AND 100),
                    affinity INTEGER NOT NULL CHECK (affinity BETWEEN -100 AND 100),
                    familiarity INTEGER NOT NULL CHECK (familiarity BETWEEN 0 AND 100),
                    agent_owes_gp INTEGER NOT NULL CHECK (agent_owes_gp >= 0),
                    actor_owes_gp INTEGER NOT NULL CHECK (actor_owes_gp >= 0),
                    notes TEXT NOT NULL, tags TEXT NOT NULL, evidence_episode_ids TEXT NOT NULL,
                    last_interaction_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1), PRIMARY KEY (agent_id, actor_key))`);
                this.database.run(`CREATE TABLE agent_commitment (
                    commitment_id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL, actor_key TEXT NOT NULL COLLATE NOCASE,
                    direction TEXT NOT NULL CHECK (direction IN ('owed-by-agent', 'owed-to-agent')),
                    description TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('open', 'fulfilled', 'broken', 'cancelled')),
                    value_gp INTEGER CHECK (value_gp IS NULL OR value_gp >= 0), due_at TEXT,
                    evidence_episode_ids TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    resolved_at TEXT, revision INTEGER NOT NULL CHECK (revision >= 1),
                    FOREIGN KEY (agent_id, actor_key) REFERENCES agent_relationship(agent_id, actor_key) ON DELETE RESTRICT)`);
                this.database.run(`CREATE INDEX agent_commitment_agent_status
                    ON agent_commitment(agent_id, status, due_at)`);
                this.database.run('PRAGMA user_version = 6');
            });
            transaction.immediate();
        }
        if (version < 7) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_economic_actor_link (
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('player', 'business', 'faction')),
                    actor_id TEXT NOT NULL, role TEXT NOT NULL
                        CHECK (role IN ('self', 'owner', 'manager', 'member', 'beneficiary')),
                    source TEXT NOT NULL CHECK (source IN ('identity', 'admin', 'system')),
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    PRIMARY KEY (agent_id, actor_kind, actor_id))`);
                this.database.run(`CREATE UNIQUE INDEX one_identity_actor_link_per_agent
                    ON agent_economic_actor_link(agent_id) WHERE source = 'identity'`);
                const rows = this.database.query(`SELECT agent_id, player_username, created_at, updated_at
                    FROM agent_identity`).all() as Array<{ agent_id: string; player_username: string;
                        created_at: string; updated_at: string }>;
                for (const row of rows) {
                    this.database.run(`INSERT INTO agent_economic_actor_link
                        (agent_id, actor_kind, actor_id, role, source, created_at, updated_at, revision)
                        VALUES (?1, 'player', ?2, 'self', 'identity', ?3, ?4, 1)`,
                    [row.agent_id, normalizeEconomicActorId(row.player_username, 'playerUsername'),
                        row.created_at, row.updated_at]);
                }
                this.database.run('PRAGMA user_version = 7');
            });
            transaction.immediate();
        }
        if (version < 8) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_consolidation_evidence (
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    rule_key TEXT NOT NULL, evidence_key TEXT NOT NULL,
                    episode_id TEXT NOT NULL REFERENCES agent_episode(episode_id) ON DELETE RESTRICT,
                    occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
                    PRIMARY KEY (agent_id, rule_key, evidence_key))`);
                this.database.run(`CREATE INDEX agent_consolidation_evidence_rule
                    ON agent_consolidation_evidence(agent_id, rule_key, occurred_at)`);
                this.database.run('PRAGMA user_version = 8');
            });
                transaction.immediate();
        }
        if (version < 9) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_control_profile (
                    agent_id TEXT PRIMARY KEY REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('player', 'institution', 'service', 'world-director')),
                    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('player', 'business', 'faction', 'service', 'world')),
                    subject_id TEXT NOT NULL, avatar_player_username TEXT,
                    decision_interval_ms INTEGER NOT NULL CHECK (decision_interval_ms BETWEEN 1000 AND 86400000),
                    max_decisions_per_day INTEGER NOT NULL CHECK (max_decisions_per_day BETWEEN 1 AND 1000),
                    daily_llm_budget_micros INTEGER NOT NULL CHECK (daily_llm_budget_micros >= 0),
                    daily_operational_budget_gp INTEGER NOT NULL CHECK (daily_operational_budget_gp >= 0),
                    last_decision_at TEXT, next_decision_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    CHECK ((role = 'player' AND subject_kind = 'player' AND avatar_player_username IS NOT NULL)
                        OR (role = 'institution' AND subject_kind IN ('business', 'faction') AND avatar_player_username IS NULL)
                        OR (role = 'service' AND subject_kind = 'service' AND avatar_player_username IS NULL)
                        OR (role = 'world-director' AND subject_kind = 'world' AND avatar_player_username IS NULL)))`);
                this.database.run(`CREATE TABLE agent_decision_ledger (
                    decision_id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE CASCADE,
                    trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'event', 'admin')),
                    llm_cost_micros INTEGER NOT NULL CHECK (llm_cost_micros >= 0),
                    operational_budget_gp INTEGER NOT NULL CHECK (operational_budget_gp >= 0),
                    occurred_at TEXT NOT NULL, profile_revision INTEGER NOT NULL CHECK (profile_revision >= 1))`);
                this.database.run(`CREATE INDEX agent_decision_agent_day
                    ON agent_decision_ledger(agent_id, occurred_at)`);
                const rows = this.database.query(`SELECT agent_id, player_username, created_at, updated_at
                    FROM agent_identity`).all() as Array<{ agent_id: string; player_username: string;
                        created_at: string; updated_at: string }>;
                for (const row of rows) {
                    this.database.run(`INSERT INTO agent_control_profile
                        (agent_id, role, subject_kind, subject_id, avatar_player_username, decision_interval_ms,
                        max_decisions_per_day, daily_llm_budget_micros, daily_operational_budget_gp,
                        last_decision_at, next_decision_at, created_at, updated_at, revision)
                        VALUES (?1, 'player', 'player', ?2, ?3, 300000, 96, 0, 0, NULL, NULL, ?4, ?5, 1)`,
                    [row.agent_id, normalizeEconomicActorId(row.player_username, 'playerUsername'),
                        row.player_username, row.created_at, row.updated_at]);
                }
                this.database.run('PRAGMA user_version = 9');
            });
            transaction.immediate();
        }
        if (version < 10) {
            this.database.run('PRAGMA foreign_keys = OFF');
            try {
                const transaction = this.database.transaction(() => {
                    this.database.run(`CREATE TABLE agent_identity_v10 (
                        agent_id TEXT PRIMARY KEY, player_username TEXT UNIQUE, display_name TEXT NOT NULL,
                        background TEXT NOT NULL, personality_traits TEXT NOT NULL, agent_values TEXT NOT NULL,
                        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                        revision INTEGER NOT NULL CHECK (revision >= 1))`);
                    this.database.run(`INSERT INTO agent_identity_v10 SELECT agent_id, player_username, display_name,
                        background, personality_traits, agent_values, created_at, updated_at, revision
                        FROM agent_identity`);
                    this.database.run('DROP TABLE agent_identity');
                    this.database.run('ALTER TABLE agent_identity_v10 RENAME TO agent_identity');
                    this.database.run('PRAGMA user_version = 10');
                });
                transaction.immediate();
            } finally {
                this.database.run('PRAGMA foreign_keys = ON');
            }
            const violations = this.database.query('PRAGMA foreign_key_check').all();
            if (violations.length) throw new Error('Agent state migration 10 introduced foreign-key violations');
        }
        if (version < 11) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_player_action_request (
                    request_id TEXT PRIMARY KEY,
                    requester_agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    assignee_agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    skill_id TEXT NOT NULL, skill_version TEXT NOT NULL, parameters TEXT NOT NULL,
                    objective TEXT NOT NULL, reward_gp INTEGER NOT NULL CHECK (reward_gp >= 0),
                    status TEXT NOT NULL CHECK (status IN
                        ('pending', 'accepted', 'rejected', 'cancelled', 'completed', 'failed')),
                    response_note TEXT NOT NULL, requested_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    accepted_at TEXT, resolved_at TEXT, revision INTEGER NOT NULL CHECK (revision >= 1),
                    CHECK (requester_agent_id != assignee_agent_id))`);
                this.database.run(`CREATE INDEX agent_player_action_request_incoming
                    ON agent_player_action_request(assignee_agent_id, status, requested_at DESC)`);
                this.database.run(`CREATE INDEX agent_player_action_request_outgoing
                    ON agent_player_action_request(requester_agent_id, status, requested_at DESC)`);
                this.database.run('PRAGMA user_version = 11');
            });
            transaction.immediate();
        }
        if (version < 12) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_player_action_request_v12 (
                    request_id TEXT PRIMARY KEY,
                    requester_agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    assignee_agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    skill_id TEXT NOT NULL, skill_version TEXT NOT NULL, parameters TEXT NOT NULL,
                    objective TEXT NOT NULL, reward_gp INTEGER NOT NULL CHECK (reward_gp >= 0),
                    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'approved', 'running',
                        'rejected', 'cancelled', 'completed', 'failed')),
                    response_note TEXT NOT NULL, requested_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    accepted_at TEXT, approval_id TEXT UNIQUE, approval_expires_at TEXT, approved_at TEXT,
                    started_at TEXT, run_id TEXT UNIQUE, resolved_at TEXT,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    CHECK (requester_agent_id != assignee_agent_id))`);
                this.database.run(`INSERT INTO agent_player_action_request_v12
                    (request_id, requester_agent_id, assignee_agent_id, skill_id, skill_version, parameters,
                    objective, reward_gp, status, response_note, requested_at, updated_at, accepted_at,
                    approval_id, approval_expires_at, approved_at, started_at, run_id, resolved_at, revision)
                    SELECT request_id, requester_agent_id, assignee_agent_id, skill_id, skill_version, parameters,
                    objective, reward_gp, status, response_note, requested_at, updated_at, accepted_at,
                    NULL, NULL, NULL, NULL, NULL, resolved_at, revision FROM agent_player_action_request`);
                this.database.run('DROP TABLE agent_player_action_request');
                this.database.run('ALTER TABLE agent_player_action_request_v12 RENAME TO agent_player_action_request');
                this.database.run(`CREATE INDEX agent_player_action_request_incoming
                    ON agent_player_action_request(assignee_agent_id, status, requested_at DESC)`);
                this.database.run(`CREATE INDEX agent_player_action_request_outgoing
                    ON agent_player_action_request(requester_agent_id, status, requested_at DESC)`);
                this.database.run('PRAGMA user_version = 12');
            });
            transaction.immediate();
        }
        if (version < 13) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_player_action_request_v13 (
                    request_id TEXT PRIMARY KEY,
                    requester_agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    assignee_agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    skill_id TEXT NOT NULL, skill_version TEXT NOT NULL, parameters TEXT NOT NULL,
                    objective TEXT NOT NULL, reward_gp INTEGER NOT NULL CHECK (reward_gp >= 0),
                    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'approved', 'running',
                        'settling', 'rejected', 'cancelled', 'completed', 'failed')),
                    response_note TEXT NOT NULL, requested_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    accepted_at TEXT, approval_id TEXT UNIQUE, approval_expires_at TEXT, approved_at TEXT,
                    started_at TEXT, run_id TEXT UNIQUE, settlement_id TEXT UNIQUE,
                    settlement_started_at TEXT, settled_at TEXT, resolved_at TEXT,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    CHECK (requester_agent_id != assignee_agent_id))`);
                this.database.run(`INSERT INTO agent_player_action_request_v13
                    (request_id, requester_agent_id, assignee_agent_id, skill_id, skill_version, parameters,
                    objective, reward_gp, status, response_note, requested_at, updated_at, accepted_at,
                    approval_id, approval_expires_at, approved_at, started_at, run_id,
                    settlement_id, settlement_started_at, settled_at, resolved_at, revision)
                    SELECT request_id, requester_agent_id, assignee_agent_id, skill_id, skill_version, parameters,
                    objective, reward_gp, status, response_note, requested_at, updated_at, accepted_at,
                    approval_id, approval_expires_at, approved_at, started_at, run_id,
                    NULL, NULL, NULL, resolved_at, revision FROM agent_player_action_request`);
                this.database.run('DROP TABLE agent_player_action_request');
                this.database.run('ALTER TABLE agent_player_action_request_v13 RENAME TO agent_player_action_request');
                this.database.run(`CREATE INDEX agent_player_action_request_incoming
                    ON agent_player_action_request(assignee_agent_id, status, requested_at DESC)`);
                this.database.run(`CREATE INDEX agent_player_action_request_outgoing
                    ON agent_player_action_request(requester_agent_id, status, requested_at DESC)`);
                this.database.run('PRAGMA user_version = 13');
            });
            transaction.immediate();
        }
        if (version < 14) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_goal_proposal (
                    proposal_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE,
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    anchor_goal_id TEXT NOT NULL REFERENCES agent_goal(goal_id) ON DELETE RESTRICT,
                    anchor_goal_revision INTEGER NOT NULL CHECK (anchor_goal_revision >= 1), goals TEXT NOT NULL,
                    skill_id TEXT, skill_version TEXT, reason TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'running', 'completed', 'failed')),
                    approval_id TEXT UNIQUE, approval_expires_at TEXT, skill_run_id TEXT UNIQUE,
                    response_note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    approved_at TEXT, started_at TEXT, resolved_at TEXT,
                    revision INTEGER NOT NULL CHECK (revision >= 1))`);
                this.database.run(`CREATE INDEX agent_goal_proposal_agent_status
                    ON agent_goal_proposal(agent_id, status, created_at DESC)`);
                this.database.run('PRAGMA user_version = 14');
            });
            transaction.immediate();
        }
        if (version < 15) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_goal_event (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    goal_id TEXT NOT NULL REFERENCES agent_goal(goal_id) ON DELETE RESTRICT,
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    kind TEXT NOT NULL CHECK (kind IN ('created', 'imported', 'status-changed', 'skill-assigned')),
                    previous_status TEXT CHECK (previous_status IS NULL OR previous_status IN
                        ('active', 'completed', 'blocked', 'abandoned')),
                    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'blocked', 'abandoned')),
                    previous_revision INTEGER CHECK (previous_revision IS NULL OR previous_revision >= 1),
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    skill_id TEXT, skill_version TEXT, occurred_at TEXT NOT NULL,
                    CHECK ((skill_id IS NULL) = (skill_version IS NULL)))`);
                this.database.run(`CREATE INDEX agent_goal_event_agent_time
                    ON agent_goal_event(agent_id, occurred_at, sequence)`);
                this.database.run(`CREATE UNIQUE INDEX agent_goal_event_goal_revision_kind
                    ON agent_goal_event(goal_id, revision, kind)`);
                this.database.run(`INSERT INTO agent_goal_event
                    (goal_id, agent_id, kind, previous_status, status, previous_revision, revision,
                    skill_id, skill_version, occurred_at)
                    SELECT goal_id, agent_id, 'imported', NULL, status, NULL, revision,
                    skill_id, skill_version, updated_at FROM agent_goal`);
                this.database.run('PRAGMA user_version = 15');
            });
            transaction.immediate();
        }
        if (version < 16) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_autonomy_enrollment (
                    agent_id TEXT PRIMARY KEY REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    status TEXT NOT NULL CHECK (status IN ('desired', 'running', 'paused', 'quarantined')),
                    policy_id TEXT NOT NULL, policy_version TEXT NOT NULL, next_wakeup_at TEXT,
                    lease_owner TEXT, lease_expires_at TEXT,
                    failure_count INTEGER NOT NULL CHECK (failure_count BETWEEN 0 AND 1000000),
                    last_failure_fingerprint TEXT, quarantine_reason TEXT,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
                    CHECK ((failure_count = 0) = (last_failure_fingerprint IS NULL)),
                    CHECK ((status = 'running') = (lease_owner IS NOT NULL)),
                    CHECK ((status = 'quarantined') = (quarantine_reason IS NOT NULL)),
                    CHECK (status NOT IN ('paused', 'quarantined') OR next_wakeup_at IS NULL))`);
                this.database.run(`CREATE INDEX agent_autonomy_status_wakeup
                    ON agent_autonomy_enrollment(status, next_wakeup_at, agent_id)`);
                this.database.run('PRAGMA user_version = 16');
            });
            transaction.immediate();
        }
        if (version < 17) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_autonomy_control (
                    control_key TEXT PRIMARY KEY CHECK (control_key = 'global'),
                    emergency_stop INTEGER NOT NULL CHECK (emergency_stop IN (0, 1)),
                    reason TEXT, activated_at TEXT, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    CHECK ((emergency_stop = 1) = (reason IS NOT NULL)),
                    CHECK ((emergency_stop = 1) = (activated_at IS NOT NULL)))`);
                this.database.run(`INSERT INTO agent_autonomy_control
                    (control_key, emergency_stop, reason, activated_at, updated_at, revision)
                    VALUES ('global', 0, NULL, NULL, '1970-01-01T00:00:00.000Z', 1)`);
                this.database.run('PRAGMA user_version = 17');
            });
            transaction.immediate();
        }
        if (version < 18) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE agent_goal_execution (
                    goal_id TEXT PRIMARY KEY REFERENCES agent_goal(goal_id) ON DELETE RESTRICT,
                    execution_policy TEXT NOT NULL CHECK (execution_policy IN ('one-shot', 'recurring')),
                    required_successful_runs INTEGER NOT NULL CHECK (required_successful_runs BETWEEN 1 AND 10000),
                    successful_runs INTEGER NOT NULL CHECK (successful_runs BETWEEN 0 AND 1000000),
                    cooldown_ms INTEGER NOT NULL CHECK (cooldown_ms BETWEEN 0 AND 86400000),
                    next_eligible_at TEXT, last_run_id TEXT,
                    parameter_source_kind TEXT NOT NULL CHECK (parameter_source_kind IN
                        ('goal', 'work-order', 'contract-obligation', 'approved-policy', 'llm-suggestion')),
                    parameter_source_id TEXT NOT NULL, parameters TEXT NOT NULL, parameter_digest TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK (revision >= 1),
                    CHECK (execution_policy = 'recurring' OR cooldown_ms = 0),
                    CHECK (execution_policy = 'one-shot' OR cooldown_ms >= 1000))`);
                this.database.run(`CREATE TABLE agent_skill_dispatch (
                    run_id TEXT PRIMARY KEY, decision_id TEXT NOT NULL UNIQUE
                        REFERENCES agent_decision_ledger(decision_id) ON DELETE RESTRICT,
                    agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    goal_id TEXT NOT NULL REFERENCES agent_goal(goal_id) ON DELETE RESTRICT,
                    skill_id TEXT NOT NULL, skill_version TEXT NOT NULL,
                    parameter_source_kind TEXT NOT NULL CHECK (parameter_source_kind IN
                        ('goal', 'work-order', 'contract-obligation', 'approved-policy', 'llm-suggestion')),
                    parameter_source_id TEXT NOT NULL, parameters TEXT NOT NULL, parameter_digest TEXT NOT NULL,
                    policy_id TEXT NOT NULL, policy_version TEXT NOT NULL, created_at TEXT NOT NULL)`);
                this.database.run(`CREATE INDEX agent_skill_dispatch_agent_goal
                    ON agent_skill_dispatch(agent_id, goal_id, created_at)`);
                this.database.run(`CREATE TABLE agent_skill_outcome (
                    run_id TEXT PRIMARY KEY REFERENCES agent_skill_dispatch(run_id) ON DELETE RESTRICT,
                    status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'cancelled', 'limit-reached')),
                    classification TEXT NOT NULL CHECK (classification IN
                        ('completed', 'acquire-input', 'retry', 'capability-gap', 'authorization')),
                    detail TEXT NOT NULL, occurred_at TEXT NOT NULL,
                    CHECK ((status = 'completed') = (classification = 'completed')))`);
                const hasGoalTable = this.database.query(`SELECT 1 AS found FROM sqlite_master
                    WHERE type = 'table' AND name = 'agent_goal'`).get();
                if (hasGoalTable) this.database.run(`INSERT INTO agent_goal_execution
                        (goal_id, execution_policy, required_successful_runs, successful_runs, cooldown_ms,
                        next_eligible_at, last_run_id, parameter_source_kind, parameter_source_id,
                        parameters, parameter_digest, created_at, updated_at, revision)
                        SELECT goal_id,
                        CASE WHEN skill_id = 'shopping.lumbridge.buy-hammers' THEN 'one-shot' ELSE 'recurring' END,
                        1, 0, CASE WHEN skill_id = 'shopping.lumbridge.buy-hammers' THEN 0 ELSE 60000 END,
                        NULL, NULL, 'goal', goal_id,
                        CASE WHEN skill_id = 'shopping.lumbridge.buy-hammers' THEN '{"target-items":1}' ELSE '{}' END,
                        CASE WHEN skill_id = 'shopping.lumbridge.buy-hammers'
                            THEN 'a70916884e578683191f5e411a344cabb58b1313b5fadcb5973923f57a23117f'
                            ELSE '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a' END,
                        created_at, updated_at, 1 FROM agent_goal
                        WHERE horizon = 'immediate' AND skill_id IS NOT NULL`);
                this.database.run('PRAGMA user_version = 18');
            });
            transaction.immediate();
        }
        if (version < 19) {
            const transaction = this.database.transaction(() => {
                this.database.run('ALTER TABLE agent_decision_ledger ADD COLUMN context_digest TEXT');
                this.database.run('PRAGMA user_version = 19');
            });
            transaction.immediate();
        }
        if (version < 20) {
            const transaction = this.database.transaction(() => {
                const table = this.database.query(`SELECT 1 AS found FROM sqlite_master
                    WHERE type='table' AND name='agent_goal_event'`).get();
                if (!table) {
                    this.database.run('PRAGMA user_version = 20');
                    return;
                }
                const columns = this.database.query('PRAGMA table_info(agent_goal_event)').all() as Array<{ name: string }>;
                const existing = new Set(columns.map(column => column.name));
                const additions: Array<[string, string]> = [
                    ['simulation_clock_id', 'TEXT'], ['simulation_sequence', 'INTEGER'],
                    ['simulation_time', 'TEXT'], ['simulation_binding_wall_time', 'TEXT'],
                    ['simulation_engine_tick', 'INTEGER'], ['simulation_profile_digest', 'TEXT'],
                    ['simulation_clock_status', 'TEXT'], ['simulation_clock_revision', 'INTEGER'],
                    ['simulation_source_digest', 'TEXT']
                ];
                for (const [name, type] of additions) {
                    if (!existing.has(name)) this.database.run(`ALTER TABLE agent_goal_event ADD COLUMN ${name} ${type}`);
                }
                this.database.run(`CREATE UNIQUE INDEX IF NOT EXISTS agent_goal_event_simulation_sequence
                    ON agent_goal_event(simulation_clock_id,simulation_sequence)
                    WHERE simulation_clock_id IS NOT NULL`);
                this.database.run('PRAGMA user_version = 20');
            });
            transaction.immediate();
        }
        if (version < 21) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE IF NOT EXISTS agent_character_lifecycle (
                    agent_id TEXT PRIMARY KEY REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
                    origin TEXT NOT NULL CHECK(origin IN ('created','imported','born')),
                    created_at_simulation_time TEXT NOT NULL,birth_at_simulation_time TEXT,
                    age_at_observation_ms INTEGER NOT NULL CHECK(age_at_observation_ms>=0),
                    age_observed_at_simulation_time TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('active','deceased')),
                    status_changed_at_simulation_time TEXT NOT NULL,
                    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK(revision>=1),
                    CHECK(birth_at_simulation_time IS NULL OR birth_at_simulation_time<=age_observed_at_simulation_time))`);
                this.database.run('PRAGMA user_version = 21');
            });
            transaction.immediate();
        }
        if(version<22){
            const transaction=this.database.transaction(()=>{
                this.database.run(`CREATE TABLE IF NOT EXISTS agent_population_member (
                    agent_id TEXT PRIMARY KEY REFERENCES agent_character_lifecycle(agent_id) ON DELETE RESTRICT,
                    player_username TEXT NOT NULL,world_profile_id TEXT NOT NULL,world_profile_version TEXT NOT NULL,
                    world_profile_digest TEXT NOT NULL CHECK(length(world_profile_digest)=64),
                    lifecycle_policy_id TEXT NOT NULL,lifecycle_policy_version TEXT NOT NULL,
                    lifecycle_policy_digest TEXT NOT NULL CHECK(length(lifecycle_policy_digest)=64),
                    lifecycle_policy_kind TEXT NOT NULL CHECK(lifecycle_policy_kind='finite'),
                    simulation_clock_id TEXT NOT NULL,simulation_clock_profile_digest TEXT NOT NULL
                        CHECK(length(simulation_clock_profile_digest)=64),joined_at_simulation_time TEXT NOT NULL,
                    source_result_id TEXT NOT NULL,source_result_digest TEXT NOT NULL CHECK(length(source_result_digest)=64),
                    status TEXT NOT NULL CHECK(status IN ('active','reset')),reset_at_simulation_time TEXT,
                    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),
                    CHECK((status='active' AND reset_at_simulation_time IS NULL)
                        OR (status='reset' AND reset_at_simulation_time IS NOT NULL)))`);
                this.database.run(`CREATE UNIQUE INDEX IF NOT EXISTS agent_population_member_source
                    ON agent_population_member(source_result_digest,agent_id)`);
                this.database.run('PRAGMA user_version = 22');
            });transaction.immediate();
        }
        if (version < 23) {
            this.database.transaction(() => {
                this.database.run(`CREATE TABLE IF NOT EXISTS agent_population_death(
                    agent_id TEXT PRIMARY KEY REFERENCES agent_character_lifecycle(agent_id) ON DELETE RESTRICT,
                    event_id TEXT NOT NULL UNIQUE,event_json TEXT NOT NULL,event_digest TEXT NOT NULL)`);
                this.database.run('PRAGMA user_version=23');
            }).immediate();
        }
        if (version < 24) {
            this.database.transaction(()=>{ installMemoryArchiveSchema(this.database); this.database.run('PRAGMA user_version=24'); }).immediate();
        }
        if (version < 25) {
            this.database.transaction(()=>{ installPopulationEntrySchema(this.database); this.database.run('PRAGMA user_version=25'); }).immediate();
        }
        if (version < 26) {
            this.database.transaction(() => { installStateGoalSchema(this.database); this.database.run('PRAGMA user_version=26'); }).immediate();
        }
        if (version < 27) {
            this.database.transaction(() => { installPlayerStrategySchema(this.database); this.database.run('PRAGMA user_version=27'); }).immediate();
        }
        if (version < 28) {
            this.database.transaction(() => { installInstitutionStrategySchema(this.database); this.database.run('PRAGMA user_version=28'); }).immediate();
        }
        if (version < 29) {
            this.database.transaction(() => { installEconomicActionSchema(this.database); this.database.run('PRAGMA user_version=29'); }).immediate();
        }
    }
}
