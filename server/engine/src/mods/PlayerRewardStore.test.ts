import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlayerRewardStore, type PlayerRewardWallet } from './PlayerRewardStore.js';

const directories: string[] = [];

function setup(balance = 100): { store: PlayerRewardStore; wallet: PlayerRewardWallet & { coins: number } } {
    const directory = mkdtempSync(join(tmpdir(), 'rs-player-reward-'));
    directories.push(directory);
    const wallet = { coins: balance, balance() { return this.coins; },
        credit(amount: number) { this.coins += amount; return amount; },
        remove(amount: number) { this.coins -= amount; return amount; } };
    return { store: new PlayerRewardStore(join(directory, 'rewards.sqlite')), wallet };
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('player action reward settlement', () => {
    test('credits a reward exactly once for the stable settlement id', () => {
        const { store, wallet } = setup();
        const id = '11111111-1111-4111-8111-111111111111';
        expect(store.credit(id, 'Worker', 50, wallet)).toMatchObject({ status: 'committed', coinsBefore: 100, coinsAfter: 150 });
        expect(store.credit(id, 'worker', 50, wallet)).toMatchObject({ status: 'committed' });
        expect(wallet.coins).toBe(150);
        expect(() => store.credit(id, 'worker', 51, wallet)).toThrow('different payment');
        store.close();
    });

    test('compensates a partial credit and records a terminal rejection', () => {
        const { store, wallet } = setup();
        wallet.credit = amount => { wallet.coins += amount - 1; return amount - 1; };
        const id = '22222222-2222-4222-8222-222222222222';
        expect(() => store.credit(id, 'worker', 50, wallet)).toThrow('incomplete');
        expect(wallet.coins).toBe(100);
        expect(store.get(id)).toMatchObject({ status: 'rejected' });
        wallet.credit = amount => { wallet.coins += amount; return amount; };
        expect(store.credit(id, 'worker', 50, wallet)).toMatchObject({ status: 'committed', coinsAfter: 150 });
        expect(wallet.coins).toBe(150);
        store.close();
    });
});
