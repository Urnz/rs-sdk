import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdminPropertyOwner, AdminPropertyView } from './properties.js';
import { GovernanceStore } from './governance.js';
import { digestManorPropertyEvidence, GovernanceManorService,
    type ManorPropertyEvidence } from './governance-manor.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'rs-governance-manor-'));
    directories.push(directory);
    const path = join(directory, 'governance.sqlite');
    const governance = new GovernanceStore(path);
    governance.createFaction({ factionId: 'draynor-manor', kind: 'manor', name: 'Draynor Manor',
        treasuryActorId: 'estate.draynor' });
    governance.createJurisdiction({ jurisdictionId: 'draynor-estate', factionId: 'draynor-manor',
        kind: 'manor', name: 'Draynor Estate' });
    governance.createFaction({ factionId: 'varrock', kind: 'city', name: 'Varrock' });
    governance.createJurisdiction({ jurisdictionId: 'varrock-city', factionId: 'varrock',
        kind: 'city', name: 'Varrock City' });
    governance.close();
    return path;
}

function property(propertyId: string, version: number, owner: AdminPropertyOwner | null = {
    kind: 'faction', id: 'estate.draynor'
}): AdminPropertyView {
    return { propertyId, displayName: 'Untrusted display name', description: 'Untrusted description',
        type: 'estate', location: { x: 3100, z: 3300, level: 0, region: 'Draynor' }, purchasePrice: 1,
        state: { status: owner ? 'owned' : 'available', owner,
            acquiredAt: owner ? '2026-09-01T00:00:00.000Z' : null,
            updatedAt: '2026-09-01T00:00:00.000Z', version } };
}

const verifier = { verify: async (evidence: Readonly<ManorPropertyEvidence>) => ({
    propertyId: evidence.propertyId, evidenceDigest: digestManorPropertyEvidence(evidence),
    verifiedAt: '2026-09-06T12:00:00.000Z'
}) };

describe('governance manor portfolio', () => {
    test('links multiple exactly owned properties and designates one verified seat', async () => {
        const path = fixture();
        const manors = new GovernanceManorService(path);
        await manors.reconcileProperty('draynor-estate', property('draynor-manor', 2),
            verifier, 'estate-steward', 'Verified manor purchase receipt.');
        const changedSameVersion = property('draynor-manor', 2);
        changedSameVersion.state.acquiredAt = '2026-09-02T00:00:00.000Z';
        await expect(manors.reconcileProperty('draynor-estate', changedSameVersion,
            verifier, 'estate-steward', 'Conflicting same-version evidence.')).rejects
            .toThrow('version was reused');
        await manors.reconcileProperty('draynor-estate', property('draynor-farm', 4),
            verifier, 'estate-steward', 'Verified farm purchase receipt.');
        const beforeSeat = manors.getPortfolio('draynor-estate');
        expect(beforeSeat.properties.map(item => item.propertyId)).toEqual(['draynor-farm', 'draynor-manor']);
        expect(beforeSeat.seat).toBeNull();
        const portfolio = manors.setSeat('draynor-estate', 'draynor-manor',
            beforeSeat.jurisdiction.revision, 'estate-steward', 'Designated administrative castle seat.');
        expect(portfolio).toMatchObject({ faction: { factionId: 'draynor-manor' },
            jurisdiction: { seatPropertyId: 'draynor-manor', revision: 2 },
            seat: { propertyId: 'draynor-manor', propertyStateVersion: 2 },
            unverifiedSeatPropertyId: null });
        expect(manors.listAudit('draynor-estate').map(item => item.action))
            .toEqual(['linked', 'linked', 'seat-designated']);
        manors.close();
    });

    test('requires verified exact faction ownership and rejects foreign or unowned seats', async () => {
        const path = fixture();
        const manors = new GovernanceManorService(path);
        expect(await manors.reconcileProperty('draynor-estate',
            property('foreign-house', 1, { kind: 'faction', id: 'varrock' }), verifier,
            'estate-steward', 'Checked foreign ownership evidence.')).toBeNull();
        expect(() => manors.setSeat('draynor-estate', 'foreign-house', 1,
            'estate-steward', 'Attempted invalid foreign seat.')).toThrow('verified owned properties');
        await expect(manors.reconcileProperty('varrock-city', property('draynor-manor', 1),
            verifier, 'estate-steward', 'Invalid non-manor jurisdiction.')).rejects
            .toThrow('Manor jurisdiction does not exist');
        const mismatchedVerifier = { verify: async () => ({ propertyId: 'draynor-manor',
            evidenceDigest: '0'.repeat(64), verifiedAt: '2026-09-06T12:00:00.000Z' }) };
        await expect(manors.reconcileProperty('draynor-estate', property('draynor-manor', 1),
            mismatchedVerifier, 'estate-steward', 'Invalid verifier result.')).rejects
            .toThrow('mismatched evidence');
        const futureState = property('future-house', 1);
        futureState.state.updatedAt = '2026-09-07T00:00:00.000Z';
        await expect(manors.reconcileProperty('draynor-estate', futureState,
            verifier, 'estate-steward', 'Stale verifier timestamp.')).rejects
            .toThrow('predates the Property state');
        manors.close();
    });

    test('requires a newer ownership state to unlink and atomically clears a sold seat', async () => {
        const path = fixture();
        const manors = new GovernanceManorService(path);
        await manors.reconcileProperty('draynor-estate', property('draynor-manor', 3),
            verifier, 'estate-steward', 'Verified manor ownership.');
        let portfolio = manors.getPortfolio('draynor-estate');
        manors.setSeat('draynor-estate', 'draynor-manor', portfolio.jurisdiction.revision,
            'estate-steward', 'Designated current estate seat.');
        await expect(manors.reconcileProperty('draynor-estate', property('draynor-manor', 3, null),
            verifier, 'estate-steward', 'Untrusted same-version sale claim.')).rejects
            .toThrow('newer Property state version');
        expect(await manors.reconcileProperty('draynor-estate', property('draynor-manor', 4, null),
            verifier, 'estate-steward', 'Verified sale to another owner.')).toBeNull();
        portfolio = manors.getPortfolio('draynor-estate');
        expect(portfolio).toMatchObject({ properties: [], seat: null,
            jurisdiction: { seatPropertyId: null, revision: 3 } });
        expect(manors.listAudit('draynor-estate').map(item => item.action))
            .toEqual(['linked', 'seat-designated', 'unlinked', 'seat-cleared']);
        manors.close();
    });
});
