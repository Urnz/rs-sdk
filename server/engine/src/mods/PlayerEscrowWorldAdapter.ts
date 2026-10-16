import type { PlayerEscrowCheckpointCommand, PlayerInventoryEscrowRecord,
    PlayerInventoryEscrowWallet, PlayerInventoryEscrowStore } from './PlayerInventoryEscrowStore.js';

type InventoryItem = { id: number; count: number } | null;
export interface PlayerEscrowWorldPort {
    username: string;
    wallet: PlayerInventoryEscrowWallet;
    inventory: { items: InventoryItem[]; set(slot: number, item: InventoryItem): void };
    save(): Uint8Array;
    checkpointAll(save: Uint8Array): void;
}

/** Execute inside one world tick; the login-server autosave is not the authority. */
export function executeSharedEscrowWorldCommand(store: PlayerInventoryEscrowStore,
    command: PlayerEscrowCheckpointCommand, port: PlayerEscrowWorldPort):
    { escrow: PlayerInventoryEscrowRecord; save: Uint8Array } {
    const before = port.inventory.items.map(item => item ? { ...item } : null);
    let durableSave: Uint8Array | null = null;
    const escrow = store.mutateWithCheckpoint(command, port.wallet, {
        owner: port.username,
        save: () => {
            const save = port.save();
            port.checkpointAll(save);
            durableSave = save;
            return save;
        },
        rollback: () => before.forEach((item, slot) => port.inventory.set(slot, item))
    });
    if (!durableSave) throw new Error('Escrow checkpoint did not produce a player save');
    return { escrow, save: durableSave };
}
