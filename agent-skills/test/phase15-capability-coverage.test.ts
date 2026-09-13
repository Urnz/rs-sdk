import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSkillDefinition } from '../validation.js';
import { verifyAndPromoteSkill } from '../verifier.js';

const candidates = [
    ['procedure.travel-meet-return', 'procedure.travel-meet-return@0.1.0.skill.json'],
    ['procedure.bank.withdraw-item', 'procedure.bank.withdraw-item@0.1.0.skill.json'],
    ['procedure.shop.buy-item', 'procedure.shop.buy-item@0.1.0.skill.json'],
    ['procedure.trade.receive-item', 'procedure.trade.receive-item@0.1.0.skill.json'],
    ['workflow.varrock.bronze-dagger-bank-cycle', 'workflow.varrock.bronze-dagger-bank-cycle@0.1.0.skill.json'],
    ['workflow.varrock.bronze-dagger-handoff', 'workflow.varrock.bronze-dagger-handoff@0.1.0.skill.json']
] as const;

function load(file: string) {
    return validateSkillDefinition(JSON.parse(readFileSync(join(import.meta.dir, '..', 'catalog', file), 'utf8')));
}

describe('phase 15 reusable capability candidates', () => {
    test('statically validates reusable bounded drafts instead of route-specific skills', () => {
        for (const [id, file] of candidates) {
            const draft = load(file);
            expect(draft).toMatchObject({ id, version: '0.1.0', status: 'draft',
                provenance: { authorKind: 'agent', authorId: 'phase15-skill-builder' },
                sharing: { visibility: 'shared' } });
            expect(draft.tags).toContain(draft.id.startsWith('workflow.') ? 'workflow' : 'procedure');
        }
        expect(load(candidates[0][1]).steps.map(step => step.id)).toEqual([
            'walk-to-meeting', 'confirm-meeting-area', 'wait-at-meeting', 'walk-back', 'confirm-return-area'
        ]);
        expect(load(candidates[1][1]).steps.some(step => step.kind === 'operation'
            && step.operation === 'withdraw-item')).toBeTrue();
        expect(load(candidates[2][1]).steps.some(step => step.kind === 'operation'
            && step.operation === 'buy-from-shop' && step.arguments.match === 'exact')).toBeTrue();
        expect(load(candidates[3][1]).steps).toEqual([expect.objectContaining({
            kind: 'operation', operation: 'trade-receive-item', arguments: expect.objectContaining({
                match: 'exact', itemMatch: 'exact'
            })
        })]);
        expect(load(candidates[4][1]).steps).toEqual([
            expect.objectContaining({ kind: 'call', skill: {
                id: 'procedure.bank.withdraw-item', version: '1.0.0' } }),
            expect.objectContaining({ kind: 'call', skill: {
                id: 'production.varrock.bronze-daggers', version: '1.0.0' } }),
            expect.objectContaining({ kind: 'call', skill: {
                id: 'procedure.bank.deposit-item', version: '1.0.0' } })
        ]);
        expect(load(candidates[5][1]).steps).toEqual([
            expect.objectContaining({ kind: 'call', skill: {
                id: 'production.varrock.bronze-daggers', version: '1.0.0' } }),
            expect.objectContaining({ kind: 'call', skill: {
                id: 'trade.lumbridge.give-item', version: '1.0.0' }, arguments: expect.objectContaining({
                    'item-name': 'Bronze dagger', recipient: { parameter: 'recipient' }
                }) })
        ]);
    });

    test('cannot promote any candidate without two independent matching live runs', () => {
        for (const [, file] of candidates) {
            const draft = load(file);
            const report = verifyAndPromoteSkill(draft, [], { targetVersion: '1.0.0' });
            expect(report.passed).toBeFalse();
            expect(report.promoted).toBeUndefined();
            expect(report.checks.find(check => check.id === 'independent-runs')).toMatchObject({ passed: false });
            expect(report.checks.find(check => check.id === 'successful-live-runs')).toMatchObject({ passed: false });
        }
    });
});
