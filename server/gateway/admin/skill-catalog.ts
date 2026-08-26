import { join } from 'node:path';
import { FileSkillStore } from '../../../agent-skills/store';
import { SkillLibrary } from '../../../agent-skills/library';
import { SkillRegistry } from '../../../agent-skills/registry';
import type { RegisteredSkill, SkillDefinition } from '../../../agent-skills/types';
import { repoRoot } from './paths';

export interface AdminSkillSummary {
    reference: string;
    id: string;
    version: string;
    name: string;
    description: string;
    tags: string[];
    parameters: SkillDefinition['parameters'];
    limits: SkillDefinition['limits'];
}

async function loadVerifiedRegistry(): Promise<SkillRegistry> {
    const registry = new SkillRegistry();
    const library = new SkillLibrary(registry, new FileSkillStore(join(repoRoot, '.local', 'agent-skills')));
    await library.loadReviewedCatalog(join(repoRoot, 'agent-skills', 'catalog'));
    return registry;
}

function reference(skill: RegisteredSkill): string {
    return `${skill.definition.id}@${skill.definition.version}`;
}

export async function listAdminSkills(): Promise<AdminSkillSummary[]> {
    const registry = await loadVerifiedRegistry();
    const latest = new Map<string, RegisteredSkill>();
    for (const skill of registry.list({ status: 'verified' })) {
        if (skill.definition.sharing.visibility !== 'shared' || latest.has(skill.definition.id)) continue;
        latest.set(skill.definition.id, skill);
    }
    return [...latest.values()].map(skill => ({
        reference: reference(skill),
        id: skill.definition.id,
        version: skill.definition.version,
        name: skill.definition.name,
        description: skill.definition.description,
        tags: skill.definition.tags,
        parameters: skill.definition.parameters,
        limits: skill.definition.limits
    }));
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
