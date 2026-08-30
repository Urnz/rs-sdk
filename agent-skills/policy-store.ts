import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { decideSkillPolicy, validateSkillSharingPolicy, type SkillAccessSubject,
    type SkillSharingPolicy } from './sharing-policy.js';
import type { SkillDefinition } from './types.js';
import { validateSkillDefinition } from './validation.js';
import type { SkillStoreSaveContext } from './store.js';

export const POLICY_SKILL_ENVELOPE_VERSION = 1 as const;

export interface PolicySkillEnvelope {
    schemaVersion: typeof POLICY_SKILL_ENVELOPE_VERSION;
    policy: SkillSharingPolicy;
    definition: SkillDefinition;
}

export interface PolicySkillSaveContext extends SkillStoreSaveContext {
    subject: SkillAccessSubject;
}

function safeSegment(value: string, name: string): string {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(value)) throw new Error(`${name} contains unsupported characters`);
    return value.toLocaleLowerCase('en-US');
}

function policyDirectory(root: string, policy: SkillSharingPolicy): string {
    if (policy.kind === 'common' || policy.kind === 'public') return join(root, policy.kind);
    if (policy.kind === 'organization') return join(root, policy.kind, safeSegment(policy.organizationId, 'organizationId'));
    if (policy.kind === 'teachable') return join(root, policy.kind, safeSegment(policy.teacherAgentId, 'teacherAgentId'));
    if (policy.kind === 'licensed') return join(root, policy.kind, safeSegment(policy.licenseId, 'licenseId'));
    return join(root, policy.kind, safeSegment(policy.ownerAgentId, 'ownerAgentId'));
}

function validateCompatibility(policy: SkillSharingPolicy, definition: SkillDefinition): void {
    if (policy.kind === 'private') {
        if (definition.sharing.visibility !== 'private'
            || definition.sharing.ownerAgentId?.toLocaleLowerCase('en-US') !== policy.ownerAgentId) {
            throw new Error('Private policy must match the definition private owner');
        }
    } else if (definition.sharing.visibility !== 'shared') {
        throw new Error('A non-private policy requires a legacy shared definition until the schema migration completes');
    }
}

function validateEnvelope(input: unknown): PolicySkillEnvelope {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Policy skill envelope must be an object');
    const value = input as Partial<PolicySkillEnvelope>;
    if (value.schemaVersion !== POLICY_SKILL_ENVELOPE_VERSION || !value.policy) {
        throw new Error('Policy skill envelope has an unsupported schema');
    }
    const policy = validateSkillSharingPolicy(value.policy);
    const definition = validateSkillDefinition(value.definition);
    validateCompatibility(policy, definition);
    return { schemaVersion: POLICY_SKILL_ENVELOPE_VERSION, policy, definition };
}

export class PolicySkillStore {
    private readonly root: string;

    constructor(root: string) { this.root = resolve(root); }

    async save(input: unknown, policyInput: SkillSharingPolicy, context: PolicySkillSaveContext): Promise<string> {
        const definition = validateSkillDefinition(input);
        const policy = validateSkillSharingPolicy(policyInput);
        validateCompatibility(policy, definition);
        const actorId = safeSegment(context.actorId, 'actorId');
        if (context.subject.agentId.toLocaleLowerCase('en-US') !== actorId) {
            throw new Error('Policy save subject must match the actor');
        }
        if (context.actorKind === 'agent') {
            if (definition.status !== 'draft' || definition.provenance.authorKind !== 'agent'
                || definition.provenance.authorId.toLocaleLowerCase('en-US') !== actorId) {
                throw new Error('An agent may only save its own draft');
            }
        }
        const author = definition.provenance.authorKind === 'agent' ? definition.provenance.authorId : undefined;
        const decision = decideSkillPolicy(policy, context.subject, author);
        if (!decision.accessible) throw new Error(`Actor cannot save under this policy: ${decision.reason}`);
        const directory = this.assertInsideRoot(policyDirectory(this.root, policy));
        const filename = `${safeSegment(definition.id, 'skill id')}@${safeSegment(definition.version, 'skill version')}.skill.json`;
        const destination = this.assertInsideRoot(join(directory, filename));
        const envelope: PolicySkillEnvelope = { schemaVersion: POLICY_SKILL_ENVELOPE_VERSION, policy, definition };
        await mkdir(dirname(destination), { recursive: true });
        const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        try { await link(temporary, destination); }
        finally { await unlink(temporary).catch(() => undefined); }
        return destination;
    }

    async loadAccessibleTo(subject: SkillAccessSubject): Promise<PolicySkillEnvelope[]> {
        const directories = this.accessibleDirectories(subject);
        const files = (await Promise.all(directories.map(directory => this.findFiles(directory)))).flat().sort();
        const envelopes: PolicySkillEnvelope[] = [];
        for (const file of files) {
            const contents = await readFile(file, 'utf8');
            if (contents.length > 1_000_000) throw new Error('Policy skill envelope exceeds the size limit');
            const envelope = validateEnvelope(JSON.parse(contents));
            const author = envelope.definition.provenance.authorKind === 'agent'
                ? envelope.definition.provenance.authorId : undefined;
            if (!decideSkillPolicy(envelope.policy, subject, author).accessible) {
                throw new Error('Policy directory contained a definition not accessible to the subject');
            }
            envelopes.push(envelope);
        }
        return envelopes;
    }

    private accessibleDirectories(subject: SkillAccessSubject): string[] {
        if (subject.isolatedDiscovery) {
            return [this.assertInsideRoot(join(this.root, 'private', safeSegment(subject.agentId, 'agentId')))];
        }
        const directories = [join(this.root, 'common'), join(this.root, 'public'),
            join(this.root, 'private', safeSegment(subject.agentId, 'agentId'))];
        for (const id of subject.organizationIds ?? []) directories.push(join(this.root, 'organization', safeSegment(id, 'organizationId')));
        for (const id of subject.teacherAgentIds ?? []) directories.push(join(this.root, 'teachable', safeSegment(id, 'teacherAgentId')));
        for (const id of subject.licenseIds ?? []) directories.push(join(this.root, 'licensed', safeSegment(id, 'licenseId')));
        return [...new Set(directories.map(directory => this.assertInsideRoot(directory)))];
    }

    private async findFiles(directory: string): Promise<string[]> {
        try {
            return (await readdir(directory, { withFileTypes: true }))
                .filter(entry => entry.isFile() && entry.name.endsWith('.skill.json'))
                .map(entry => this.assertInsideRoot(join(directory, entry.name)));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
    }

    private assertInsideRoot(path: string): string {
        const value = resolve(path);
        if (value !== this.root && !value.startsWith(`${this.root}${sep}`)) throw new Error('Policy skill path escapes store root');
        return value;
    }
}
