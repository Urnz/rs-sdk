import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { AgentStateStore, type AgentStateSimulationClock } from '../../../agent-state/store.js';
import { loadPopulationAgePolicy } from '../../../population-lifecycle/age.js';
import { loadPopulationLifecyclePolicyCatalog, loadPopulationWorldProfileBindingCatalog, resolvePopulationLifecyclePolicy } from '../../../population-lifecycle/config.js';
import { loadWorldGenesisProfileCatalog } from '../../../world-genesis/config.js';
import { buildPopulationDemographics, demographicVerified, demographicUnavailable, loadDemographicPolicy, verifyDemographicDeaths,
    type DemographicAgents, type DemographicInheritance } from '../../../population-lifecycle/demographics.js';
import { healthDigest, healthTime } from '../../../population-health/policy.js';
import { PlayerHealthEvidenceStore } from '../../engine/src/mods/PlayerHealthEvidenceStore.js';
import { PopulationEstateStore } from '../../../population-estate/store.js';
import type { EstateRuntimeOptions } from '../../../population-estate/runtime.js';
import type { EstateSourceReceipt } from '../../../population-estate/source.js';
import { verifyInheritanceTransfers } from '../../../population-estate/inheritance-transfer.js';
import { ESTATE_DOMAINS } from '../../../population-estate/schema.js';
import type { SimulationClockObservation } from '../../../simulation-clock/types.js';
import { defaultEstateRuntimeOptions } from './population-estate-runtime.js';
import { agentStateDbPath, populationHealthEngineEvidencePath, repoRoot } from './paths.js';

export interface PopulationDemographicOptions {
    agentPath: string; enginePath: string; configDirectory: string;
    estate: EstateRuntimeOptions; simulationClock: AgentStateSimulationClock;
}
export function populationDemographicDefaults(simulationClock: AgentStateSimulationClock): PopulationDemographicOptions {
    return { agentPath: agentStateDbPath, enginePath: populationHealthEngineEvidencePath,
        configDirectory: join(repoRoot, 'config'), estate: defaultEstateRuntimeOptions(), simulationClock };
}
function capture<T>(read: () => T) {
    try { return demographicVerified(read()); } catch (error) { return demographicUnavailable<T>(error); }
}
function propertySnapshot<T>(path: string, read: (db: Database) => T): T {
    const db = new Database(path, { readonly: true, strict: true }), statements = new Set<{ finalize(): void }>();
    db.query = new Proxy(db.query, { apply(target, receiver, args) { const statement = Reflect.apply(target, receiver, args); statements.add(statement); return statement; } });
    try { let value!: T; db.transaction(() => { value = read(db); }).deferred(); return value; }
    finally { for (const statement of statements) statement.finalize(); db.close(true); }
}
/** Native immutable title history, not an inheritance intent or a present-day listing price. */
export function readDemographicInheritance(options: EstateRuntimeOptions, data: DemographicAgents,
    deaths: ReturnType<typeof verifyDemographicDeaths>): { value: DemographicInheritance; proofDigest: string } {
    const estates = new PopulationEstateStore(options.statePath, true);
    try { return estates.readSnapshot(() => {
        const allCases = estates.list(), cohort = new Set(data.members.map(member => member.agentId));
        const cases = allCases.filter(current => cohort.has(current.agentId));
        const sources = Object.fromEntries(ESTATE_DOMAINS.map(key => [key, resolve(options.sources[key])]));
        const sourcesDigest = healthDigest({ sources, enginePath: options.engineDeathPath });
        return propertySnapshot(options.sources.property, db => {
            const schema = db.query('SELECT version FROM population_estate_source_schema WHERE singleton=1').get() as { version: number } | null;
            if (schema?.version !== 1 || db.query('SELECT 1 FROM population_estate_write_permit').get()) throw new Error('Demographic Property custody schema is unsupported or has a leaked permit');
            const transferTable = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='population_estate_inheritance_transfer'").get();
            const nativeEstateIds = transferTable ? db.query('SELECT DISTINCT estate_id FROM population_estate_inheritance_transfer').all() as Array<{ estate_id: string }> : [];
            if (nativeEstateIds.some(row => !allCases.some(current => current.estateId === row.estate_id))) throw new Error('Demographic inheritance has an orphan transfer receipt');
            let transfers = 0, awaitingCompletion = 0;
            const heirs = new Set<string>(), proofs: unknown[] = [];
            for (const current of cases) {
                const death = deaths.get(current.agentId);
                if (!death || current.deathEventId !== death.eventId || current.deathDigest !== death.eventDigest
                    || current.username !== death.playerUsername || current.deathAtSimulationTime !== death.atSimulationTime
                    || current.sourcesDigest !== sourcesDigest || current.policyDigest !== options.policy.digest)
                    throw new Error('Demographic estate death/policy/source binding conflicts');
                const row = db.query('SELECT receipt_json,receipt_digest FROM population_estate_receipt WHERE estate_id=?1 AND domain=\'property\'')
                    .get(current.estateId) as { receipt_json: string; receipt_digest: string } | null;
                const inheritance = current.inheritance;
                if (!row) {
                    if (current.receipts.property || inheritance || nativeEstateIds.some(row => row.estate_id === current.estateId)) throw new Error('Demographic Property custody receipt disappeared');
                    continue;
                }
                const custody = JSON.parse(row.receipt_json) as EstateSourceReceipt;
                if (healthDigest(custody) !== row.receipt_digest || row.receipt_digest !== current.receipts.property
                    || custody.estateId !== current.estateId || custody.domain !== 'property' || custody.deathDigest !== current.deathDigest
                    || custody.policyDigest !== current.policyDigest) throw new Error('Demographic Property custody receipt conflicts');
                if (inheritance && (inheritance.digest !== healthDigest(inheritance.plan) || inheritance.plan.estateId !== current.estateId
                    || inheritance.plan.deathDigest !== current.deathDigest || inheritance.plan.sourcesDigest !== current.sourcesDigest
                    || !['prepared', 'completed'].includes(inheritance.status))) throw new Error('Demographic inheritance plan conflicts');
                const applied = verifyInheritanceTransfers(db, custody, inheritance?.plan);
                if (inheritance?.status === 'completed' && (applied.size !== inheritance.plan.assets.length || !inheritance.completedAt))
                    throw new Error('Completed inheritance lacks its native Property transfers');
                transfers += applied.size;
                if (applied.size) { heirs.add(inheritance!.plan.heirAgentId); if (inheritance!.status === 'prepared') awaitingCompletion += applied.size; }
                const transferReceipts = transferTable ? db.query(`SELECT property_id,record_digest FROM population_estate_inheritance_transfer
                    WHERE estate_id=?1 ORDER BY property_id`).all(current.estateId) : [];
                proofs.push({ estateId: current.estateId, custodyDigest: row.receipt_digest, transferReceipts, applied: [...applied].sort(), decision: inheritance ?? null });
            }
            const value: DemographicInheritance = { basis: 'cumulative-native-property-history', cases: cases.length,
                blockedCases: cases.filter(current => current.status === 'blocked').length,
                preparedDecisions: cases.filter(current => current.inheritance?.status === 'prepared').length,
                completedDecisions: cases.filter(current => current.inheritance?.status === 'completed').length,
                appliedPropertyTransfers: transfers, distinctHeirs: heirs.size, awaitingCompletionTransfers: awaitingCompletion,
                valueGp: null, windowAttributedTransfers: null };
            return { value, proofDigest: healthDigest({ cases, proofs }) };
        });
    }); } finally { estates.close(); }
}

export function readPopulationDemographics(options: PopulationDemographicOptions, fromSimulationTime: string,
    now = new Date().toISOString()) {
    healthTime(now); healthTime(fromSimulationTime);
    if (resolve(options.agentPath) !== resolve(options.estate.sources.agents) || resolve(options.enginePath) !== resolve(options.estate.engineDeathPath))
        throw new Error('Demographic sources conflict with the estate/gateway authority');
    const state = options.simulationClock.store.get(options.simulationClock.clockId);
    if (!state) throw new Error('Demographic shared SimulationClock is unavailable');
    const clock: SimulationClockObservation = { clockId: state.clockId, profileDigest: state.profileDigest, simulationTime: state.lastSimulationTime,
        wallTime: state.lastObservedWallTime, engineTick: null, status: state.status, revision: state.revision };
    const path = (name: string) => join(options.configDirectory, name);
    const policy = loadDemographicPolicy(path('population-demographics-policy.json')), age = loadPopulationAgePolicy(path('population-age-policy.json'));
    let agents = capture<DemographicAgents>(() => {
        if (!existsSync(options.agentPath)) throw new Error('Demographic AgentState authority is unavailable');
        const store = new AgentStateStore(options.agentPath, undefined, true);
        try { return store.readSnapshot(() => {
            const profiles = loadWorldGenesisProfileCatalog(path('world-genesis-profiles.json')),
                lifecycles = loadPopulationLifecyclePolicyCatalog(path('population-lifecycle-policies.json')),
                bindings = loadPopulationWorldProfileBindingCatalog(path('population-world-profile-bindings.json'));
            const members = store.listPopulationMembers().filter(member => member.simulationClock.clockId === clock.clockId);
            for (const member of members) {
                const profile = profiles.profiles.find(profile => profile.profileId === member.worldProfile.profileId);
                if (!profile || profile.version !== member.worldProfile.version || profile.digest !== member.worldProfile.digest) throw new Error('Demographic world profile binding is stale');
                const lifecycle = resolvePopulationLifecyclePolicy(profile, lifecycles, bindings);
                if (!lifecycle || lifecycle.digest !== member.lifecyclePolicy.digest || lifecycle.policyId !== member.lifecyclePolicy.policyId
                    || lifecycle.version !== member.lifecyclePolicy.version) throw new Error('Demographic finite lifecycle binding is stale');
            }
            const entries = [...new Set(members.filter(member => member.sourceResultId.startsWith('entry-')).map(member => member.sourceResultId))]
                .map(id => { const receipt = store.getPopulationEntry(id); if (!receipt) throw new Error('Demographic entry receipt is unavailable'); return receipt; });
            return { members, entries,
                skills: Object.fromEntries(members.map(member => [member.agentId, store.listSkillKnowledge(member.agentId)])),
                archives: Object.fromEntries(members.map(member => [member.agentId, store.getPopulationMemoryArchive(member.agentId)])),
                projectedDeaths: Object.fromEntries(members.map(member => [member.agentId, store.getPopulationDeath(member.agentId)])) };
        }); } finally { store.close(); }
    });
    let engine = capture(() => {
        const source = new PlayerHealthEvidenceStore(options.enginePath, true);
        try { return source.readSnapshot(() => {
            if (source.schemaVersion !== 2 || !source.isReady(now)) throw new Error('Demographic terminal engine authority is unavailable or stale');
            return source.listDeaths();
        }); } finally { source.close(); }
    });
    let inheritanceProofDigest: string | null = null;
    let inheritance = capture<DemographicInheritance>(() => {
        if (!agents.value || !engine.value) throw new Error('Demographic inheritance requires verified population and death sources');
        const result = readDemographicInheritance(options.estate, agents.value, verifyDemographicDeaths(agents.value, engine.value, clock));
        inheritanceProofDigest = result.proofDigest;
        return result.value;
    });
    if (inheritanceProofDigest) inheritance.digest = inheritanceProofDigest;
    const after = options.simulationClock.store.get(options.simulationClock.clockId);
    if (!after || after.profileDigest !== clock.profileDigest || after.lastSimulationTime !== clock.simulationTime) {
        const issue = 'Shared simulation time changed during the demographic read; retry or pause the clock for a stable snapshot';
        agents = demographicUnavailable(issue); engine = demographicUnavailable(issue); inheritance = demographicUnavailable(issue);
    }
    return buildPopulationDemographics({ clock, fromSimulationTime, policy, age, agents, engine, inheritance });
}
