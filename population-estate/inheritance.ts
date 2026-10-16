import { existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { AgentStateStore } from '../agent-state/store.js';
import { PlayerHealthEvidenceStore } from '../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { healthDigest, healthInteger, healthKey, healthTime } from '../population-health/policy.js';
import { runPopulationEstateCycle, type EstateRuntimeOptions } from './runtime.js';
import { PopulationEstateStore, type EstateCase } from './store.js';
import { validateInheritancePolicy, type InheritancePolicy, type InheritancePlan, type InheritanceAsset } from './inheritance-policy.js';
import { applyInheritanceTransfers } from './inheritance-transfer.js';
import { ESTATE_DOMAINS, type EstateDomain } from './schema.js';
import type { EstateSourceReceipt } from './source.js';

type Row = Record<string,string | number | null>;
export interface InheritanceSelection { estateId: string; heirAgentId: string; ruleId: string; reason: string }
export interface InheritanceRequest extends InheritanceSelection { decisionId: string; expectedRevision: number; previewDigest: string }
export interface InheritancePreview {
    estateId: string; revision: number; heirAgentId: string; heirUsername: string | null; ruleId: string; reason: string;
    policyDigest: string; governanceDigest: string | null; sourcesDigest: string; heirLifecycleCreatedAt: string | null;
    assets: InheritanceAsset[]; blockers: string[]; digest: string;
}
function withDatabase<T>(path: string, readonly: boolean, run: (db: Database) => T): T {
    if (!existsSync(path)) throw new Error('Inheritance source is unavailable');
    const db = new Database(path,{readonly,strict:true}), statements = new Set<{finalize():void}>();
    db.query = new Proxy(db.query,{apply(target,receiver,args){const statement=Reflect.apply(target,receiver,args);statements.add(statement);return statement;}});
    try { return run(db); } finally { for (const statement of statements) statement.finalize(); db.close(true); }
}
function normalized(selection: InheritanceSelection): InheritanceSelection {
    if (typeof selection.reason !== 'string' || selection.reason.trim().length < 8 || selection.reason.length > 1000) throw new Error('Inheritance reason must contain 8–1000 characters');
    return {estateId:healthKey(selection.estateId),heirAgentId:healthKey(selection.heirAgentId),ruleId:healthKey(selection.ruleId),reason:selection.reason.trim()};
}
function checkedPolicy(input: InheritancePolicy): InheritancePolicy {
    const {digest,...definition} = input, policy = validateInheritancePolicy(definition);
    if (policy.digest !== digest) throw new Error('Inheritance policy digest conflicts'); return policy;
}
function readReceipts(options: EstateRuntimeOptions, current: EstateCase): Map<EstateDomain,EstateSourceReceipt> {
    return new Map(ESTATE_DOMAINS.map(domain => [domain,withDatabase(options.sources[domain],true,db => {
        const row = db.query('SELECT receipt_json,receipt_digest FROM population_estate_receipt WHERE estate_id=?1 AND domain=?2')
            .get(current.estateId,domain) as {receipt_json:string;receipt_digest:string} | null;
        if (!row) throw new Error('Inheritance custody receipt is unavailable');
        const receipt = JSON.parse(row.receipt_json) as EstateSourceReceipt;
        if (row.receipt_digest !== current.receipts[domain] || healthDigest(receipt) !== row.receipt_digest
            || receipt.deathDigest !== current.deathDigest || receipt.estateId !== current.estateId || receipt.domain !== domain)
            throw new Error('Inheritance custody receipt conflicts');
        return receipt;
    })]));
}
export function previewAdminInheritance(options: EstateRuntimeOptions, rawPolicy: InheritancePolicy, input: InheritanceSelection,
    now = new Date().toISOString()): InheritancePreview {
    healthTime(now); const selection = normalized(input), policy = checkedPolicy(rawPolicy);
    const current = runPopulationEstateCycle(options,now).cases.find(row => row.estateId === selection.estateId);
    if (!current) throw new Error('Inheritance estate does not exist');
    return buildPreview(options,policy,selection,current);
}
function buildPreview(options: EstateRuntimeOptions, policy: InheritancePolicy, selection: InheritanceSelection, current: EstateCase): InheritancePreview {
    const blockers: string[] = [], assets: InheritanceAsset[] = [];
    if (current.status !== 'custody-ready') blockers.push('Estate custody is not ready');
    if (current.inheritance) blockers.push('Estate already has an immutable inheritance decision');
    const binding = policy.bindings.find(binding => binding.ruleId === selection.ruleId);
    let governanceDigest: string | null = null, heirUsername: string | null = null, heirLifecycleCreatedAt: string | null = null;
    if (!binding) blockers.push('No exact inheritance jurisdiction/faction rule');
    else {
        try { governanceDigest = withDatabase(options.sources.governance,true,db => {
            const faction = db.query('SELECT * FROM governance_faction WHERE faction_id=?1').get(binding.factionId) as Row | null;
            const jurisdiction = binding.jurisdictionId ? db.query('SELECT * FROM governance_jurisdiction WHERE jurisdiction_id=?1').get(binding.jurisdictionId) as Row | null : null;
            if (!faction || faction.status !== 'active' || binding.jurisdictionId && (!jurisdiction || jurisdiction.faction_id !== binding.factionId))
                throw new Error('Inheritance jurisdiction/faction is unavailable or disabled');
            return healthDigest({binding,faction,jurisdiction});
        }); } catch (error) { blockers.push(String(error)); }
    }
    const agents = new AgentStateStore(options.sources.agents);
    try {
        const heir = agents.getIdentity(selection.heirAgentId), lifecycle = agents.getCharacterLifecycle(selection.heirAgentId), profile = agents.getControlProfile(selection.heirAgentId);
        const membership = agents.getPopulationMember(selection.heirAgentId);
        if (!heir?.playerUsername || !lifecycle || lifecycle.status !== 'active' || profile?.role !== 'player'
            || profile.subjectKind !== 'player' || profile.subjectId.toLowerCase() !== heir.playerUsername
            || selection.heirAgentId === current.agentId || membership?.status === 'reset') blockers.push('Heir must be a distinct active player agent');
        else {
            heirUsername = heir.playerUsername; heirLifecycleCreatedAt = lifecycle.createdAtSimulationTime;
            const engine = new PlayerHealthEvidenceStore(options.engineDeathPath,true);
            try { if (engine.listDeaths().some(death => death.playerUsername === heirUsername)) blockers.push('Heir has an engine terminal death'); }
            finally { engine.close(); }
        }
    } finally { agents.close(); }
    if (current.status === 'custody-ready') {
        const receipts = readReceipts(options,current), rows = (domain: EstateDomain,table: string) => receipts.get(domain)!.claims.filter(claim=>claim.table===table).map(claim=>claim.facts);
        const personal = (row: Row,kind: string,id: string) => row[kind] === 'player' && row[id] === current.username;
        const keys = [current.agentId,current.username,`agent:${current.agentId}`,`player:${current.username}`];
        for (const row of rows('agents','agent_relationship')) if ((row.agent_id === current.agentId || keys.includes(String(row.actor_key)))
            && (Number(row.agent_owes_gp) > 0 || Number(row.actor_owes_gp) > 0)) blockers.push('Unadjudicated personal social debt or receivable');
        if (rows('agents','agent_commitment').some(row => row.agent_id === current.agentId || keys.includes(String(row.actor_key)))) blockers.push('Open personal commitment');
        if (rows('contracts','economic_contract').some(row => row.resolution === 'active'
            && (row.party_a_agent_id === current.agentId || row.party_b_agent_id === current.agentId))) blockers.push('Open personal contract');
        for (const table of ['economic_contract_settlement','economic_contract_player_escrow'])
            if (rows('contracts',table).some(row => (row.payer_agent_id === current.agentId || row.payee_agent_id === current.agentId)
                && !row.released_at && !['committed','rejected'].includes(String(row.status)))) blockers.push('Unresolved personal contract funding');
        for (const row of rows('governance','governance_obligation')) if ((personal(row,'debtor_kind','debtor_id') || personal(row,'creditor_kind','creditor_id'))
            && !rows('governance','governance_obligation_resolution').some(resolution=>resolution.obligation_id===row.obligation_id)) blockers.push('Unresolved personal governance claim');
        if (rows('banking','bank_loan').some(row => personal(row,'borrower_kind','borrower_actor_id') && row.status !== 'repaid' && row.status !== 'cancelled')) blockers.push('Outstanding personal loan');
        if (rows('escrow','player_inventory_escrow').some(row => (row.username === current.username || row.payee_username === current.username)
            && !row.committed_at && !['released','rejected'].includes(String(row.status)))) blockers.push('Unresolved personal engine escrow');
        const property = receipts.get('property')!;
        for (const row of rows('property','property_state').filter(row => personal(row,'owner_kind','owner_id'))) {
            const propertyId = String(row.property_id), seal = property.sealedRows.find(item=>item.table==='property_state' && item.key.property_id===propertyId),
                effect = property.effects.find(item=>item.table==='property_state' && item.key===propertyId);
            if (!binding?.propertyIds.includes(propertyId)) blockers.push(`Property ${propertyId} has no selected legal rule`);
            if (row.status !== 'owned' || !seal?.digest || !effect || effect.expected.status !== 'locked') blockers.push(`Property ${propertyId} was not freely owned before custody`);
            else assets.push({propertyId,beforeVersion:Number(effect.expected.version),beforeRowDigest:seal.digest});
            if (rows('banking','bank_loan_collateral').some(collateral => collateral.property_id === propertyId)) blockers.push(`Property ${propertyId} is collateral`);
        }
    }
    if (!assets.length) blockers.push('No supported personal Property to inherit');
    const definition = {...selection,revision:current.revision,heirUsername,policyDigest:policy.digest,governanceDigest,sourcesDigest:current.sourcesDigest,
        heirLifecycleCreatedAt,assets:assets.sort((a,b)=>a.propertyId.localeCompare(b.propertyId)),blockers:[...new Set(blockers)].sort()};
    return {...definition,digest:healthDigest(definition)};
}
/** Called only from the authenticated human admin mutation route; never a model action. */
export function executeAdminInheritance(options: EstateRuntimeOptions, rawPolicy: InheritancePolicy, input: InheritanceRequest,
    now = new Date().toISOString(), afterSourceCommit?: () => void): EstateCase {
    healthTime(now); const selection = normalized(input), policy = checkedPolicy(rawPolicy), decisionId = healthKey(input.decisionId);
    healthInteger(input.expectedRevision,1,Number.MAX_SAFE_INTEGER);
    if (!/^[a-f0-9]{64}$/.test(input.previewDigest)) throw new Error('Inheritance requires an exact preview digest');
    const initial = runPopulationEstateCycle(options,now).cases.find(row=>row.estateId===selection.estateId);
    if (!initial || initial.status !== 'custody-ready') throw new Error('Inheritance requires ready custody');
    const existing = initial.inheritance;
    let plan: InheritancePlan;
    if (existing) {
        plan = existing.plan;
        if (plan.decisionId !== decisionId || plan.heirAgentId !== selection.heirAgentId || plan.ruleId !== selection.ruleId
            || plan.reason !== selection.reason || plan.policyDigest !== policy.digest || plan.previewDigest !== input.previewDigest
            || plan.approvedRevision !== input.expectedRevision) throw new Error('Inheritance decision conflicts');
        if (existing.status === 'completed') return initial;
        // Still-pending decisions must pass the current authority, heir and law gates.
        const pending = buildPreview(options,policy,selection,initial);
        const withoutDecision = {...pending,blockers:pending.blockers.filter(reason=>reason!=='Estate already has an immutable inheritance decision')};
        if (withoutDecision.blockers.length || withoutDecision.governanceDigest !== plan.governanceDigest
            || withoutDecision.heirLifecycleCreatedAt !== plan.heirLifecycleCreatedAt || withoutDecision.heirUsername !== plan.heirUsername)
            throw new Error('Pending inheritance authority changed');
    } else {
        const preview = buildPreview(options,policy,selection,initial);
        if (preview.blockers.length) throw new Error(`Inheritance blocked: ${preview.blockers.join('; ')}`);
        if (preview.digest !== input.previewDigest || preview.revision !== input.expectedRevision) throw new Error('Inheritance preview changed');
        plan = {schemaVersion:1,decisionId,estateId:initial.estateId,deathDigest:initial.deathDigest,custodyReceiptDigest:initial.receipts.property!,
            policyDigest:policy.digest,ruleId:selection.ruleId,governanceDigest:preview.governanceDigest!,sourcesDigest:initial.sourcesDigest,
            heirAgentId:selection.heirAgentId,heirUsername:preview.heirUsername!,heirLifecycleCreatedAt:preview.heirLifecycleCreatedAt!,
            previewDigest:input.previewDigest,approvedRevision:input.expectedRevision,actor:'admin',reason:selection.reason,assets:preview.assets,createdAt:now};
        const store = new PopulationEstateStore(options.statePath);
        try { store.prepareInheritance(initial.estateId,input.expectedRevision,plan,now); } finally { store.close(); }
    }
    const coordinator = new PopulationEstateStore(options.statePath);
    let current: EstateCase;
    try { current = coordinator.get(initial.estateId)!; } finally { coordinator.close(); }
    if (current.status !== 'custody-ready') throw new Error('Inheritance custody changed before transfer');
    const custody = readReceipts(options,current).get('property')!;
    // Reserve the live identity, death and law writers while checking authority and committing the title.
    withDatabase(options.sources.agents,false,agents => agents.transaction(() =>
        withDatabase(options.engineDeathPath,false,deathDb => deathDb.transaction(() =>
            withDatabase(options.sources.governance,false,governance => governance.transaction(() => {
                const identity = agents.query('SELECT player_username FROM agent_identity WHERE agent_id=?1').get(plan.heirAgentId) as Row | null;
                const lifecycle = agents.query('SELECT status,created_at_simulation_time FROM agent_character_lifecycle WHERE agent_id=?1').get(plan.heirAgentId) as Row | null;
                const profile = agents.query('SELECT role,subject_kind,subject_id FROM agent_control_profile WHERE agent_id=?1').get(plan.heirAgentId) as Row | null;
                const membership = agents.query('SELECT status FROM agent_population_member WHERE agent_id=?1').get(plan.heirAgentId) as Row | null;
                if (identity?.player_username !== plan.heirUsername || lifecycle?.status !== 'active'
                    || lifecycle.created_at_simulation_time !== plan.heirLifecycleCreatedAt || profile?.role !== 'player'
                    || profile.subject_kind !== 'player' || String(profile.subject_id).toLowerCase() !== plan.heirUsername || membership?.status === 'reset')
                    throw new Error('Inheritance heir changed before transfer');
                const engine = new PlayerHealthEvidenceStore(options.engineDeathPath,true);
                try {
                    const deaths = engine.listDeaths(), donor = deaths.find(death=>death.eventDigest===plan.deathDigest);
                    const agentDeath = agents.query('SELECT event_json,event_digest FROM agent_population_death WHERE agent_id=?1').get(current.agentId) as Row | null;
                    const donorLifecycle = agents.query('SELECT status FROM agent_character_lifecycle WHERE agent_id=?1').get(current.agentId) as Row | null;
                    if (!donor || donor.agentId !== current.agentId || donorLifecycle?.status !== 'deceased'
                        || agentDeath?.event_digest !== healthDigest(donor) || healthDigest(JSON.parse(String(agentDeath.event_json))) !== healthDigest(donor))
                        throw new Error('Inheritance donor death changed before transfer');
                    if (deaths.some(death=>death.playerUsername===plan.heirUsername)) throw new Error('Inheritance heir has terminal engine death');
                }
                finally { engine.close(); }
                const binding = policy.bindings.find(binding=>binding.ruleId===plan.ruleId)!;
                const faction = governance.query('SELECT * FROM governance_faction WHERE faction_id=?1').get(binding.factionId) as Row | null;
                const jurisdiction = binding.jurisdictionId ? governance.query('SELECT * FROM governance_jurisdiction WHERE jurisdiction_id=?1').get(binding.jurisdictionId) : null;
                if (!faction || faction.status !== 'active' || healthDigest({binding,faction,jurisdiction}) !== plan.governanceDigest)
                    throw new Error('Inheritance law changed before transfer');
                withDatabase(options.sources.property,false,db => applyInheritanceTransfers(db,custody,plan,now));
            }).immediate())
        ).immediate())
    ).immediate());
    afterSourceCommit?.();
    return runPopulationEstateCycle(options,now).cases.find(row=>row.estateId===current.estateId)!;
}
