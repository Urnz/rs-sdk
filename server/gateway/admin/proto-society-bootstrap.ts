import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Database } from 'bun:sqlite';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { SetAgentControlProfile } from '../../../agent-state/types.js';
import { BusinessManagerStore } from './business-manager.js';
import { FixtureBootstrapStore, type FixtureApplication } from './fixture-bootstrap-store.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';
import { listAdminSkills } from './skill-catalog.js';
import { listEngineOfflineBackups, requestEngineOfflineEdit, requestEngineOfflineRestore, type OfflineSaveDraft,
    type OfflineSaveSummary } from './offline-editor.js';
import { listEngineProperties, type AdminPropertyList } from './properties.js';
import { SKILL_NAMES } from './save-reader.js';
import type { FixturePlayer, ProtoSocietyFixture } from './proto-society-fixture.js';
import { fixtureBackupsDir, fixtureBootstrapDbPath, agentStateDbPath, businessManagerDbPath,
    institutionTreasuryDbPath } from './paths.js';

export interface FixtureBootstrapPaths { agentPath?: string; businessPath?: string; treasuryPath?: string;
    ledgerPath?: string; backupsDir?: string }
export interface FixturePlayerInspection { editable: boolean; state: OfflineSaveSummary | null }
export interface FixtureBootstrapAdapters {
    inspectPlayer(username: string): Promise<FixturePlayerInspection>;
    editPlayer(username: string, draft: OfflineSaveDraft, commandId: string): Promise<{
        backupId?: string; after?: OfflineSaveSummary }>;
    restorePlayer(username: string, backupId: string, expectedSavedAt: string, commandId: string): Promise<{
        after?: OfflineSaveSummary }>;
    listProperties(): Promise<AdminPropertyList>;
    listVerifiedSkills(): Promise<Array<{ id: string; version: string }>>;
}
export interface FixturePreflight { ok: boolean; baselineDigest: string; errors: string[]; warnings: string[];
    changes: string[]; players: Record<string, FixturePlayerInspection>; properties: AdminPropertyList }

const defaultAdapters: FixtureBootstrapAdapters = {
    inspectPlayer: async username => {
        const result = await listEngineOfflineBackups(username);
        return { editable: result.readiness.editable, state: result.state };
    },
    editPlayer: (username, draft, commandId) => requestEngineOfflineEdit(username, draft, commandId),
    restorePlayer: (username, backupId, expectedSavedAt, commandId) => requestEngineOfflineRestore(
        username, backupId, expectedSavedAt, commandId),
    listProperties: listEngineProperties,
    listVerifiedSkills: async () => (await listAdminSkills()).map(item => ({ id: item.id, version: item.version }))
};

function digest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function playerControlProfile(player: FixturePlayer): SetAgentControlProfile {
    return { role: 'player', subjectKind: 'player', subjectId: player.username.toLowerCase(),
        avatarPlayerUsername: player.username.toLowerCase(), ...player.controlProfile };
}

function samePlayerControlProfile(current: ReturnType<AgentStateStore['getControlProfile']>,
    player: FixturePlayer): boolean {
    if (!current) return false;
    const desired = playerControlProfile(player);
    return current.role === desired.role && current.subjectKind === desired.subjectKind
        && current.subjectId === desired.subjectId && current.avatarPlayerUsername === desired.avatarPlayerUsername
        && current.decisionIntervalMs === desired.decisionIntervalMs
        && current.maxDecisionsPerDay === desired.maxDecisionsPerDay
        && current.dailyLlmBudgetMicros === desired.dailyLlmBudgetMicros
        && current.dailyOperationalBudgetGp === desired.dailyOperationalBudgetGp;
}

function desiredSkills(player: FixturePlayer): Array<{ name: string; experience: number }> {
    const overrides = new Map(player.skills.overrides.map(item => [item.name.toLowerCase(), item.experience]));
    return SKILL_NAMES.filter((_, index) => index !== 18 && index !== 19)
        .map(name => ({ name, experience: overrides.get(name.toLowerCase()) ?? player.skills.defaultExperience }));
}

function aggregateItems(items: Array<{ id: number; count: number }>): Array<{ id: number; count: number }> {
    const counts = new Map<number, number>();
    for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + item.count);
    return [...counts].sort(([left], [right]) => left - right).map(([id, count]) => ({ id, count }));
}

function canonicalEquipment(items: Array<{ id: number; count: number; slot?: number }>) {
    return items.map(item => ({ id: item.id, count: item.count, slot: item.slot }))
        .sort((left, right) => (left.slot ?? -1) - (right.slot ?? -1) || left.id - right.id);
}

function saveDraft(player: FixturePlayer, state: OfflineSaveSummary): OfflineSaveDraft {
    return { expectedSavedAt: state.savedAt, coins: player.coins, coinPlacement: player.coinPlacement,
        skills: desiredSkills(player),
        inventory: player.inventory, equipment: player.equipment,
        bank: player.bank, position: player.position };
}

function savePayload(value: OfflineSaveSummary): unknown {
    return { coins: value.coins,
        coinPlacement: value.coinPlacement ?? 'bank',
        skills: value.skills.map(skill => ({
        name: skill.name.toLocaleLowerCase('en-US'), experience: skill.experience
    })), inventory: aggregateItems(value.inventory),
        equipment: canonicalEquipment(value.equipment), bank: aggregateItems(value.bank), position: value.position };
}

function desiredSavePayload(player: FixturePlayer): unknown {
    return { coins: player.coins, coinPlacement: player.coinPlacement,
        skills: desiredSkills(player).map(skill => ({
        name: skill.name.toLocaleLowerCase('en-US'), experience: skill.experience
    })), inventory: aggregateItems(player.inventory),
        equipment: canonicalEquipment(player.equipment), bank: aggregateItems(player.bank),
        position: { x: player.position.x, z: player.position.z, level: player.position.level } };
}

function goalPayload(goal: FixturePlayer['goals'][number]): unknown {
    return { goalId: goal.goalId, parentGoalId: goal.parentGoalId, horizon: goal.horizon,
        title: goal.title, description: goal.description, priority: goal.priority, skill: goal.skill };
}

export async function preflightProtoSocietyFixture(fixture: ProtoSocietyFixture,
    adapters: FixtureBootstrapAdapters = defaultAdapters, paths: FixtureBootstrapPaths = {}): Promise<FixturePreflight> {
    const errors: string[] = [], warnings: string[] = [], changes: string[] = [];
    const [skills, properties, inspections] = await Promise.all([
        adapters.listVerifiedSkills(), adapters.listProperties(),
        Promise.all(fixture.players.map(async player => [player.username,
            await adapters.inspectPlayer(player.username)] as const))
    ]);
    const players = Object.fromEntries(inspections);
    const skillSet = new Set(skills.map(item => `${item.id}@${item.version}`));
    for (const skill of fixture.autonomousSkillAllowlist) if (!skillSet.has(`${skill.id}@${skill.version}`)) {
        errors.push(`Autonomous allowlist skill is not shared and verified: ${skill.id}@${skill.version}`);
    }
    for (const player of fixture.players) {
        const inspection = players[player.username]!;
        if (!inspection.editable) errors.push(`${player.username}: save is not exclusively offline/editable`);
        if (!inspection.state) errors.push(`${player.username}: canonical local save is missing`);
        else if (digest(savePayload(inspection.state)) !== digest(desiredSavePayload(player))) {
            changes.push(`engine-save:${player.username}`);
        }
    }
    const property = properties.properties.find(item => item.propertyId === fixture.business.property.propertyId);
    if (!property) errors.push(`Property is missing: ${fixture.business.property.propertyId}`);
    else if (property.state.status !== fixture.business.property.expectedState
        && !(property.state.status === 'owned' && property.state.owner?.kind === 'business'
            && property.state.owner.id === fixture.business.businessId)) {
        errors.push(`Property ${property.propertyId} conflicts with the fixture baseline`);
    }
    if (fixture.externalDependencies.length) warnings.push('Vanilla NPC shop flow remains an external measured dependency; this fixture is not self-sustaining.');
    const agentPath = paths.agentPath ?? agentStateDbPath;
    if (!existsSync(agentPath)) {
        for (const player of fixture.players) changes.push(`agent:${player.agentId}`);
        changes.push(`agent:${fixture.business.institutionAgentId}`);
    } else {
        const agents = new AgentStateStore(agentPath);
        try {
        for (const player of fixture.players) {
            const current = agents.getIdentity(player.agentId);
            if (!current) changes.push(`agent:${player.agentId}`);
            else {
                if (current.playerUsername !== player.username.toLowerCase()) errors.push(`${player.agentId}: existing avatar binding conflicts`);
                if (current.displayName !== player.displayName || current.background !== player.background
                    || digest(current.personalityTraits) !== digest(player.personalityTraits)) {
                    errors.push(`${player.agentId}: existing identity baseline conflicts`);
                }
                if (!samePlayerControlProfile(agents.getControlProfile(player.agentId), player)) {
                    changes.push(`control-profile:${player.agentId}`);
                }
                for (const goal of player.goals) {
                    const existingGoal = agents.getGoal(goal.goalId);
                    if (!existingGoal) changes.push(`goal:${goal.goalId}`);
                    else if (existingGoal.agentId !== player.agentId || digest(goalPayload(existingGoal)) !== digest(goalPayload(goal))) {
                        errors.push(`${player.agentId}: existing goal baseline conflicts: ${goal.goalId}`);
                    }
                }
                for (const skill of player.knownSkills) {
                    const knowledge = agents.getSkillKnowledge(player.agentId, skill);
                    if (!knowledge) changes.push(`skill-knowledge:${player.agentId}:${skill.id}@${skill.version}`);
                    else if (knowledge.status !== 'known') errors.push(`${player.agentId}: skill knowledge is not known: ${skill.id}@${skill.version}`);
                }
                const enrollment = agents.getAutonomyEnrollment(player.agentId);
                if (!enrollment) changes.push(`autonomy:${player.agentId}`);
                else if (enrollment.status !== player.autonomy.status || enrollment.policyId !== player.autonomy.policyId
                    || enrollment.policyVersion !== player.autonomy.policyVersion) {
                    errors.push(`${player.agentId}: existing autonomy baseline conflicts`);
                }
            }
        }
        const institution = agents.getIdentity(fixture.business.institutionAgentId);
        if (!institution) changes.push(`agent:${fixture.business.institutionAgentId}`);
        else {
            const profile = agents.getControlProfile(institution.agentId);
            if (profile?.role !== 'institution' || profile.subjectKind !== 'business'
                || profile.subjectId !== fixture.business.businessId) errors.push('Existing Business institution binding conflicts');
        }
        } finally { agents.close(); }
    }
    const businessPath = paths.businessPath ?? businessManagerDbPath;
    if (!existsSync(businessPath)) changes.push(`business:${fixture.business.businessId}`);
    else {
        const businesses = new BusinessManagerStore(businessPath);
        try {
        const current = businesses.get(fixture.business.businessId);
        if (!current) changes.push(`business:${fixture.business.businessId}`);
        else {
            if (current.ownerAgentId !== fixture.business.institutionAgentId
                || current.propertyId !== fixture.business.property.propertyId || current.name !== fixture.business.name
                || current.summary !== fixture.business.summary || current.status !== 'active') {
                errors.push('Existing Business baseline conflicts');
            }
            for (const employment of fixture.business.employments) {
                const existing = current.employments.find(item => item.employmentId === employment.employmentId);
                if (!existing) changes.push(`employment:${employment.employmentId}`);
                else if (existing.workerAgentId !== employment.workerAgentId || existing.role !== employment.role
                    || existing.title !== employment.title || existing.wageGp !== employment.wageGp
                    || digest(existing.requiredSkill) !== digest(employment.requiredSkill) || existing.status !== 'active') {
                    errors.push(`Existing employment baseline conflicts: ${employment.employmentId}`);
                }
            }
            const policy = current.policyProposals.find(item => item.proposalId === fixture.business.policy.proposalId);
            if (!policy) changes.push(`business-policy:${fixture.business.policy.proposalId}`);
            else if (policy.status !== 'approved' || policy.objective !== fixture.business.policy.objective
                || policy.mode !== fixture.business.policy.mode || policy.maxRewardGp !== fixture.business.policy.maxRewardGp
                || digest(policy.preferredSkills) !== digest(fixture.business.policy.preferredSkills)) {
                errors.push('Existing Business policy baseline conflicts');
            }
        }
        } finally { businesses.close(); }
    }
    const treasuryPath = paths.treasuryPath ?? institutionTreasuryDbPath;
    if (!existsSync(treasuryPath)) changes.push(`treasury:business:${fixture.business.businessId}`);
    else {
        const treasury = new InstitutionTreasuryStore(treasuryPath);
        try {
            const current = treasury.get('business', fixture.business.businessId);
            if (!current) changes.push(`treasury:business:${fixture.business.businessId}`);
            else if (current.reservedGp > fixture.business.treasury.balanceGp) {
                errors.push('Existing treasury reservations exceed the fixture balance');
            } else if (current.balanceGp !== fixture.business.treasury.balanceGp) {
                changes.push(`treasury:business:${fixture.business.businessId}`);
            }
        } finally { treasury.close(); }
    }
    return { ok: errors.length === 0, baselineDigest: fixture.baselineDigest, errors, warnings,
        changes: [...new Set(changes)].sort(), players, properties };
}

function sqliteSnapshot(source: string, destination: string): string | null {
    if (!existsSync(source)) return null;
    mkdirSync(dirname(destination), { recursive: true });
    const database = new Database(source, { strict: true });
    try {
        const escaped = destination.replaceAll("'", "''");
        database.run(`VACUUM INTO '${escaped}'`);
        return destination;
    } finally { database.close(true); }
}

function seedAgentState(fixture: ProtoSocietyFixture, path: string, now: string,
    provenance: (key: string, value: unknown) => void): void {
    const store = new AgentStateStore(path);
    try {
        for (const player of fixture.players) {
            if (!store.getIdentity(player.agentId)) store.createIdentity({ agentId: player.agentId,
                playerUsername: player.username, displayName: player.displayName, background: player.background,
                personalityTraits: player.personalityTraits, controlProfile: playerControlProfile(player) }, now);
            const controlProfile = store.getControlProfile(player.agentId);
            if (!samePlayerControlProfile(controlProfile, player)) {
                if (!controlProfile) throw new Error(`Missing control profile after identity seed: ${player.agentId}`);
                store.setControlProfile(player.agentId, controlProfile.revision, playerControlProfile(player), now);
            }
            for (const skill of player.knownSkills) if (!store.getSkillKnowledge(player.agentId, skill)) {
                store.setSkillKnowledge(player.agentId, skill, 'known', null, now);
            }
            for (const goal of player.goals) {
                const current = store.getGoal(goal.goalId);
                if (!current) store.createGoal(player.agentId, { ...goal, execution: goal.skill ? {
                    policy: 'recurring',
                    cooldownMs: goal.skill.id === 'shopping.lumbridge.buy-hammers' ? 600_000 : 60_000,
                    binding: { sourceKind: 'goal', sourceId: goal.goalId,
                        parameters: goal.skill.id === 'shopping.lumbridge.buy-hammers'
                            ? { 'target-items': 1 } : {} }
                } : null }, now);
                else if (digest(goalPayload(current)) !== digest(goalPayload(goal))) {
                    throw new Error(`Existing goal conflicts with fixture: ${goal.goalId}`);
                }
            }
            for (const memory of player.memorySeeds) store.createEpisode(player.agentId, {
                ...memory, source: 'system', trust: 'trusted', externalKey: `fixture:${fixture.baselineDigest}:${memory.episodeId}`,
                occurredAt: now
            }, now);
            const enrollment = store.getAutonomyEnrollment(player.agentId);
            if (!enrollment) store.createAutonomyEnrollment(player.agentId, player.autonomy, now);
            else if (enrollment.policyId !== player.autonomy.policyId
                || enrollment.policyVersion !== player.autonomy.policyVersion) {
                throw new Error(`Existing autonomy policy conflicts with fixture: ${player.agentId}`);
            }
            provenance(`agent:${player.agentId}`, { player, provenance: fixture.provenance });
        }
        if (!store.getIdentity(fixture.business.institutionAgentId)) store.createIdentity({
            agentId: fixture.business.institutionAgentId, displayName: 'Varrock Forge Mind',
            background: 'Avatarless institution agent for the bounded Varrock Forge fixture.',
            personalityTraits: ['prudent', 'contractual'], controlProfile: { role: 'institution',
                subjectKind: 'business', subjectId: fixture.business.businessId, decisionIntervalMs: 300_000,
                maxDecisionsPerDay: 48, dailyLlmBudgetMicros: 500_000, dailyOperationalBudgetGp: 1_000 }
        }, now);
        provenance(`agent:${fixture.business.institutionAgentId}`, fixture.business.institutionAgentId);
        for (const workOrder of fixture.business.workOrders) {
            const existing = store.getPlayerActionRequest(workOrder.requestId);
            if (!existing) store.createPlayerActionRequest(fixture.business.institutionAgentId, workOrder, now);
            else if (existing.requesterAgentId !== fixture.business.institutionAgentId
                || existing.assigneeAgentId !== workOrder.assigneeAgentId
                || existing.skill.id !== workOrder.skill.id || existing.skill.version !== workOrder.skill.version
                || existing.rewardGp !== workOrder.rewardGp) {
                throw new Error(`Existing work order conflicts with fixture: ${workOrder.requestId}`);
            }
            provenance(`work-order:${workOrder.requestId}`, workOrder);
        }
    } finally { store.close(); }
}

function seedBusiness(fixture: ProtoSocietyFixture, businessPath: string, treasuryPath: string, now: string,
    provenance: (key: string, value: unknown) => void): void {
    const store = new BusinessManagerStore(businessPath);
    try {
        let business = store.get(fixture.business.businessId);
        if (!business) business = store.create({ businessId: fixture.business.businessId, name: fixture.business.name,
            summary: fixture.business.summary, ownerAgentId: fixture.business.institutionAgentId,
            propertyId: fixture.business.property.propertyId }, now);
        for (const employment of fixture.business.employments) {
            const existing = business.employments.find(item => item.employmentId === employment.employmentId);
            if (!existing) store.hire(business.businessId, employment, now, employment.employmentId);
            else if (existing.workerAgentId !== employment.workerAgentId || existing.status !== 'active') {
                throw new Error(`Existing employment conflicts with fixture: ${employment.employmentId}`);
            }
        }
        business = store.get(business.businessId)!;
        let policy = business.policyProposals.find(item => item.proposalId === fixture.business.policy.proposalId);
        if (!policy) policy = store.proposePolicy(business.businessId, {
            ...fixture.business.policy, proposerAgentId: fixture.business.institutionAgentId
        }, now);
        if (policy.status === 'pending') policy = store.resolvePolicy(business.businessId, policy.proposalId,
            policy.revision, 'approve', fixture.business.policy.approvalNote, now);
        if (policy.status !== 'approved') throw new Error('Fixture Business policy is not approved');
        provenance(`business:${business.businessId}`, { business: store.get(business.businessId),
            property: fixture.business.property });
    } finally { store.close(); }
    const treasury = new InstitutionTreasuryStore(treasuryPath);
    try {
        let account = treasury.ensure('business', fixture.business.businessId, now);
        if (account.balanceGp !== fixture.business.treasury.balanceGp) account = treasury.setBalance('business',
            account.id, account.revision, fixture.business.treasury.balanceGp, now);
        provenance(`treasury:business:${account.id}`, account);
    } finally { treasury.close(); }
}

export async function applyProtoSocietyFixture(fixture: ProtoSocietyFixture,
    adapters: FixtureBootstrapAdapters = defaultAdapters, paths: FixtureBootstrapPaths = {},
    now = new Date().toISOString()): Promise<{ application: FixtureApplication; preflight: FixturePreflight }> {
    const resolved = { agent: paths.agentPath ?? agentStateDbPath, business: paths.businessPath ?? businessManagerDbPath,
        treasury: paths.treasuryPath ?? institutionTreasuryDbPath,
        ledger: paths.ledgerPath ?? fixtureBootstrapDbPath, backups: paths.backupsDir ?? fixtureBackupsDir };
    const ledger = new FixtureBootstrapStore(resolved.ledger);
    const current = ledger.get(fixture.fixtureId);
    if (current?.baselineDigest !== undefined && current.baselineDigest !== fixture.baselineDigest
        && current.status !== 'rolled-back') {
        ledger.close();
        throw new Error('Fixture id is already bound to another baseline digest');
    }
    if (current?.status === 'completed') {
        ledger.close();
        return { application: current, preflight: await preflightProtoSocietyFixture(fixture, adapters, paths) };
    }
    if (current?.status === 'rollback-required') {
        ledger.close(); throw new Error(`Fixture application requires rollback handling: ${current.status}`);
    }
    const preflight = await preflightProtoSocietyFixture(fixture, adapters, paths);
    if (!preflight.ok) { ledger.close(); throw new Error(`Fixture preflight failed: ${preflight.errors.join('; ')}`); }
    const applyId = randomUUID(), backupRoot = join(resolved.backups, `${fixture.fixtureId}-${applyId}`);
    const rollbackPlan: Record<string, unknown> = current && current.status !== 'rolled-back' ? current.rollbackPlan
        : { applyId, baselineDigest: fixture.baselineDigest,
        sqlite: { agent: sqliteSnapshot(resolved.agent, join(backupRoot, 'agents.sqlite')),
            business: sqliteSnapshot(resolved.business, join(backupRoot, 'businesses.sqlite')),
            treasury: sqliteSnapshot(resolved.treasury, join(backupRoot, 'institution-treasury.sqlite')) },
        engineSaves: {}, engineRestored: [], databasesRestored: false, requiresStoppedStack: true };
    let application = ledger.begin(fixture.fixtureId, fixture.baselineDigest, applyId, rollbackPlan, now);
    const provenance = (key: string, value: unknown) => ledger.record(fixture.fixtureId,
        fixture.baselineDigest, key, digest(value), now);
    try {
        const engineSaves = { ...(application.rollbackPlan.engineSaves as Record<string, string> ?? {}) };
        for (const player of fixture.players) {
            const inspection = preflight.players[player.username]!;
            if (!inspection.state) throw new Error(`Missing preflight save: ${player.username}`);
            if (digest(savePayload(inspection.state)) !== digest(desiredSavePayload(player))) {
                const result = await adapters.editPlayer(player.username, saveDraft(player, inspection.state), randomUUID());
                if (result.backupId) {
                    engineSaves[player.username] = result.backupId;
                    application = ledger.updateRollback(fixture.fixtureId, application.revision,
                        { ...application.rollbackPlan, engineSaves }, now);
                }
                if (!result.backupId || !result.after
                    || digest(savePayload(result.after)) !== digest(desiredSavePayload(player))) {
                    throw new Error(`Engine did not verify the exact fixture save for ${player.username}`);
                }
            }
            provenance(`engine-save:${player.username}:position`, player.position);
            provenance(`engine-save:${player.username}:skills`, desiredSkills(player));
            provenance(`engine-save:${player.username}:inventory`, player.inventory);
            provenance(`engine-save:${player.username}:equipment`, player.equipment);
            provenance(`engine-save:${player.username}:bank`, player.bank);
            provenance(`engine-save:${player.username}:coins`, player.coins);
        }
        seedAgentState(fixture, resolved.agent, now, provenance);
        seedBusiness(fixture, resolved.business, resolved.treasury, now, provenance);
        provenance(`property:${fixture.business.property.propertyId}`, fixture.business.property);
        for (const dependency of fixture.externalDependencies) provenance(`external:${dependency.dependencyId}`, dependency);
        application = ledger.finish(fixture.fixtureId, application.revision, 'completed', null, now);
        return { application, preflight };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        application = ledger.finish(fixture.fixtureId, application.revision, 'rollback-required', message, now);
        throw new Error(`Fixture bootstrap is partial and requires rollback: ${message}`);
    } finally { ledger.close(); }
}

function resolvedPaths(paths: FixtureBootstrapPaths): Required<FixtureBootstrapPaths> {
    return { agentPath: paths.agentPath ?? agentStateDbPath,
        businessPath: paths.businessPath ?? businessManagerDbPath,
        treasuryPath: paths.treasuryPath ?? institutionTreasuryDbPath,
        ledgerPath: paths.ledgerPath ?? fixtureBootstrapDbPath,
        backupsDir: paths.backupsDir ?? fixtureBackupsDir };
}

/** First rollback phase: restore engine-owned player saves while the engine is available. */
export async function restoreProtoSocietyEngineSaves(fixtureId: string,
    adapters: FixtureBootstrapAdapters = defaultAdapters, paths: FixtureBootstrapPaths = {},
    now = new Date().toISOString()): Promise<FixtureApplication> {
    const resolved = resolvedPaths(paths), ledger = new FixtureBootstrapStore(resolved.ledgerPath);
    try {
        let application = ledger.get(fixtureId);
        if (!application) throw new Error('Fixture application does not exist');
        if (application.status === 'rolled-back') return application;
        if (application.status !== 'rollback-required') application = ledger.requireRollback(fixtureId,
            application.revision, 'Operator-requested fixture rollback', now);
        const backups = application.rollbackPlan.engineSaves as Record<string, string> | undefined;
        const restored = new Set(application.rollbackPlan.engineRestored as string[] | undefined ?? []);
        for (const [username, backupId] of Object.entries(backups ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
            if (restored.has(username)) continue;
            const inspection = await adapters.inspectPlayer(username);
            if (!inspection.editable || !inspection.state) throw new Error(`${username}: save is not offline/editable for rollback`);
            const result = await adapters.restorePlayer(username, backupId, inspection.state.savedAt, randomUUID());
            if (!result.after) throw new Error(`${username}: engine did not verify the restored save`);
            restored.add(username);
            application = ledger.updateRollback(fixtureId, application.revision,
                { ...application.rollbackPlan, engineRestored: [...restored].sort() }, now);
        }
        return application;
    } finally { ledger.close(); }
}

function restoreDatabase(backup: unknown, destination: string): void {
    rmSync(`${destination}-wal`, { force: true });
    rmSync(`${destination}-shm`, { force: true });
    if (backup === null) rmSync(destination, { force: true });
    else {
        if (typeof backup !== 'string' || !existsSync(backup)) {
            throw new Error(`Fixture database backup is missing: ${destination}`);
        }
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(backup, destination);
    }
}

/** Second rollback phase: restore SQLite files only after the whole local stack has stopped. */
export function restoreProtoSocietyDatabases(fixtureId: string, stackStopped: true,
    paths: FixtureBootstrapPaths = {}, now = new Date().toISOString()): FixtureApplication {
    if (stackStopped !== true) throw new Error('Database rollback requires an explicitly stopped local stack');
    const resolved = resolvedPaths(paths), ledger = new FixtureBootstrapStore(resolved.ledgerPath);
    try {
        let application = ledger.get(fixtureId);
        if (!application) throw new Error('Fixture application does not exist');
        if (application.status === 'rolled-back') return application;
        if (application.status !== 'rollback-required') throw new Error('Engine-save rollback must start before database rollback');
        const backups = application.rollbackPlan.engineSaves as Record<string, string> | undefined;
        const restored = new Set(application.rollbackPlan.engineRestored as string[] | undefined ?? []);
        const missing = Object.keys(backups ?? {}).filter(username => !restored.has(username));
        if (missing.length) throw new Error(`Engine saves still require rollback: ${missing.join(', ')}`);
        const sqlite = application.rollbackPlan.sqlite as Record<string, unknown> | undefined;
        if (!sqlite) throw new Error('Fixture database rollback plan is missing');
        restoreDatabase(sqlite.agent, resolved.agentPath);
        restoreDatabase(sqlite.business, resolved.businessPath);
        restoreDatabase(sqlite.treasury, resolved.treasuryPath);
        application = ledger.updateRollback(fixtureId, application.revision,
            { ...application.rollbackPlan, databasesRestored: true }, now);
        return ledger.finish(fixtureId, application.revision, 'rolled-back', null, now);
    } finally { ledger.close(); }
}
