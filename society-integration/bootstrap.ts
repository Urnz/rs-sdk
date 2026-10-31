import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentStateStore } from '../agent-state/store.js';
import { SimulationClockStore } from '../simulation-clock/store.js';
import { simulationClockProfileDigest } from '../simulation-clock/profile.js';
import { SocietyIntegrityStore } from '../society-integrity/store.js';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { BusinessManagerStore } from '../server/gateway/admin/business-manager.js';
import { BusinessWorkStore } from '../business-work/work.js';
import { workUuid } from '../business-work/binding.js';
import { resolveAdminSkill, resolveAdminDraftSkill } from '../server/gateway/admin/skill-catalog.js';
import { FixtureBootstrapStore } from '../server/gateway/admin/fixture-bootstrap-store.js';
import { startAdminWorldGenesis, type WorldGenesisAdminAdapter } from '../server/gateway/admin/world-genesis.js';
import { populationNeedsBinding, populationNeedsOptions, readPopulationNeeds } from '../server/gateway/admin/needs-runtime.js';
import { LIVELIHOOD_BINDING_SOURCE, LIVELIHOOD_POLICY } from '../server/gateway/admin/livelihood-policy.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { check, inspectIntegrationReferences, integrationGenesis, integrationWorldId, operationalSkillDigest, validateIntegrationFixture, type IntegrationFixture } from './fixture.js';
import type { RegisteredSkill } from '../agent-skills/types.js';
import { loadSurvivalProfile } from '../needs/survival.js';

import {INTEGRATION_STATE,FOOD_TRIAL_STATE} from './state-paths.js';
export {INTEGRATION_STATE,FOOD_TRIAL_STATE};
export function integrationPaths(root: string) {
    const path = (p: string) => join(root, p);
    return { agentPath: path('.local/agent-state/agents.sqlite'), businessPath: path('.local/economy/businesses.sqlite'),
        treasuryPath: path('.local/economy/institution-treasury.sqlite'), clockPath: path('.local/simulation/simulation-clock.sqlite'),
        ledgerPath: path('.local/admin/fixture-bootstrap.sqlite'), runDbPath: path('.local/simulation/world-genesis-runs.sqlite'),
        provenanceDbPath: path('.local/simulation/world-genesis-provenance.sqlite'), integrityDbPath: path('.local/simulation/society-integrity.sqlite'),
        integrityPolicyPath: path('config/society-integrity-policy.json') };
}
export type VerifiedSkillReader = (id: string, version: string) => Promise<RegisteredSkill>;
export async function preflightIntegrationDefinition(root: string, input: IntegrationFixture, readSkill?: VerifiedSkillReader) {
    const fixture = validateIntegrationFixture(input), references = inspectIntegrationReferences(root, fixture);
    const errors: string[] = [], verifiedSkills: { id: string; version: string; checksum: string }[] = [];
    for (const pin of fixture.skills) {
        try {
            const skill = await (readSkill?.(pin.id, pin.version) ?? resolveAdminSkill(`${pin.id}@${pin.version}`,
                { catalogRoot: join(root, 'agent-skills/catalog'), localRoot: join(root, '.local/agent-skills') }));
            check(skill.definition.id === pin.id && skill.definition.version === pin.version && skill.definition.status === 'verified'
                && skill.definition.sharing.visibility === 'shared' && operationalSkillDigest(skill.definition) === pin.definitionDigest,
                `Verified procedure reference/content differs: ${pin.id}`);
            verifiedSkills.push({ id: pin.id, version: pin.version, checksum: skill.checksum });
        } catch (error) { errors.push(error instanceof Error ? error.message : 'Verified procedure unavailable'); }
    }
    return { schemaVersion: 1, fixtureDigest: fixture.digest, definitionReady: true, executableSkillsReady: errors.length === 0,
        verifiedSkills, references, errors, liveAcceptance: 'not-run',
        routeStatus: 'Requires native path/travel acceptance before SI-A15; no transport, relocation or four-slot housing is invented' };
}
export interface IntegrationBootstrapPorts {
    /** Called only in a fresh staging directory. Must create empty native saves with exact personal XP/position, never credentials. */
    seedNativeAvatars(root: string, fixture: IntegrationFixture): Promise<void>;
    genesis(root: string, fixture: IntegrationFixture, clock: SimulationClockStore): WorldGenesisAdminAdapter;
    closeNativeBaseline(root: string, fixture: IntegrationFixture, clock: SimulationClockStore): Promise<void>;
    readVerifiedSkill?: VerifiedSkillReader;
}
/** The caller supplies a NEW staging workspace and must publish it atomically only on success. No live reset or refill path. */
export async function bootstrapIntegrationStage(rootInput: string, input: IntegrationFixture, ports: IntegrationBootstrapPorts) {
    return bootstrapStage(rootInput, input, ports, false);
}
/** A separate disposable trial world. Drafts retain their status; this path never emits an integration receipt or seal. */
export async function bootstrapFoodTrialStage(rootInput: string, input: IntegrationFixture, ports: IntegrationBootstrapPorts) {
    check(!ports.readVerifiedSkill, 'Trial provisioning cannot replace the canonical skill reader');
    return bootstrapStage(rootInput, input, ports, true);
}
async function bootstrapStage(rootInput: string, input: IntegrationFixture, ports: IntegrationBootstrapPorts, trial: boolean) {
    const root = resolve(rootInput), fixture = validateIntegrationFixture(input), paths = integrationPaths(root);
    check(!trial||!fixture.founderBaseline,'Common founder definitions require the normal verified integration bootstrap, never a draft trial');
    const stage = join(root, '.integration-stage.json');
    check(!existsSync(join(root, FOOD_TRIAL_STATE)), 'A food trial world cannot be adopted as an integration baseline or reset');
    if (existsSync(join(root, INTEGRATION_STATE))) {
        check(!trial, 'An integration world cannot be adopted as a draft trial');
        const current = readIntegrationBaseline(root, fixture);
        check(current.fixtureDigest === fixture.digest, 'Fixture replay is bound to another digest');
        const { verifyNativeIntegrationSeal } = await import('./baseline.js');
        verifyNativeIntegrationSeal(root, fixture);
        return { replayed: true, ...current };
    }
    check(existsSync(stage) && JSON.parse(readFileSync(stage, 'utf8')).fixtureDigest === fixture.digest, 'Integration apply requires its new isolated staging workspace');
    check(!existsSync(paths.ledgerPath) && !existsSync(paths.agentPath) && !existsSync(paths.clockPath), 'Existing world state cannot be adopted or reset as an integration fixture');
    if (fixture.survival) check(loadSurvivalProfile(root)?.rulesDigest === fixture.survival.rulesDigest, 'Survival stage configuration is missing');
    const preflight = trial ? await preflightFoodTrials(root, fixture) : await preflightIntegrationDefinition(root, fixture, ports.readVerifiedSkill);
    check(preflight.executableSkillsReady, `Integration preflight failed: ${preflight.errors.join('; ')}`);
    const time = fixture.clock.initialSimulationTime;
    writeFileSync(join(root, 'config/simulation-clock.json'), JSON.stringify({ schemaVersion: 1, ...fixture.clock }, null, 2) + '\n');
    mkdirSync(join(root, 'server/engine/data/config'), { recursive: true });
    writeFileSync(join(root, 'server/engine/data/config/world.json'), JSON.stringify({ node: { shopEconomyMode: 'closed-society', xpRate: 1, debug: false } }, null, 2) + '\n', { flag: 'wx' });
    const clock = new SimulationClockStore(paths.clockPath);
    try {
        clock.create({ clockId: fixture.clock.clockId, profile: fixture.clock.profile, wallTime: time, simulationTime: time, status: 'paused' });
        const shared = { store: clock, clockId: fixture.clock.clockId }, agents = new AgentStateStore(paths.agentPath, shared);
        try {
            for (const actor of fixture.avatars) {
                agents.createIdentity({ agentId: actor.agentId, playerUsername: actor.username, displayName: actor.username,
                    background: `Finite integration bootstrap; capabilities: ${actor.capabilities.join(', ')}.`, personalityTraits: ['steady'],
                    controlProfile: { role: 'player', subjectKind: 'player', subjectId: actor.username, avatarPlayerUsername: actor.username,
                        decisionIntervalMs: 10000, maxDecisionsPerDay: 1000, dailyLlmBudgetMicros: 0, dailyOperationalBudgetGp: actor.coinsGp } }, time);
                for (const id of actor.knownSkills) agents.setSkillKnowledge(actor.agentId, fixture.skills.find(s => s.id === id)!, 'known', null, time);
                if (!trial&&!fixture.founderBaseline) agents.createAutonomyEnrollment(actor.agentId, { status: 'desired', policyId: LIVELIHOOD_POLICY.id, policyVersion: LIVELIHOOD_POLICY.version }, time);
                if (!trial && !fixture.founderBaseline && actor.capabilities.includes('gather')) {
                    const skill = fixture.skills.find(s => s.id === 'procedure.food.gather-lobster')!;
                    const life = agents.createGoal(actor.agentId, { goalId: `si-life-${actor.agentId}`, parentGoalId: null, horizon: 'life', title: 'Maintain livelihood', description: 'Finite native food society.', priority: 50 }, time);
                    const long = agents.createGoal(actor.agentId, { goalId: `si-long-${actor.agentId}`, parentGoalId: life.goalId, horizon: 'long-term', title: 'Supply food', description: 'Finite native lobster supply.', priority: 50 }, time);
                    const current = agents.createGoal(actor.agentId, { goalId: `si-current-${actor.agentId}`, parentGoalId: long.goalId, horizon: 'current', title: 'Gather bounded supply', description: 'Use only the pinned native quota.', priority: 50 }, time);
                    agents.createGoal(actor.agentId, { goalId: `si-supply-${actor.agentId}`, parentGoalId: current.goalId, horizon: 'immediate', title: 'Gather one lobster', description: 'Exactly one native attempt, then re-evaluate.', priority: 50, skill,
                        execution: { policy: 'recurring', cooldownMs: 30000, binding: { sourceKind: 'approved-policy', sourceId: LIVELIHOOD_BINDING_SOURCE, parameters: {} } } }, time);
                }
            }
            agents.createIdentity({ agentId: fixture.kitchen.institutionAgentId, displayName: 'Integration kitchen', background: 'Avatarless finite kitchen Business.',
                personalityTraits: ['prudent'], controlProfile: { role: 'institution', subjectKind: 'business', subjectId: fixture.kitchen.businessId,
                    decisionIntervalMs: 10000, maxDecisionsPerDay: 1000, dailyLlmBudgetMicros: 0, dailyOperationalBudgetGp: fixture.kitchen.treasuryGp } }, time);
            if (!trial&&!fixture.founderBaseline) agents.createAutonomyEnrollment(fixture.kitchen.institutionAgentId, { status: 'desired', policyId: LIVELIHOOD_POLICY.id, policyVersion: LIVELIHOOD_POLICY.version }, time);
        } finally { agents.close(); }
        await ports.seedNativeAvatars(root, fixture);
        const result = integrationGenesis(root, fixture), adapter = ports.genesis(root, fixture, clock);
        const application = await startAdminWorldGenesis(result, result.resultDigest, adapter, paths, time);
        check(application.status === 'applied', 'Genesis did not commit');
        const manager = new BusinessManagerStore(paths.businessPath);
        try {
            // The institution directs the business; its existing human owner remains a separate avatar.
            const k = fixture.kitchen, business = manager.get(k.businessId)!;
            manager.update(k.businessId, business.revision, { name: business.name, summary: business.summary, propertyId: business.propertyId, status: 'active' }, time);
            for (const [workerAgentId, roleDefinitionId, title, wageGp, id] of [
                [k.cookAgentId, 'business.cook.v1', 'Cook', k.cookWageGp, 'procedure.food.cook-lobster'],
                [k.courierAgentId, 'business.delivery.v1', 'Courier', k.deliveryWageGp, 'trade.lumbridge.give-item']
            ] as const) manager.hire(k.businessId, { workerAgentId, roleDefinitionId, title, wageGp, requiredSkill: fixture.skills.find(s => s.id === id)! }, time,
                workUuid(`${fixture.digest}:${roleDefinitionId}`));
            const policy = manager.proposePolicy(k.businessId, { proposalId: workUuid(`${fixture.digest}:policy`), proposerAgentId: k.institutionAgentId,
                objective: 'Cook and exchange finite native lobster; no external shop fallback.', mode: 'balanced', maxRewardGp: Math.max(k.cookWageGp, k.deliveryWageGp),
                preferredSkills: fixture.skills }, time);
            manager.resolvePolicy(k.businessId, policy.proposalId, policy.revision, 'approve', 'Source-controlled finite integration bootstrap.', time);
        } finally { manager.close(); }
        if(fixture.founderBaseline){
            const manager=new BusinessManagerStore(paths.businessPath);
            try{
                const business=manager.get('si-c07-workshop');check(business?.status==='active','Founder workshop genesis is missing');
                manager.hire('si-c07-workshop',{workerAgentId:fixture.kitchen.courierAgentId,roleDefinitionId:'business.worker.v1',title:'Founder smith',wageGp:0,
                    requiredSkill:fixture.skills.find(s=>s.id==='procedure.tools.repair-bronze-pickaxe')!},time,workUuid(`${fixture.digest}:founder-worker`));
            }finally{manager.close();}
        }
        const work = new BusinessWorkStore(paths.businessPath);
        try { for (const capability of ['cooking.heat-source', 'storage.secure']) work.grantEntitlement({ entitlementId: `si-${capability.replaceAll('.', '-')}`,
            businessId: fixture.kitchen.businessId, propertyId: fixture.kitchen.propertyId, facilityCapability: capability, validFrom: time,
            // Property-backed standing permission is not a work schedule. Work orders
            // use wall time while native facility checks use SimulationClock time.
            validUntil: null }, time);
            if(fixture.founderBaseline)work.grantEntitlement({entitlementId:'si-c07-workshop-surface',businessId:'si-c07-workshop',
                propertyId:'varrock.east-workshop',facilityCapability:'work-surface',validFrom:time,validUntil:null},time);
        } finally { work.close(); }
        await ports.closeNativeBaseline(root, fixture, clock);
        const members = new AgentStateStore(paths.agentPath, shared);
        let lifecycles;
        try { lifecycles = fixture.avatars.map(a => { const member = members.getPopulationMember(a.agentId)!;
            const needs = readPopulationNeeds({ ...populationNeedsOptions(root), worldId: integrationWorldId(fixture) }, member);
            check(needs.status === 'initialized' && needs.state?.state.observedAtSimulationTime === time, 'Exact initial needs binding is missing');
            return { agentId: a.agentId, username: a.username, binding: populationNeedsBinding(integrationWorldId(fixture), member), needsDigest: needs.state.state.digest }; }); }
        finally { members.close(); }
        const integrity = new SocietyIntegrityStore(paths.integrityDbPath, true);
        try { check(integrity.get(result.resultId)?.status === 'observing', 'Bootstrap integrity is not observing'); } finally { integrity.close(); }
        const receipt = { schemaVersion: 1, fixtureDigest: fixture.digest, worldId: integrationWorldId(fixture), resultId: result.resultId, resultDigest: result.resultDigest,
            clockId: fixture.clock.clockId, clockProfileDigest: simulationClockProfileDigest(fixture.clock.profile), initialSimulationTime: time,
            lifecycles, ...(trial ? { trialSkills: preflight.verifiedSkills } : { verifiedSkills: preflight.verifiedSkills }),
            references: preflight.references, acceptance: trial ? 'draft-trial-only' : 'not-run',
            requiredRuntimeEnvironment: { PLAYER_CHECKPOINT_DATABASE: 'data/player-checkpoints.sqlite', GE_DATABASE: 'data/player-checkpoints.sqlite', TRADE_EVIDENCE_DB: 'data/mods/trade-evidence.sqlite',
                PLAYER_ESCROW_SHARED_CHECKPOINT: 'true', NODE_SHOP_ECONOMY_MODE: 'closed-society', NODE_XPRATE: '1' } };
        const ledger = new FixtureBootstrapStore(paths.ledgerPath);
        try { const row = ledger.begin(fixture.fixtureId, fixture.digest, workUuid(fixture.digest), { stagedWorkspaceOnly: true, rollback: 'discard-unpublished-stage' }, time);
            ledger.record(fixture.fixtureId, fixture.digest, 'native-genesis', digest(receipt), time); ledger.finish(fixture.fixtureId, row.revision, 'completed', null, time); }
        finally { ledger.close(); }
        mkdirSync(join(root, '.local/simulation'), { recursive: true });
        writeFileSync(join(root, trial ? FOOD_TRIAL_STATE : INTEGRATION_STATE), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
        return { replayed: false, ...receipt };
    } finally { clock.close(); }
}

async function preflightFoodTrials(root: string, fixture: IntegrationFixture) {
    const references = inspectIntegrationReferences(root, fixture), verifiedSkills = [];
    for (const pin of fixture.skills) {
        const options = { catalogRoot: join(root, 'agent-skills/catalog'), localRoot: join(root, '.local/agent-skills') };
        const registered = await resolveAdminSkill(`${pin.id}@${pin.version}`, options).catch(error => {
            if (!pin.id.startsWith('procedure.food.')) throw error;
            // A new utility trial can retain the already published food chain.
            // An obsolete food draft remains rejected by the normal strict draft resolver.
            return resolveAdminDraftSkill(`${pin.id}@${pin.version}`, options);
        });
        check(operationalSkillDigest(registered.definition) === pin.definitionDigest, 'Trial draft content differs');
        verifiedSkills.push({ id: pin.id, version: pin.version, checksum: registered.checksum, status: registered.definition.status });
    }
    return { executableSkillsReady: true, errors: [], references, verifiedSkills };
}

/** Read-only baseline identity check. Opening a preflight must never migrate the AgentState/clock stores. */
export function readIntegrationBaseline(root: string, fixture: IntegrationFixture) {
    const paths = integrationPaths(root), receipt = JSON.parse(readFileSync(join(root, INTEGRATION_STATE), 'utf8'));
    check(receipt.fixtureDigest === validateIntegrationFixture(fixture).digest, 'Baseline fixture digest differs');
    const db = new OwnedDatabase(paths.clockPath, { readonly: true, strict: true });
    try { const row = db.query('SELECT * FROM simulation_clock WHERE clock_id=?1').get(fixture.clock.clockId) as any;
        check(row && row.status === 'paused' && row.profile_digest === receipt.clockProfileDigest && row.last_simulation_ms === Date.parse(receipt.initialSimulationTime),
            'Baseline clock has moved or differs'); } finally { db.close(true); }
    return receipt;
}
