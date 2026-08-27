import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { SkillDefinition } from './types';
import { validateSkillDefinition } from './validation';

export interface SkillStoreSaveContext {
    actorKind: 'agent' | 'human' | 'system';
    actorId: string;
}

function safeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export class FileSkillStore {
    private readonly root: string;

    constructor(root: string) {
        this.root = resolve(root);
    }

    async save(input: unknown, context: SkillStoreSaveContext): Promise<string> {
        const definition = validateSkillDefinition(input);
        if (context.actorKind === 'agent') {
            if (definition.provenance.authorKind !== 'agent' || definition.provenance.authorId !== context.actorId) {
                throw new Error('An agent may only save skills under its own provenance');
            }
            if (definition.status !== 'draft') throw new Error('An agent-created skill must be saved as draft');
            if (definition.sharing.visibility === 'private' && definition.sharing.ownerAgentId !== context.actorId) {
                throw new Error('An agent may only own its own private skill');
            }
        }
        if (context.actorKind === 'system'
            && (definition.provenance.authorKind !== 'system' || definition.provenance.authorId !== context.actorId)) {
            throw new Error('A system may only save skills under its own provenance');
        }

        const directory = definition.sharing.visibility === 'shared'
            ? join(this.root, 'shared')
            : join(this.root, 'private', safeSegment(definition.sharing.ownerAgentId!));
        const destination = this.assertInsideRoot(join(directory, `${safeSegment(definition.id)}@${safeSegment(definition.version)}.skill.json`));
        await mkdir(dirname(destination), { recursive: true });
        const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(definition, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        try {
            await link(temporary, destination);
        } finally {
            await unlink(temporary).catch(() => undefined);
        }
        return destination;
    }

    async loadVisibleTo(agentId: string): Promise<SkillDefinition[]> {
        const files = [
            ...(await this.findSkillFiles(join(this.root, 'shared'))),
            ...(await this.findSkillFiles(join(this.root, 'private', safeSegment(agentId))))
        ];
        const definitions: SkillDefinition[] = [];
        for (const file of files.sort()) {
            const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
            const definition = validateSkillDefinition(parsed);
            if (definition.sharing.visibility === 'private' && definition.sharing.ownerAgentId !== agentId) continue;
            definitions.push(definition);
        }
        return definitions;
    }

    private async findSkillFiles(directory: string): Promise<string[]> {
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
        const resolved = resolve(path);
        if (resolved !== this.root && !resolved.startsWith(`${this.root}${sep}`)) {
            throw new Error('Skill path escapes the configured store root');
        }
        return resolved;
    }
}
