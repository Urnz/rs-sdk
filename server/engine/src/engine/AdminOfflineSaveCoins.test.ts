import { describe, expect, test } from 'bun:test';

import { preserveAdminCoinPlacement } from './AdminOfflineSaveCoins.js';

describe('admin offline-save coin placement', () => {
    test('keeps mixed inventory and bank coins stable during an unchanged editor round trip', () => {
        const before = { inventory: 175, bank: 8 };
        const editedTotal = before.inventory + before.bank;

        expect(preserveAdminCoinPlacement(editedTotal, before.inventory)).toEqual(before);
    });

    test('applies total changes to the bank before reducing the inventory stack', () => {
        expect(preserveAdminCoinPlacement(200, 175)).toEqual({ inventory: 175, bank: 25 });
        expect(preserveAdminCoinPlacement(100, 175)).toEqual({ inventory: 100, bank: 0 });
    });

    test('supports explicit reproducible placement without changing the preserve default', () => {
        expect(preserveAdminCoinPlacement(200, 0, 'inventory')).toEqual({ inventory: 200, bank: 0 });
        expect(preserveAdminCoinPlacement(200, 175, 'bank')).toEqual({ inventory: 0, bank: 200 });
    });
});
