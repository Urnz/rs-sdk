import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BusinessManagerStore } from './business-manager.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function store(): BusinessManagerStore {
    const directory = mkdtempSync(join(tmpdir(), 'rs-business-manager-'));
    directories.push(directory);
    return new BusinessManagerStore(join(directory, 'businesses.sqlite'));
}

describe('business manager domain', () => {
    test('exposes business management controls in the admin client', () => {
        const html = readFileSync(join(import.meta.dir, 'public', 'index.html'), 'utf8');
        const script = readFileSync(join(import.meta.dir, 'public', 'admin.js'), 'utf8');
        expect(html).toContain('Vállalkozások és foglalkoztatás');
        expect(html).toContain('id="business-form"');
        expect(script).toContain("api('/api/admin/businesses'");
        expect(script).toContain("data-action=\"business-hire\"");
        expect(script).toContain("data-action=\"business-employment-end\"");
        expect(script).toContain("data-action=\"business-policy-propose\"");
        expect(script).toContain("data-action=\"business-policy-resolve\"");
    });

    test('persists a business, property reference and exact agent employments', () => {
        const businesses = store();
        const created = businesses.create({
            businessId: 'varrock-forge',
            name: 'Varrock Forge',
            summary: 'Copper processing and smithing workshop.',
            ownerAgentId: 'merchant-ada',
            propertyId: 'varrock-east-workshop'
        }, '2026-09-01T10:00:00.000Z');
        expect(created).toMatchObject({
            businessId: 'varrock-forge',
            ownerAgentId: 'merchant-ada',
            propertyId: 'varrock-east-workshop',
            status: 'active',
            revision: 1,
            employments: []
        });

        const worker = businesses.hire('varrock-forge', {
            workerAgentId: 'ferrye14',
            role: 'worker',
            title: 'Copper miner',
            wageGp: 2_000,
            requiredSkill: { id: 'mining.varrock.copper', version: '1.0.0' }
        }, '2026-09-01T10:30:00.000Z', '11111111-1111-4111-8111-111111111111');
        expect(worker).toMatchObject({
            businessId: 'varrock-forge',
            workerAgentId: 'ferrye14',
            role: 'worker',
            wageGp: 2_000,
            requiredSkill: { id: 'mining.varrock.copper', version: '1.0.0' },
            status: 'active',
            revision: 1
        });
        expect(businesses.list()[0]?.employments).toHaveLength(1);
        businesses.close();
    });

    test('uses optimistic revisions and keeps closed businesses as read-only history', () => {
        const businesses = store();
        const created = businesses.create({ businessId: 'varrock-inn', name: 'Varrock Inn',
            summary: 'Food and lodging.', ownerAgentId: 'innkeeper-agent' },
        '2026-09-01T10:00:00.000Z');
        businesses.hire(created.businessId, { workerAgentId: 'cook-agent', role: 'worker',
            title: 'Cook', wageGp: 500 }, '2026-09-01T10:30:00.000Z',
        '22222222-2222-4222-8222-222222222222');

        expect(() => businesses.update(created.businessId, 2, { name: created.name,
            summary: created.summary, status: 'dormant' })).toThrow('changed before update');
        const closed = businesses.update(created.businessId, 1, { name: created.name,
            summary: created.summary, status: 'closed' }, '2026-09-01T11:00:00.000Z');
        expect(closed).toMatchObject({ status: 'closed', revision: 2 });
        expect(closed.employments[0]).toMatchObject({ status: 'ended', revision: 2,
            endedAt: '2026-09-01T11:00:00.000Z' });
        expect(() => businesses.update(created.businessId, closed.revision, { name: created.name,
            summary: created.summary, status: 'active' })).toThrow('read-only');
        expect(() => businesses.update(created.businessId, closed.revision, { name: 'Renamed',
            summary: created.summary, status: 'closed' })).toThrow('read-only');
        expect(() => businesses.hire(created.businessId, { workerAgentId: 'new-cook', role: 'worker',
            title: 'Cook', wageGp: 500 })).toThrow('Only an active business');
        businesses.close();
    });

    test('prevents duplicate active employment and ends employment idempotently', () => {
        const businesses = store();
        businesses.create({ businessId: 'lumbridge-mill', name: 'Lumbridge Mill',
            summary: 'Grain processing.', ownerAgentId: 'miller-agent' });
        const first = businesses.hire('lumbridge-mill', { workerAgentId: 'porter-agent', role: 'manager',
            title: 'Mill manager', wageGp: 750 }, undefined,
        '33333333-3333-4333-8333-333333333333');
        expect(() => businesses.hire('lumbridge-mill', { workerAgentId: 'porter-agent', role: 'worker',
            title: 'Porter', wageGp: 400 })).toThrow('already has an active employment');
        const ended = businesses.endEmployment('lumbridge-mill', first.employmentId, first.revision,
            '2026-09-01T12:00:00.000Z');
        expect(ended).toMatchObject({ status: 'ended', revision: 2 });
        expect(businesses.endEmployment('lumbridge-mill', first.employmentId, 1)).toEqual(ended);
        expect(businesses.hire('lumbridge-mill', { workerAgentId: 'porter-agent', role: 'worker',
            title: 'Porter', wageGp: 400 })).toMatchObject({ status: 'active', revision: 1 });
        businesses.close();
    });

    test('rejects owner employment and malformed skill references', () => {
        const businesses = store();
        businesses.create({ businessId: 'falador-shop', name: 'Falador Shop',
            summary: 'Tools and supplies.', ownerAgentId: 'shop-owner' });
        expect(() => businesses.hire('falador-shop', { workerAgentId: 'shop-owner', role: 'manager',
            title: 'Owner', wageGp: 0 })).toThrow('Owner is not represented');
        expect(() => businesses.hire('falador-shop', { workerAgentId: 'clerk-agent', role: 'worker',
            title: 'Clerk', wageGp: 100, requiredSkill: { id: 'shop.clerk', version: 'latest' } }))
            .toThrow('requiredSkill.version');
        businesses.close();
    });

    test('keeps policy proposals inert until approval and supersedes the active policy atomically', () => {
        const businesses = store();
        businesses.create({ businessId: 'varrock-forge', name: 'Varrock Forge',
            summary: 'Copper processing.', ownerAgentId: 'merchant-ada' });
        const first = businesses.proposePolicy('varrock-forge', {
            proposalId: '44444444-4444-4444-8444-444444444444',
            proposerAgentId: 'forge-mind', objective: 'Build a reliable copper reserve.',
            mode: 'balanced', maxRewardGp: 2_000,
            preferredSkills: [{ id: 'mining.varrock.copper', version: '1.0.0' }]
        }, '2026-09-01T13:00:00.000Z');
        expect(first).toMatchObject({ status: 'pending', revision: 1 });
        expect(businesses.get('varrock-forge')?.activePolicy).toBeNull();
        const approved = businesses.resolvePolicy('varrock-forge', first.proposalId, first.revision,
            'approve', 'Safe initial policy.', '2026-09-01T13:05:00.000Z');
        expect(approved).toMatchObject({ status: 'approved', revision: 2 });
        expect(businesses.resolvePolicy('varrock-forge', first.proposalId, first.revision,
            'approve', 'Safe initial policy.')).toEqual(approved);

        const second = businesses.proposePolicy('varrock-forge', {
            proposalId: '55555555-5555-4555-8555-555555555555',
            proposerAgentId: 'forge-mind', objective: 'Expand profitable ore production.',
            mode: 'profit', maxRewardGp: 3_000
        }, '2026-09-01T14:00:00.000Z');
        businesses.resolvePolicy('varrock-forge', second.proposalId, second.revision,
            'approve', 'Replace the initial policy.', '2026-09-01T14:05:00.000Z');
        const business = businesses.get('varrock-forge')!;
        expect(business.activePolicy).toMatchObject({ proposalId: second.proposalId, status: 'approved' });
        expect(business.policyProposals.find(item => item.proposalId === first.proposalId))
            .toMatchObject({ status: 'superseded', revision: 3 });
        businesses.close();
    });

    test('makes proposal ids idempotent and resolves pending policies when a business closes', () => {
        const businesses = store();
        const business = businesses.create({ businessId: 'falador-courier', name: 'Falador Courier',
            summary: 'Local delivery.', ownerAgentId: 'courier-owner' });
        const input = { proposalId: '66666666-6666-4666-8666-666666666666',
            proposerAgentId: 'courier-mind', objective: 'Prefer safe deliveries.',
            mode: 'survival' as const, maxRewardGp: 500 };
        const proposal = businesses.proposePolicy(business.businessId, input);
        expect(businesses.proposePolicy(business.businessId, input)).toEqual(proposal);
        expect(() => businesses.proposePolicy(business.businessId, { ...input,
            objective: 'Changed content.' })).toThrow('reused with different content');
        const closed = businesses.update(business.businessId, business.revision, { name: business.name,
            summary: business.summary, status: 'closed' });
        expect(closed.policyProposals[0]).toMatchObject({ status: 'rejected', revision: 2 });
        businesses.close();
    });
});
