import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstitutionTreasuryStore } from './institution-treasury.js';
import { InstitutionSettlementOrchestrator, bankingInstitutionSettlement,
    taxationInstitutionSettlement, type InstitutionSettlementEvidenceVerifier } from './institution-settlement-orchestrator.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup() {
    const root = mkdtempSync(join(tmpdir(), 'institution-orchestrator-')); dirs.push(root);
    const path = join(root, 'economy.sqlite');
    const treasury = new InstitutionTreasuryStore(path);
    const payer = treasury.ensure('business', 'bank-of-varrock');
    treasury.setBalance('business', 'bank-of-varrock', payer.revision, 10_000);
    treasury.ensure('business', 'varrock-forge');
    treasury.reserve('business', 'bank-of-varrock', 'bank.interest.forge.001', 250);
    treasury.reserve('business', 'bank-of-varrock', 'tax.refund.forge.001', 100);
    treasury.close();
    return { path, orchestrator: new InstitutionSettlementOrchestrator(path) };
}

function verifier(overrides: Partial<{ eventId: string; eventDigest: string; verifiedAt: string }> = {}) {
    let calls = 0;
    const value: InstitutionSettlementEvidenceVerifier = { verify: async request => {
        calls++;
        return { eventId: overrides.eventId ?? request.eventId,
            eventDigest: overrides.eventDigest ?? createHash('sha256').update(JSON.stringify(request)).digest('hex'),
            verifiedAt: overrides.verifiedAt ?? '2026-09-06T08:00:00.000Z' };
    } };
    return { value, calls: () => calls };
}

const bankRequest = {
    eventId: 'interest.forge.2026-09', eventKind: 'interest-accrued', sourceRef: 'bank-journal:42',
    settlementId: '11111111-1111-4111-8111-111111111111', reservationId: 'bank.interest.forge.001',
    payerKind: 'business' as const, payerActorId: 'bank-of-varrock',
    payeeKind: 'business' as const, payeeActorId: 'varrock-forge', amountGp: 250
};

describe('institution domain settlement orchestrator', () => {
    test('moves funded bank money only after exact evidence verification and replays once', async () => {
        const { path, orchestrator } = setup(); const verified = verifier();
        const first = await bankingInstitutionSettlement(orchestrator, bankRequest, verified.value);
        const replay = await bankingInstitutionSettlement(orchestrator, bankRequest, verified.value);
        expect(first.settlement).toMatchObject({ domain: 'banking', status: 'committed', amountGp: 250 });
        expect(replay.transfer).toEqual(first.transfer);
        expect(verified.calls()).toBe(2);
        const treasury = new InstitutionTreasuryStore(path);
        expect(treasury.get('business', 'bank-of-varrock')).toMatchObject({ balanceGp: 9_750, reservedGp: 100 });
        expect(treasury.get('business', 'varrock-forge')).toMatchObject({ balanceGp: 250 });
        treasury.close(); orchestrator.close();
    });

    test('fails closed on missing or mismatched verified evidence without moving funds', async () => {
        const { path, orchestrator } = setup();
        await expect(bankingInstitutionSettlement(orchestrator, bankRequest,
            verifier({ eventDigest: 'not-a-digest' }).value)).rejects.toThrow('mismatched evidence');
        expect(orchestrator.list()).toHaveLength(0);
        const treasury = new InstitutionTreasuryStore(path);
        expect(treasury.get('business', 'bank-of-varrock')).toMatchObject({ balanceGp: 10_000, reservedGp: 350 });
        treasury.close(); orchestrator.close();
    });

    test('rejects cross-domain event kinds and mutated settlement retries', async () => {
        const { orchestrator } = setup(); const verified = verifier();
        await expect(taxationInstitutionSettlement(orchestrator, bankRequest, verified.value))
            .rejects.toThrow('event kind is not allowed');
        await bankingInstitutionSettlement(orchestrator, bankRequest, verified.value);
        await expect(bankingInstitutionSettlement(orchestrator, { ...bankRequest, amountGp: 249 }, verified.value))
            .rejects.toThrow('changed after verification');
        await expect(bankingInstitutionSettlement(orchestrator, bankRequest,
            verifier({ eventDigest: 'f'.repeat(64) }).value)).rejects.toThrow('changed after verification');
        orchestrator.close();
    });

    test('supports the reserved future taxation port with its own allowlisted evidence', async () => {
        const { orchestrator } = setup(); const verified = verifier();
        const outcome = await taxationInstitutionSettlement(orchestrator, {
            eventId: 'refund.forge.2026-09', eventKind: 'tax-refund-approved', sourceRef: 'tax-ledger:19',
            settlementId: '22222222-2222-4222-8222-222222222222', reservationId: 'tax.refund.forge.001',
            payerKind: 'business', payerActorId: 'bank-of-varrock', payeeKind: 'business',
            payeeActorId: 'varrock-forge', amountGp: 100
        }, verified.value);
        expect(outcome.settlement).toMatchObject({ domain: 'taxation', status: 'committed' });
        orchestrator.close();
    });
});
