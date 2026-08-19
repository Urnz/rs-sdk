import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentSkillBook } from './knowledge';
import { SkillRegistry } from './registry';
import type { FileSkillStore } from './store';
import type { RegisteredSkill } from './types';

export class SkillLibrary {
    constructor(
        public readonly registry: SkillRegistry,
        public readonly store: FileSkillStore
    ) {}

    async loadReviewedCatalog(directory: string): Promise<RegisteredSkill[]> {
        const files = (await readdir(directory, { withFileTypes: true }))
            .filter(entry => entry.isFile() && entry.name.endsWith('.skill.json'))
            .map(entry => join(directory, entry.name))
            .sort();
        const registered: RegisteredSkill[] = [];
        for (const file of files) {
            const definition = JSON.parse(await readFile(file, 'utf8')) as unknown;
            registered.push(this.registry.register(definition, { trusted: true }));
        }
        return registered;
    }

    async submitAgentSkill(input: unknown, agentId: string): Promise<RegisteredSkill> {
        await this.store.save(input, { actorKind: 'agent', actorId: agentId });
        return this.registry.register(input);
    }

    async loadAgentDrafts(agentId: string): Promise<RegisteredSkill[]> {
        const definitions = await this.store.loadVisibleTo(agentId);
        return definitions.map(definition => this.registry.register(definition));
    }

    discoverFor(book: AgentSkillBook): RegisteredSkill[] {
        return book.discover(this.registry);
    }
}
