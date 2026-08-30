import { join } from 'node:path';
import { FileSkillStore } from '../../../agent-skills/store';
import { SkillLibrary } from '../../../agent-skills/library';
import { SkillRegistry } from '../../../agent-skills/registry';
import type { RegisteredSkill, SkillDefinition } from '../../../agent-skills/types';
import { PolicySkillStore } from '../../../agent-skills/policy-store.js';
import { SkillLearningStore } from '../../../agent-skills/learning.js';
import { legacySkillPolicy, type SkillSharingPolicy } from '../../../agent-skills/sharing-policy.js';
import { policySkillsDir, repoRoot, skillLearningPath } from './paths';

export interface AdminSkillSummary {
    reference: string;
    id: string;
    version: string;
    name: string;
    description: string;
    tags: string[];
    parameters: SkillDefinition['parameters'];
    limits: SkillDefinition['limits'];
    policy: SkillSharingPolicy;
}

async function loadVerifiedRegistry(): Promise<SkillRegistry> {
    const registry = new SkillRegistry();
    const library = new SkillLibrary(registry, new FileSkillStore(join(repoRoot, '.local', 'agent-skills')));
    await library.loadReviewedCatalog(join(repoRoot, 'agent-skills', 'catalog'));
    return registry;
}

function summary(definition: SkillDefinition, policy: SkillSharingPolicy): AdminSkillSummary {
    return {
        reference: `${definition.id}@${definition.version}`,
        id: definition.id,
        version: definition.version,
        name: definition.name,
        description: definition.description,
        tags: definition.tags,
        parameters: definition.parameters,
        limits: definition.limits,
        policy
    };
}

export async function listAdminSkills(): Promise<AdminSkillSummary[]> {
    const registry = await loadVerifiedRegistry();
    const latest = new Map<string, RegisteredSkill>();
    for (const skill of registry.list({ status: 'verified' })) {
        if (skill.definition.sharing.visibility !== 'shared' || latest.has(skill.definition.id)) continue;
        latest.set(skill.definition.id, skill);
    }
    return [...latest.values()].map(skill => summary(skill.definition, legacySkillPolicy(skill.definition.sharing)));
}

export interface AdminAgentSkillCatalogOptions {
    learningPath?: string;
    policyRoot?: string;
    at?: string;
}

export async function listAdminSkillsForAgent(agentId: string, options: AdminAgentSkillCatalogOptions = {}) {
    const subject = await new SkillLearningStore(options.learningPath ?? skillLearningPath)
        .accessSubject(agentId, options.at);
    const [legacy, policyEnvelopes] = await Promise.all([
        listAdminSkills(),
        new PolicySkillStore(options.policyRoot ?? policySkillsDir).loadAccessibleTo(subject)
    ]);
    const byReference = new Map<string, AdminSkillSummary>();
    for (const skill of legacy) byReference.set(skill.reference, skill);
    for (const envelope of policyEnvelopes) {
        if (envelope.definition.status !== 'verified') continue;
        const value = summary(envelope.definition, envelope.policy);
        byReference.set(value.reference, value);
    }
    const latest = new Map<string, AdminSkillSummary>();
    for (const skill of [...byReference.values()].sort((left, right) => left.id.localeCompare(right.id)
        || right.version.localeCompare(left.version, undefined, { numeric: true }))) {
        if (!latest.has(skill.id)) latest.set(skill.id, skill);
    }
    return [...latest.values()];
}

export async function resolveAdminSkillForAgent(requested: string, agentId: string,
    options: AdminAgentSkillCatalogOptions = {}): Promise<{ definition: SkillDefinition; policy: SkillSharingPolicy }> {
    const subject = await new SkillLearningStore(options.learningPath ?? skillLearningPath)
        .accessSubject(agentId, options.at);
    const envelopes = await new PolicySkillStore(options.policyRoot ?? policySkillsDir).loadAccessibleTo(subject);
    const separator = requested.lastIndexOf('@');
    const policyMatches = envelopes.filter(envelope => envelope.definition.status === 'verified'
        && envelope.definition.id === (separator > 0 ? requested.slice(0, separator) : requested)
        && (separator <= 0 || envelope.definition.version === requested.slice(separator + 1)))
        .sort((left, right) => right.definition.version.localeCompare(left.definition.version, undefined, { numeric: true }));
    if (policyMatches[0]) return { definition: policyMatches[0].definition, policy: policyMatches[0].policy };
    const legacy = await resolveAdminSkill(requested);
    return { definition: legacy.definition, policy: legacySkillPolicy(legacy.definition.sharing) };
}

export async function resolveAdminSkill(requested: string): Promise<RegisteredSkill> {
    const registry = await loadVerifiedRegistry();
    const separator = requested.lastIndexOf('@');
    const skill = separator > 0
        ? registry.get({ id: requested.slice(0, separator), version: requested.slice(separator + 1) })
        : registry.getLatest(requested, { status: 'verified' });
    if (!skill || skill.definition.status !== 'verified' || skill.definition.sharing.visibility !== 'shared') {
        throw new Error(`Nem található verified, megosztott skill: ${requested}`);
    }
    return skill;
}

export function validateAdminSkillParameters(
    definition: SkillDefinition,
    input: unknown
): Record<string, string | number | boolean> {
    if (input === null || input === undefined) input = {};
    if (typeof input !== 'object' || Array.isArray(input)) throw new Error('A skill paraméterei csak név–érték párok lehetnek.');
    const values = input as Record<string, unknown>;
    const unknown = Object.keys(values).filter(name => !(name in definition.parameters));
    if (unknown.length > 0) throw new Error(`Ismeretlen skill paraméter: ${unknown.join(', ')}`);

    const result: Record<string, string | number | boolean> = {};
    for (const [name, parameter] of Object.entries(definition.parameters)) {
        const supplied = values[name];
        const value = supplied ?? parameter.default;
        if (value === undefined) {
            if (parameter.required) throw new Error(`Hiányzó kötelező skill paraméter: ${name}`);
            continue;
        }
        if (parameter.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
            throw new Error(`${name}: szám szükséges.`);
        }
        if (parameter.type === 'string' && (typeof value !== 'string' || value.trim().length === 0 || value.length > 200)) {
            throw new Error(`${name}: 1–200 karakteres szöveg szükséges.`);
        }
        if (parameter.type === 'boolean' && typeof value !== 'boolean') {
            throw new Error(`${name}: logikai érték szükséges.`);
        }
        if (typeof value === 'number' && parameter.minimum !== undefined && value < parameter.minimum) {
            throw new Error(`${name}: legalább ${parameter.minimum} szükséges.`);
        }
        if (typeof value === 'number' && parameter.maximum !== undefined && value > parameter.maximum) {
            throw new Error(`${name}: legfeljebb ${parameter.maximum} lehet.`);
        }
        if (parameter.enum && !parameter.enum.some(option => Object.is(option, value))) {
            throw new Error(`${name}: az érték nincs az engedélyezett listában.`);
        }
        result[name] = value as string | number | boolean;
    }
    return result;
}
