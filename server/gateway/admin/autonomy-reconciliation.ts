import type { AutonomySupervisorResult } from './autonomy-supervisor.js';
import type { DomainWakeupRecoveryResult } from './domain-event-recovery.js';
import type { EconomicContractSettlementRecoveryResult } from './economic-contract-settlement.js';
import type { GoalWakeupRecoveryResult } from './goal-event-recovery.js';
import type { OrphanedSkillRecoveryResult, SkillTerminalRecoveryResult } from './skill-terminal-recovery.js';
import type { SkillMarkerReconciliation } from './supervisor.js';
import type { PlayerActionSettlementRecoveryResult } from './agent-state.js';

export interface AutonomyReconciliationDependencies {
    reconcileSkillMarkers(): Promise<SkillMarkerReconciliation[]>;
    recoverSkillTerminals(): Promise<SkillTerminalRecoveryResult>;
    recoverOrphanedSkills(markers: SkillMarkerReconciliation[]): Promise<OrphanedSkillRecoveryResult>;
    recoverPlayerActionSettlements(): Promise<PlayerActionSettlementRecoveryResult>;
    recoverContractSettlements(): Promise<EconomicContractSettlementRecoveryResult>;
    recoverGoalEvents(): GoalWakeupRecoveryResult;
    recoverDomainEvents(): DomainWakeupRecoveryResult;
    reconcileEnrollments(startup: boolean): Promise<AutonomySupervisorResult[]>;
}

export interface AutonomyReconciliationReport {
    startup: boolean;
    markers: SkillMarkerReconciliation[];
    skillTerminals: SkillTerminalRecoveryResult;
    orphanedSkills: OrphanedSkillRecoveryResult;
    playerActionSettlements: PlayerActionSettlementRecoveryResult;
    contractSettlements: EconomicContractSettlementRecoveryResult;
    goalEvents: GoalWakeupRecoveryResult;
    domainEvents: DomainWakeupRecoveryResult;
    enrollments: AutonomySupervisorResult[];
}

/**
 * One fail-closed ordering for process markers, terminal journals, durable goal/domain
 * state, and finally enrollment/bot-session claims. Planning never starts from a
 * partially reconciled prefix.
 */
export async function runAutonomyReconciliation(startup: boolean,
    dependencies: AutonomyReconciliationDependencies): Promise<AutonomyReconciliationReport> {
    const markers = await dependencies.reconcileSkillMarkers();
    const skillTerminals = await dependencies.recoverSkillTerminals();
    const orphanedSkills = await dependencies.recoverOrphanedSkills(markers);
    const playerActionSettlements = await dependencies.recoverPlayerActionSettlements();
    const contractSettlements = await dependencies.recoverContractSettlements();
    const goalEvents = dependencies.recoverGoalEvents();
    const domainEvents = dependencies.recoverDomainEvents();
    const enrollments = await dependencies.reconcileEnrollments(startup);
    return { startup, markers, skillTerminals, orphanedSkills, playerActionSettlements, contractSettlements,
        goalEvents, domainEvents, enrollments };
}
