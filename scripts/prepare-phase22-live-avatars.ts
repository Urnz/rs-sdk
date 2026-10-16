#!/usr/bin/env bun
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { phase22ItemTotals, reservePhase22ActorInventory } from './lib/phase22-avatar-setup.js';

// Audited setup of the three dedicated Phase22 avatars only. No direct save editing, credentials in output or unrelated accounts.
const TEST_AVATARS = ['rKFXWHZFk', 'YJLhy3Vpb', 'ZUgnsbd3A'] as const;
type Item = { id: number; count: number; slot?: number };
type State = { savedAt: string; skills: Array<{ name: string; experience: number }>;
    inventory: Item[]; bank: Item[]; equipment: Item[]; coins: number; coinPlacement: 'inventory' | 'bank';
    position: { x: number; z: number; level: number } };
async function main(): Promise<void> {
    const requested = process.argv.slice(2);
    if (!requested.length || requested.length > TEST_AVATARS.length || new Set(requested).size !== requested.length
        || requested.some(name => !(TEST_AVATARS as readonly string[]).includes(name)))
        throw new Error('Pass explicit dedicated test avatar folders: rKFXWHZFk YJLhy3Vpb ZUgnsbd3A');
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim();
    if (!token) throw new Error('ENGINE_ADMIN_TOKEN must be provided by the coordinated local stack');
    const root = resolve(import.meta.dir, '..');
    const output = join(root, '.local', 'phase22-live', `avatar-setup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    mkdirSync(output, { recursive: true });
    const results: Array<{ username: string; commandId: string; backupId: string; before: State; after: State }> = [];
    async function request(path: string, body?: unknown): Promise<Record<string, unknown>> {
        const response = await fetch(`http://localhost:8888/api/internal/admin/${path}`, {
            method: body ? 'POST' : 'GET', headers: { 'x-engine-admin-token': token!, 'content-type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
        const value = await response.json() as Record<string, unknown>;
        if (!response.ok) throw new Error(`Local audited setup rejected (${response.status}, ${String(value.code ?? 'request-rejected')})`);
        return value;
    }
    try {
        for (const folder of requested) {
            const username = folder.toLowerCase();
            const env = await Bun.file(join(root, 'bots', folder, 'bot.env')).text();
            const values = Object.fromEntries(env.split(/\r?\n/).filter(line => line.includes('=') && !line.startsWith('#'))
                .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]));
            if (values.BOT_USERNAME?.toLowerCase() !== username || values.SERVER !== 'localhost:8888'
                || values.GATEWAY_URL !== 'ws://localhost:7780') throw new Error('Allowlisted folder is not the exact private test avatar');
            const inspected = await request(`offline-backups/${username}`);
            const readiness = inspected.readiness as { editable?: boolean } | undefined;
            const before = inspected.state as State | null;
            if (!readiness?.editable || !before) throw new Error(`Dedicated avatar ${username} must have an existing, completely offline save`);
            await Bun.write(join(output, `${username}-before.json`), JSON.stringify(before, null, 2));
            const skills = before.skills.map(skill => ({ ...skill,
                // Offline API stores engine tenths of XP, unlike the SDK's whole-XP display.
                experience: skill.name.toLowerCase() === 'thieving' ? Math.max(skill.experience, 200000)
                    : skill.name.toLowerCase() === 'hitpoints' ? Math.max(skill.experience, 100000) : skill.experience }));
            if (!skills.some(skill => skill.name.toLowerCase() === 'thieving')
                || !skills.some(skill => skill.name.toLowerCase() === 'hitpoints')) throw new Error('Canonical test skills missing');
            const preparedItems = folder === 'rKFXWHZFk'
                ? reservePhase22ActorInventory(before.inventory, before.bank)
                : (() => { const inventory=before.inventory.map(item=>({...item})),bank=before.bank.map(item=>({...item}));
                    const addedLockpick=!inventory.some(item=>item.id===1523&&item.count>=1);
                    if(addedLockpick){if(inventory.length>=27)throw new Error('Test observer lacks safe inventory space for lockpick');
                        inventory.push({id:1523,count:1})}
                    return{inventory,bank,addedLockpick}; })();
            const inventory = preparedItems.inventory, bank = preparedItems.bank;
            const commandId = randomUUID();
            // The designated player-only buyer receives isolated purchase funds; real Property purchase still runs normally.
            const coins = folder === 'YJLhy3Vpb' ? Math.max(before.coins, 25000) : before.coins;
            const coinPlacement = folder === 'YJLhy3Vpb' ? 'inventory' : before.coinPlacement;
            const changed = await request('offline-edit', { commandId, username, draft: {
                expectedSavedAt: before.savedAt, coins, coinPlacement,
                skills, inventory, bank, equipment: before.equipment,
                position: { x: 3222, z: 3218, level: 0 } } });
            if (changed.ok !== true || typeof changed.backupId !== 'string' || !changed.after)
                throw new Error('Audited test setup did not return a canonical backup and applied state');
            const after = changed.after as State;
            const beforeTotals=phase22ItemTotals(before.inventory,before.bank),afterTotals=phase22ItemTotals(after.inventory,after.bank);
            if (preparedItems.addedLockpick)beforeTotals.push([1523,1]);
            beforeTotals.sort(([a],[b])=>a-b);
            if (after.coins !== coins || JSON.stringify(afterTotals) !== JSON.stringify(beforeTotals)
                || JSON.stringify(after.equipment) !== JSON.stringify(before.equipment)
                || !after.inventory.some(item => item.id === 1523 && item.count >= 1)
                || (folder === 'rKFXWHZFk' && after.inventory.length !== 1)
                || after.position.x !== 3222 || after.position.z !== 3218 || after.position.level !== 0
                || after.skills.find(skill => skill.name.toLowerCase() === 'thieving')!.experience < 200000
                || after.skills.find(skill => skill.name.toLowerCase() === 'hitpoints')!.experience < 100000)
                throw new Error('Applied setup does not match the bounded dedicated test profile');
            results.push({ username, commandId, backupId: changed.backupId, before, after });
            await Bun.write(join(output, 'setup-results.json'), JSON.stringify({ scope: 'Dedicated local Phase22 avatars only; audited offline edits and rollback backup IDs',
                completed: results }, null, 2));
            console.log(JSON.stringify({ username, applied: true, commandId, backupId: changed.backupId }));
        }
    } catch (error) {
        await Bun.write(join(output, 'setup-results.json'), JSON.stringify({ completed: results, failed: true,
            error: error instanceof Error ? error.message : 'Local setup failed' }, null, 2));
        throw error;
    }
    console.log(JSON.stringify({ prepared: results.length, output }));
}
if (import.meta.main) await main();
