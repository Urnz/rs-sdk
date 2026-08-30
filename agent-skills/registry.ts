import { createHash } from 'node:crypto';
import type { RegisteredSkill, SkillDefinition, SkillReference, SkillStatus } from './types';
import { SkillValidationError, validateSkillDefinition } from './validation';

function canonicalize(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function versionParts(version: string): [number, number, number] {
    const parts = version.split('.').map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function compareVersions(left: string, right: string): number {
    const a = versionParts(left);
    const b = versionParts(right);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export interface SkillRegistrationOptions {
    /** Trusted definitions come from reviewed source control or a future verifier. */
    trusted?: boolean;
}

export interface SkillListQuery {
    status?: SkillStatus;
    tags?: string[];
    visibleToAgentId?: string;
}

export interface SkillRegistryDescriptor {
    reference: SkillReference;
    status: SkillStatus;
    visibility: SkillDefinition['sharing']['visibility'];
    ownerAgentId: string | null;
    authorKind: SkillDefinition['provenance']['authorKind'];
    authorId: string;
}

export class SkillRegistry {
    private readonly skills = new Map<string, RegisteredSkill>();

    register(input: unknown, options: SkillRegistrationOptions = {}): RegisteredSkill {
        const definition = validateSkillDefinition(input);
        if (!options.trusted && definition.status !== 'draft') {
            throw new SkillValidationError(['untrusted skill submissions must have draft status']);
        }
        if (!options.trusted && definition.provenance.authorKind !== 'agent') {
            throw new SkillValidationError(['untrusted skill submissions must identify an agent author']);
        }
        if (!options.trusted && definition.sharing.visibility === 'private'
            && definition.sharing.ownerAgentId !== definition.provenance.authorId) {
            throw new SkillValidationError(['an agent-authored private skill must be owned by its author']);
        }

        const key = this.key(definition);
        const checksum = createHash('sha256').update(canonicalize(definition)).digest('hex');
        const existing = this.skills.get(key);
        if (existing && existing.checksum !== checksum) {
            throw new Error(`Skill ${key} already exists with different content; publish a new version`);
        }
        const registered = { definition, checksum };
        this.skills.set(key, registered);
        return registered;
    }

    get(reference: SkillReference, visibleToAgentId?: string): RegisteredSkill | null {
        const skill = this.skills.get(this.key(reference)) ?? null;
        if (skill?.definition.sharing.visibility === 'private'
            && skill.definition.sharing.ownerAgentId !== visibleToAgentId) return null;
        return skill;
    }

    describe(reference: SkillReference): SkillRegistryDescriptor | null {
        const definition = this.skills.get(this.key(reference))?.definition;
        return definition ? {
            reference: { id: definition.id, version: definition.version }, status: definition.status,
            visibility: definition.sharing.visibility,
            ownerAgentId: definition.sharing.ownerAgentId ?? null,
            authorKind: definition.provenance.authorKind, authorId: definition.provenance.authorId
        } : null;
    }

    getLatest(id: string, query: Omit<SkillListQuery, 'tags'> = {}): RegisteredSkill | null {
        return this.list({ ...query }).filter(skill => skill.definition.id === id)
            .sort((left, right) => compareVersions(right.definition.version, left.definition.version))[0] ?? null;
    }

    list(query: SkillListQuery = {}): RegisteredSkill[] {
        return [...this.skills.values()].filter(skill => {
            const definition = skill.definition;
            if (query.status && definition.status !== query.status) return false;
            if (query.tags && !query.tags.every(tag => definition.tags.includes(tag))) return false;
            if (definition.sharing.visibility === 'private' && definition.sharing.ownerAgentId !== query.visibleToAgentId) return false;
            return true;
        }).sort((left, right) => left.definition.id.localeCompare(right.definition.id)
            || compareVersions(right.definition.version, left.definition.version));
    }

    private key(reference: SkillReference): string {
        return `${reference.id}@${reference.version}`;
    }
}
