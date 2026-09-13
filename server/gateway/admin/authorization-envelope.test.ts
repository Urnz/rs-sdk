import { describe, expect, test } from 'bun:test';
import type { AutonomousSkillAuthorization } from '../../../llm-runtime/types.js';
import type { SkillDefinition } from '../../../agent-skills/types.js';
import { evaluateAuthorizationEnvelope } from './authorization-envelope.js';

type Operation = 'gather-loc' | 'buy-from-shop' | 'trade-give-item' | 'trade-receive-item';

function skill(operation: Operation): SkillDefinition {
    return { id: `test.${operation}`, version: '1.0.0', status: 'verified', parameters: {
        amount: { type: 'number', description: 'amount', default: 1 },
        item: { type: 'string', description: 'item', default: 'Hammer' },
        partner: { type: 'string', description: 'partner', default: 'Worker1' }
    }, steps: [{ kind: 'operation', id: 'action', operation, arguments: {
        ...(operation === 'trade-give-item' || operation === 'trade-receive-item' ? {
            player: { parameter: 'partner' }, match: 'exact', item: { parameter: 'item' }, itemMatch: 'exact'
        } : { name: { parameter: 'item' }, match: 'exact' }), amount: { parameter: 'amount' }
    } }] } as unknown as SkillDefinition;
}

function grant(operation: Operation): AutonomousSkillAuthorization {
    return { id: `test.${operation}`, version: '1.0.0', risk: operation === 'buy-from-shop' ? 'shop-buy'
        : operation === 'trade-give-item' || operation === 'trade-receive-item' ? 'player-trade' : 'routine',
        operations: [operation], parameters: {}, itemNames: operation === 'gather-loc' ? [] : ['hammer'],
        partners: operation === 'trade-give-item' || operation === 'trade-receive-item' ? ['worker1'] : [],
        maxQuantity: 2, maxUnitPriceGp: operation === 'buy-from-shop' ? 10 : 0,
        maxGpPerRun: operation === 'buy-from-shop' ? 20 : 0, maxGpPerDay: operation === 'buy-from-shop' ? 100 : 0 };
}

describe('autonomous authorization envelope', () => {
    test('allows routine reviewed defaults but rejects an unconstrained override', () => {
        expect(evaluateAuthorizationEnvelope(grant('gather-loc'), skill('gather-loc'),
            { amount: 1, item: 'Hammer', partner: 'Worker1' }).allowed).toBeTrue();
        expect(evaluateAuthorizationEnvelope(grant('gather-loc'), skill('gather-loc'),
            { amount: 2, item: 'Hammer', partner: 'Worker1' })).toMatchObject({ allowed: false,
            reason: expect.stringContaining('without an explicit limit') });
    });

    test('bounds shop buys by exact item, quantity, unit price, run and daily budgets', () => {
        const authorized = grant('buy-from-shop');
        authorized.parameters!.amount = { minimum: 1, maximum: 2 };
        expect(evaluateAuthorizationEnvelope(authorized, skill('buy-from-shop'),
            { amount: 2, item: 'Hammer', partner: 'Worker1' })).toMatchObject({ allowed: true, reservedGp: 20 });
        expect(evaluateAuthorizationEnvelope(authorized, skill('buy-from-shop'),
            { amount: 3, item: 'Hammer', partner: 'Worker1' }).allowed).toBeFalse();
    });

    test('authorizes an open-shop NPC as a partner target rather than an item', () => {
        const definition = skill('buy-from-shop');
        definition.steps.unshift({ kind: 'operation', id: 'open-shop', operation: 'open-shop',
            arguments: { name: 'Shop keeper', match: 'exact' } });
        const authorized = grant('buy-from-shop');
        authorized.operations!.push('open-shop');
        authorized.partners = ['shop keeper'];
        authorized.parameters!.amount = { minimum: 1, maximum: 2 };
        expect(evaluateAuthorizationEnvelope(authorized, definition,
            { amount: 1, item: 'Hammer', partner: 'Worker1' }).allowed).toBeTrue();
        authorized.partners = ['another keeper'];
        expect(evaluateAuthorizationEnvelope(authorized, definition,
            { amount: 1, item: 'Hammer', partner: 'Worker1' })).toMatchObject({ allowed: false,
            reason: expect.stringContaining('shopkeeper') });
    });

    test('keeps player trade denied without the exact partner and item', () => {
        const authorized = grant('trade-give-item');
        authorized.parameters!.partner = { oneOf: ['Worker1'] };
        authorized.parameters!.item = { oneOf: ['Hammer'] };
        expect(evaluateAuthorizationEnvelope(authorized, skill('trade-give-item'),
            { amount: 1, item: 'Hammer', partner: 'Worker1' }).allowed).toBeTrue();
        expect(evaluateAuthorizationEnvelope(authorized, skill('trade-give-item'),
            { amount: 1, item: 'Hammer', partner: 'Stranger' }).allowed).toBeFalse();
        const receive = grant('trade-receive-item');
        receive.parameters!.partner = { oneOf: ['Worker1'] };
        receive.parameters!.item = { oneOf: ['Hammer'] };
        expect(evaluateAuthorizationEnvelope(receive, skill('trade-receive-item'),
            { amount: 1, item: 'Hammer', partner: 'Worker1' }).allowed).toBeTrue();
    });
});
