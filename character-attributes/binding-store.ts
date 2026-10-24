import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import budgetCatalog from '../config/attribute-budget-policies.json';
import allocationCatalog from '../config/attribute-allocation-policies.json';
import potentialCatalog from '../config/skill-potential-policies.json';
import capCatalog from '../config/skill-cap-policies.json';
import type { AgentPopulationMember } from '../agent-state/types.js';
import { validateAttributeProfile } from './profile.js';
import { createSkillPotentialProfile, validateSkillPotentialPolicy } from './skill-potential.js';
import { validateSkillCapPolicy } from './skill-cap-policy.js';
import { generateNpcAttributeProfile } from './allocation-policy.js';
import { validateAttributeBudgetPolicyCatalog, validateAttributeAllocationPolicyCatalog,
    validateSkillPotentialPolicyCatalog, validateSkillCapPolicyCatalog } from './config.js';
import type { AttributeProfile, SkillPotentialPolicy, SkillPotentialProfile, SkillCapPolicy } from './types.js';

export function characterBindingDigest(value: unknown): string {
    const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
        : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item)
            .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : item;
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

/** Same identity material as the native population food boundary. No mutable revision/age fields. */
export function characterLifecycleId(member: AgentPopulationMember): string {
    return characterBindingDigest({ agentId: member.agentId, createdAt: member.characterLifecycle.createdAt,
        origin: member.characterLifecycle.origin, createdAtSimulationTime: member.characterLifecycle.createdAtSimulationTime,
        sourceResultId: member.sourceResultId, sourceResultDigest: member.sourceResultDigest,
        worldProfile: member.worldProfile, lifecyclePolicy: member.lifecyclePolicy, simulationClock: member.simulationClock });
}

export interface CharacterAttributeCreation {
    attributes: AttributeProfile;
    potentialPolicy: SkillPotentialPolicy;
    capPolicy: SkillCapPolicy;
    creationEvidence: unknown;
}
export interface CharacterAttributeBinding extends CharacterAttributeCreation {
    schemaVersion: 1;
    actorId: string;
    username: string;
    lifecycleId: string;
    clockId: string;
    clockProfileDigest: string;
    worldProfileDigest: string;
    potential: SkillPotentialProfile;
    digest: string;
}

function validateCreation(input: CharacterAttributeCreation): CharacterAttributeCreation {
    const { totalPoints: _points, digest: _attributeDigest, ...definition } = input.attributes;
    const attributes = validateAttributeProfile(definition);
    const { digest: _potentialDigest, ...potentialDefinition } = input.potentialPolicy;
    const potentialPolicy = validateSkillPotentialPolicy(potentialDefinition);
    const { digest: _capDigest, ...capDefinition } = input.capPolicy;
    const capPolicy = validateSkillCapPolicy(capDefinition);
    if (attributes.digest !== input.attributes.digest || potentialPolicy.digest !== input.potentialPolicy.digest
        || capPolicy.digest !== input.capPolicy.digest) throw new Error('Character attribute policy/profile digest mismatch');
    if (!input.creationEvidence) throw new Error('Character attributes require explicit creation evidence');
    return { attributes, potentialPolicy, capPolicy, creationEvidence: input.creationEvidence };
}

export function createPopulationAttributes(member: AgentPopulationMember): CharacterAttributeCreation {
    const budget = validateAttributeBudgetPolicyCatalog(budgetCatalog).policies
        .find(policy => policy.policyId === 'default-npc-attributes' && policy.version === '1.0.0')!;
    const allocation = validateAttributeAllocationPolicyCatalog(allocationCatalog).policies
        .find(policy => policy.policyId === 'default-npc-allocation' && policy.version === '1.0.0')!;
    const potentialPolicy = validateSkillPotentialPolicyCatalog(potentialCatalog).policies
        .find(policy => policy.policyId === 'default-skill-potential' && policy.version === '1.0.0')!;
    const capPolicy = validateSkillCapPolicyCatalog(capCatalog).policies
        .find(policy => policy.policyId === 'attribute-hard-cap' && policy.version === '1.0.0')!;
    if (!budget || !allocation || !potentialPolicy || !capPolicy) throw new Error('Population attribute policies are unavailable');
    const generated = generateNpcAttributeProfile(budget, allocation, { characterAgentId: member.agentId,
        lifecycleCreatedAtSimulationTime: member.characterLifecycle.createdAtSimulationTime,
        seed: `${member.sourceResultId}:${member.sourceResultDigest}` });
    return { attributes: generated.profile, potentialPolicy, capPolicy,
        creationEvidence: { sourceResultId: member.sourceResultId, sourceResultDigest: member.sourceResultDigest,
            budget: generated.budget, allocation: generated.allocation } };
}

/** Component-owned additive schema; borrows the caller's transaction and never closes its DB. */
export class CharacterAttributeStore {
    constructor(private readonly db: Database) {}
    private exists(): boolean {
        return !!this.db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='character_attribute_binding'").get();
    }
    bind(member: AgentPopulationMember, input: CharacterAttributeCreation): CharacterAttributeBinding {
        if (member.status !== 'active' || member.characterLifecycle.status !== 'active') throw new Error('Character lifecycle is not active');
        const creation = validateCreation(input);
        if (creation.attributes.characterAgentId !== member.agentId
            || creation.attributes.lifecycleCreatedAtSimulationTime !== member.characterLifecycle.createdAtSimulationTime)
            throw new Error('Character attributes belong to another lifecycle');
        const definition = { schemaVersion: 1 as const, actorId: member.agentId, username: member.playerUsername,
            lifecycleId: characterLifecycleId(member), clockId: member.simulationClock.clockId,
            clockProfileDigest: member.simulationClock.profileDigest, worldProfileDigest: member.worldProfile.digest,
            ...creation, potential: createSkillPotentialProfile(creation.attributes, creation.potentialPolicy) };
        const binding = { ...definition, digest: characterBindingDigest(definition) };
        this.db.exec(`CREATE TABLE IF NOT EXISTS character_attribute_binding(
            lifecycle_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE TRIGGER IF NOT EXISTS character_attribute_no_update BEFORE UPDATE ON character_attribute_binding
            BEGIN SELECT RAISE(ABORT,'Character attribute bindings are immutable'); END;
            CREATE TRIGGER IF NOT EXISTS character_attribute_no_delete BEFORE DELETE ON character_attribute_binding
            BEGIN SELECT RAISE(ABORT,'Character attribute bindings are immutable'); END;`);
        const prior = this.get(member);
        if (prior) {
            if (prior.digest !== binding.digest) throw new Error('Character attribute binding is immutable');
            return prior;
        }
        this.db.query('INSERT INTO character_attribute_binding VALUES(?,?,?)')
            .run(binding.lifecycleId, member.agentId, JSON.stringify(binding));
        return binding;
    }
    get(member: AgentPopulationMember): CharacterAttributeBinding | null {
        if (!this.exists()) return null;
        const row = this.db.query<{ payload: string }, [string]>(
            'SELECT payload FROM character_attribute_binding WHERE lifecycle_id=?').get(characterLifecycleId(member));
        if (!row) return null;
        const binding = JSON.parse(row.payload) as CharacterAttributeBinding;
        const { digest, ...definition } = binding;
        validateCreation(binding);
        if (binding.schemaVersion !== 1 || digest !== characterBindingDigest(definition) || binding.actorId !== member.agentId
            || binding.attributes.characterAgentId !== member.agentId
            || binding.attributes.lifecycleCreatedAtSimulationTime !== member.characterLifecycle.createdAtSimulationTime
            || binding.username !== member.playerUsername || binding.lifecycleId !== characterLifecycleId(member)
            || binding.clockId !== member.simulationClock.clockId || binding.clockProfileDigest !== member.simulationClock.profileDigest
            || binding.worldProfileDigest !== member.worldProfile.digest
            || characterBindingDigest(binding.potential) !== characterBindingDigest(createSkillPotentialProfile(binding.attributes, binding.potentialPolicy)))
            throw new Error('Character attribute binding is corrupt or stale');
        return binding;
    }
}
