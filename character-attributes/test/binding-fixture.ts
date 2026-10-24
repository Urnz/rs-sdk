import type { AgentPopulationMember } from '../../agent-state/types.js';
import { validateAttributeProfile } from '../profile.js';
import { validateSkillPotentialPolicyCatalog, validateSkillCapPolicyCatalog } from '../config.js';
import potentialCatalog from '../../config/skill-potential-policies.json';
import capCatalog from '../../config/skill-cap-policies.json';
import type { CharacterAttributeCreation } from '../binding-store.js';

export function attributeMember(username = 'alice'): AgentPopulationMember {
    const time = '2001-01-01T00:00:00.000Z', wall = '2026-10-24T12:00:00.000Z';
    return { agentId: username, playerUsername: username,
        worldProfile: { profileId: 'fixture', version: '1.0.0', digest: 'a'.repeat(64) },
        lifecyclePolicy: { policyId: 'finite', version: '1.0.0', digest: 'b'.repeat(64), kind: 'finite' },
        simulationClock: { clockId: 'fixture', profileDigest: 'c'.repeat(64) },
        joinedAtSimulationTime: time, sourceResultId: 'genesis-fixture', sourceResultDigest: 'd'.repeat(64),
        status: 'active', resetAtSimulationTime: null, createdAt: wall, updatedAt: wall, revision: 1,
        characterLifecycle: { agentId: username, origin: 'created', createdAtSimulationTime: time,
            birthAtSimulationTime: time, ageAtObservationMilliseconds: 0, ageObservedAtSimulationTime: time,
            currentAgeSimulationMilliseconds: 0, status: 'active', statusChangedAtSimulationTime: time,
            createdAt: wall, updatedAt: wall, revision: 1 } };
}

export function attributeCreation(member: AgentPopulationMember, value: number, kind = 'attribute-hard-cap'): CharacterAttributeCreation {
    const attributes = validateAttributeProfile({ schemaVersion: 1, profileId: `fixture:${member.agentId}`, version: '1.0.0',
        characterAgentId: member.agentId, lifecycleCreatedAtSimulationTime: member.characterLifecycle.createdAtSimulationTime,
        source: { origin: 'migration-default', policyId: 'explicit-fixture-import', policyVersion: '1.0.0', seedDigest: null },
        scale: { minimum: 0, maximum: 10 }, values: { intellect: value, dexterity: value, vigor: value,
            endurance: value, perception: value, will: value } });
    return { attributes, potentialPolicy: validateSkillPotentialPolicyCatalog(potentialCatalog).policies[0]!,
        capPolicy: validateSkillCapPolicyCatalog(capCatalog).policies.find(policy => policy.kind === kind)!,
        creationEvidence: { operationId: `explicit-import:${member.agentId}`, reason: 'Isolated SI-C01 paired fixture' } };
}
