import { describe, expect, test } from 'bun:test';
import { BUILTIN_WORLD_EVENT_TEMPLATES, selectWorldEvent, validateWorldEventTemplateProposal }
    from './world-director.js';

describe('seeded World Director', () => {
    test('selects the same exact template and digest for the same seed and cycle', () => {
        const first = selectWorldEvent('economy-experiment-1', 'day:42');
        const second = selectWorldEvent('economy-experiment-1', 'day:42', [...BUILTIN_WORLD_EVENT_TEMPLATES].reverse());
        expect(second).toEqual(first);
        expect(first.digest).toHaveLength(64);
        expect(first.ticket).toBeLessThan(first.totalWeight);
        expect(first.template.status).toBe('approved');
    });

    test('includes template contents in the reproducibility digest', () => {
        const original = selectWorldEvent('seed', 'cycle');
        const modified = BUILTIN_WORLD_EVENT_TEMPLATES.map((template, index) => index
            ? template : { ...template, summary: `${template.summary} Changed.` });
        expect(selectWorldEvent('seed', 'cycle', modified).digest).not.toBe(original.digest);
    });

    test('ignores drafts and fails closed without an approved template', () => {
        const draft = validateWorldEventTemplateProposal({ templateId: 'llm-market-note', version: '1.0.0',
            kind: 'economic-signal', title: 'Market note', summary: 'Observe a possible market change.',
            regions: ['varrock'], tags: ['economy'], weight: 2 });
        expect(() => selectWorldEvent('seed', 'cycle', [draft])).toThrow('No approved');
    });

    test('fails closed when trusted configuration supplies an invalid approved weight', () => {
        const invalid = { ...BUILTIN_WORLD_EVENT_TEMPLATES[0]!, weight: 0 };
        expect(() => selectWorldEvent('seed', 'cycle', [invalid])).toThrow('template is invalid');
    });
});

describe('World Director LLM proposal boundary', () => {
    test('accepts only an inert draft with bounded allowlisted fields', () => {
        expect(validateWorldEventTemplateProposal({ templateId: 'llm-market-note', version: '1.2.0',
            kind: 'economic-signal', title: 'Market note', summary: 'Observe a possible market change.',
            regions: ['Varrock'], tags: ['Economy'], weight: 2 })).toEqual({
            templateId: 'llm-market-note', version: '1.2.0', kind: 'economic-signal', title: 'Market note',
            summary: 'Observe a possible market change.', regions: ['varrock'], tags: ['economy'], weight: 2,
            status: 'draft', source: 'llm-proposal'
        });
    });

    test('rejects executable or arbitrary provider-controlled fields', () => {
        const base = { templateId: 'unsafe-event', version: '1.0.0', kind: 'world-flavor',
            title: 'Unsafe', summary: 'Should never execute.', regions: [], tags: [], weight: 1 };
        expect(() => validateWorldEventTemplateProposal({ ...base, command: 'give_item' }))
            .toThrow('forbidden fields');
        expect(() => validateWorldEventTemplateProposal({ ...base, kind: 'engine-script' }))
            .toThrow('not allowlisted');
    });
});
