import { createHash } from 'node:crypto';

export type WorldEventKind = 'economic-signal' | 'resource-signal' | 'social-signal' | 'world-flavor';
export type WorldEventTemplateStatus = 'draft' | 'approved' | 'retired';
export type WorldEventTemplateSource = 'system' | 'admin' | 'llm-proposal';

export interface WorldEventTemplate {
    templateId: string;
    version: string;
    kind: WorldEventKind;
    title: string;
    summary: string;
    regions: readonly string[];
    tags: readonly string[];
    weight: number;
    status: WorldEventTemplateStatus;
    source: WorldEventTemplateSource;
}

export interface WorldEventSelection {
    seed: string;
    cycleKey: string;
    digest: string;
    ticket: number;
    totalWeight: number;
    template: WorldEventTemplate;
}

const KINDS = new Set<WorldEventKind>(
    ['economic-signal', 'resource-signal', 'social-signal', 'world-flavor']);
const TEMPLATE_KEYS = new Set(['templateId', 'version', 'kind', 'title', 'summary', 'regions', 'tags', 'weight']);
const ID_PATTERN = /^[a-z0-9][a-z0-9.-]{2,63}$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function boundedText(value: unknown, field: string, maximum: number): string {
    if (typeof value !== 'string') throw new Error(`${field} must be text`);
    const normalized = value.trim();
    if (!normalized || normalized.length > maximum) throw new Error(`${field} must contain 1-${maximum} characters`);
    return normalized;
}

function boundedList(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.length > 12) throw new Error(`${field} must contain at most 12 entries`);
    const normalized = value.map(entry => boundedText(entry, field, 64).toLowerCase());
    if (new Set(normalized).size !== normalized.length) throw new Error(`${field} must not contain duplicates`);
    return normalized;
}

/**
 * Validates the only shape an LLM may propose. Deliberately absent are scripts,
 * commands, item grants, teleports and arbitrary payloads: a proposal is inert
 * until trusted code maps an approved template kind to a bounded world action.
 */
export function validateWorldEventTemplateProposal(input: unknown): WorldEventTemplate {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('World event proposal must be an object');
    const record = input as Record<string, unknown>;
    const unknownKeys = Object.keys(record).filter(key => !TEMPLATE_KEYS.has(key));
    if (unknownKeys.length) throw new Error(`World event proposal contains forbidden fields: ${unknownKeys.join(', ')}`);
    const templateId = boundedText(record.templateId, 'templateId', 64).toLowerCase();
    const version = boundedText(record.version, 'version', 32);
    const kind = record.kind as WorldEventKind;
    const weight = Number(record.weight);
    if (!ID_PATTERN.test(templateId)) throw new Error('templateId is invalid');
    if (!VERSION_PATTERN.test(version)) throw new Error('version must be an exact semantic version');
    if (!KINDS.has(kind)) throw new Error('World event kind is not allowlisted');
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > 100) throw new Error('weight must be an integer from 1 to 100');
    return Object.freeze({ templateId, version, kind,
        title: boundedText(record.title, 'title', 120), summary: boundedText(record.summary, 'summary', 1000),
        regions: Object.freeze(boundedList(record.regions, 'regions')),
        tags: Object.freeze(boundedList(record.tags, 'tags')), weight,
        status: 'draft' as const, source: 'llm-proposal' as const });
}

function approved(input: Omit<WorldEventTemplate, 'status' | 'source'>): WorldEventTemplate {
    return Object.freeze({ ...input, regions: Object.freeze([...input.regions]), tags: Object.freeze([...input.tags]),
        status: 'approved', source: 'system' });
}

export const BUILTIN_WORLD_EVENT_TEMPLATES: readonly WorldEventTemplate[] = Object.freeze([
    approved({ templateId: 'market-demand-pulse', version: '1.0.0', kind: 'economic-signal',
        title: 'Regional demand changes',
        summary: 'A bounded market observation may encourage agents to reconsider what they produce or trade.',
        regions: ['global'], tags: ['economy', 'demand'], weight: 4 }),
    approved({ templateId: 'resource-opportunity', version: '1.0.0', kind: 'resource-signal',
        title: 'Resource opportunity reported',
        summary: 'A bounded resource observation may draw attention to an underused gathering area.',
        regions: ['global'], tags: ['resource', 'exploration'], weight: 3 }),
    approved({ templateId: 'traveller-rumour', version: '1.0.0', kind: 'social-signal',
        title: 'A traveller spreads a rumour',
        summary: 'A non-authoritative rumour may become an agent observation without changing world state.',
        regions: ['global'], tags: ['social', 'rumour'], weight: 2 }),
    approved({ templateId: 'quiet-world-beat', version: '1.0.0', kind: 'world-flavor',
        title: 'A quiet day passes', summary: 'No material world change occurs during this cycle.',
        regions: ['global'], tags: ['no-op'], weight: 1 })
]);

function templateFingerprint(template: WorldEventTemplate): string {
    return JSON.stringify([template.templateId, template.version, template.kind, template.title,
        template.summary, [...template.regions], [...template.tags], template.weight]);
}

export function selectWorldEvent(seedInput: string, cycleKeyInput: string,
    templates: readonly WorldEventTemplate[] = BUILTIN_WORLD_EVENT_TEMPLATES): WorldEventSelection {
    const seed = boundedText(seedInput, 'seed', 128);
    const cycleKey = boundedText(cycleKeyInput, 'cycleKey', 128);
    const eligible = templates.filter(template => template.status === 'approved')
        .sort((left, right) => left.templateId.localeCompare(right.templateId)
            || left.version.localeCompare(right.version));
    if (!eligible.length) throw new Error('No approved world event template is available');
    for (const template of eligible) {
        if (!ID_PATTERN.test(template.templateId) || !VERSION_PATTERN.test(template.version)
            || !KINDS.has(template.kind) || !Number.isSafeInteger(template.weight)
            || template.weight < 1 || template.weight > 100) {
            throw new Error(`Approved world event template is invalid: ${template.templateId}@${template.version}`);
        }
    }
    const unique = new Set(eligible.map(template => `${template.templateId}@${template.version}`));
    if (unique.size !== eligible.length) throw new Error('Approved world event templates must have unique exact versions');
    const totalWeight = eligible.reduce((sum, template) => sum + template.weight, 0);
    if (!Number.isSafeInteger(totalWeight) || totalWeight < 1) throw new Error('World event template weight is invalid');
    const fingerprint = eligible.map(templateFingerprint).join('\n');
    const digest = createHash('sha256').update(`${seed}\0${cycleKey}\0${fingerprint}`).digest('hex');
    const ticket = Number(BigInt(`0x${digest.slice(0, 16)}`) % BigInt(totalWeight));
    let cursor = ticket;
    for (const template of eligible) {
        if (cursor < template.weight) return { seed, cycleKey, digest, ticket, totalWeight, template };
        cursor -= template.weight;
    }
    throw new Error('Deterministic world event selection failed');
}
