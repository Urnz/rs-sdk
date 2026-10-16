export const SHOP_ECONOMY_MODES = ['legacy', 'closed-society'] as const;

export type ShopEconomyMode = (typeof SHOP_ECONOMY_MODES)[number];

export class InvalidShopEconomyModeError extends Error {}

export function parseShopEconomyMode(value: unknown): ShopEconomyMode {
    if (typeof value === 'string' && SHOP_ECONOMY_MODES.includes(value as ShopEconomyMode)) {
        return value as ShopEconomyMode;
    }

    throw new InvalidShopEconomyModeError(`Invalid shop economy mode: ${String(value)}`);
}

/**
 * Legacy shops mutate shared inventories and mint seller payouts directly. They
 * are never a valid settlement path in a closed society.
 */
export function legacyShopAllowed(mode: ShopEconomyMode): boolean {
    return mode === 'legacy';
}

/** Automatic stock convergence creates or destroys items without an actor. */
export function automaticShopRestockAllowed(mode: ShopEconomyMode): boolean {
    return mode === 'legacy';
}
