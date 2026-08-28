import { describe, expect, test } from 'bun:test';
import { formatPropertyRegisterLines } from './PropertyRegister.js';
import type { PropertyView } from './PropertyRuntime.js';

const available: PropertyView = {
    propertyId: 'varrock.east-workshop',
    displayName: 'Varrock keleti műhely',
    description: 'Test workshop',
    type: 'workshop',
    location: { x: 3247, z: 3411, level: 0, region: 'Varrock East' },
    purchasePrice: 25000,
    entryPoints: [{ entryPointId: 'front-door', label: 'Nyugati utcai bejárat', x: 3247, z: 3411, level: 0 }],
    revenue: { mode: 'none', amount: 0, intervalMinutes: 1440 },
    maintenance: { amount: 250, intervalMinutes: 1440 },
    permissions: { inspect: ['everyone'], purchase: ['eligible-player'], enter: ['owner'], manage: ['owner'] },
    state: {
        propertyId: 'varrock.east-workshop', status: 'available', owner: null,
        acquiredAt: null, updatedAt: '2026-08-28T00:00:00.000Z', version: 1
    }
};

describe('property register', () => {
    test('lists the location, price and availability', () => {
        const lines = formatPropertyRegisterLines([available]);
        expect(lines).toContain('@dre@Varrock keleti műhely');
        expect(lines).toContain('@bla@Varrock East - workshop');
        expect(lines).toContain('@bla@Price: 25,000 coins');
        expect(lines).toContain('@gre@Owner: Available');
    });

    test('shows an owner and never exceeds the journal capacity', () => {
        const owned = {
            ...available,
            state: { ...available.state, status: 'owned' as const, owner: { kind: 'player' as const, id: 'ferrye14' } }
        };
        const lines = formatPropertyRegisterLines(Array.from({ length: 20 }, () => owned));
        expect(lines).toContain('@red@Owner: player ferrye14');
        expect(lines.length).toBe(50);
    });
});
