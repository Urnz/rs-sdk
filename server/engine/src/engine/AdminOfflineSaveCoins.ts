export interface AdminCoinPlacement {
    inventory: number;
    bank: number;
}

export type AdminCoinPlacementMode = 'preserve' | 'inventory' | 'bank';

/**
 * Keep the editor's location-less coin total stable without moving an existing
 * inventory stack into the bank on every save. Coin changes are applied to the
 * bank first; only a total below the inventory stack changes that stack.
 */
export function preserveAdminCoinPlacement(total: number, currentInventory: number,
    mode: AdminCoinPlacementMode = 'preserve'): AdminCoinPlacement {
    if (mode === 'inventory') return { inventory: total, bank: 0 };
    if (mode === 'bank') return { inventory: 0, bank: total };
    const inventory = Math.min(total, currentInventory);
    return { inventory, bank: total - inventory };
}
