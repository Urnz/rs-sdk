import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentSkillBook } from './knowledge';
import { SkillRegistry } from './registry';
import type { FileSkillStore } from './store';
import type { RegisteredSkill } from './types';
import type { SkillRunResult } from './types';
import { SKILL_VERIFIER_ID, verifyAndPromoteSkill, type SkillVerificationOptions, type SkillVerificationReport } from './verifier';
import type { PolicySkillStore } from './policy-store.js';
import type { SkillAccessSubject } from './sharing-policy.js';

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
        return definitions.map(definition => this.registry.register(definition, {
            trusted: definition.status === 'verified'
                && definition.provenance.authorKind === 'system'
                && definition.provenance.authorId === SKILL_VERIFIER_ID
        }));
    }

    async loadPolicyCatalog(store: PolicySkillStore, subject: SkillAccessSubject): Promise<RegisteredSkill[]> {
        const envelopes = await store.loadAccessibleTo(subject);
        return envelopes.map(envelope => this.registry.register(envelope.definition, {
            trusted: envelope.definition.status === 'verified'
        }));
    }

    async promoteAgentDraft(
        input: unknown,
        evidence: SkillRunResult[],
        options: SkillVerificationOptions
    ): Promise<{ report: SkillVerificationReport; registered: RegisteredSkill | null; path: string | null }> {
        const report = verifyAndPromoteSkill(input, evidence, options);
        if (!report.promoted) return { report, registered: null, path: null };
        const path = await this.store.save(report.promoted, {
            actorKind: 'system', actorId: report.verifierId
        });
        const registered = this.registry.register(report.promoted, { trusted: true });
        return { report, registered, path };
    }

    discoverFor(book: AgentSkillBook): RegisteredSkill[] {
        return book.discover(this.registry);
    }
}
