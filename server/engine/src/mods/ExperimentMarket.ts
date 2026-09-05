export type MarketPriceDirection = 'buy' | 'sell';

export interface ExperimentMarketPrice {
    itemId: number;
    itemName: string;
    buyGp: number | null;
    sellGp: number | null;
}

export interface ExperimentMarketConfig {
    profileId: string;
    profileVersion: string;
    profileDigest: string;
    prices: Map<number, ExperimentMarketPrice>;
}

const PROFILE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const DIGEST = /^[a-f0-9]{64}$/;

function requiredString(config: Record<string, boolean | number | string>, key: string): string {
    const value = config[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid experiment market setting: ${key}`);
    return value.trim();
}

function price(value: unknown, field: string): number | null {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2_147_483_647) {
        throw new Error(`Invalid experiment market price: ${field}`);
    }
    return Number(value);
}

export function parseExperimentMarketPrices(value: string): ExperimentMarketPrice[] {
    let parsed: unknown;
    try { parsed = JSON.parse(value) as unknown; }
    catch { throw new Error('Experiment market pricesJson must be valid JSON'); }
    if (!Array.isArray(parsed) || parsed.length > 2_000) throw new Error('Experiment market pricesJson must be a bounded array');
    const seen = new Set<number>();
    return parsed.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid experiment market item at index ${index}`);
        const row = entry as Record<string, unknown>;
        if (!Number.isSafeInteger(row.itemId) || Number(row.itemId) < 0 || Number(row.itemId) > 65_535) {
            throw new Error(`Invalid experiment market itemId at index ${index}`);
        }
        const itemId = Number(row.itemId);
        if (seen.has(itemId)) throw new Error(`Duplicate experiment market itemId: ${itemId}`);
        const itemName = typeof row.itemName === 'string' ? row.itemName.trim().replace(/\s+/g, ' ') : '';
        if (!itemName || itemName.length > 100) throw new Error(`Invalid experiment market itemName for ${itemId}`);
        const buyGp = price(row.buyGp, `${itemId}.buyGp`);
        const sellGp = price(row.sellGp, `${itemId}.sellGp`);
        if (buyGp === null && sellGp === null) throw new Error(`Experiment market item ${itemId} needs a buy or sell price`);
        seen.add(itemId);
        return { itemId, itemName, buyGp, sellGp };
    });
}

export function parseExperimentMarketConfig(config: Record<string, boolean | number | string>): ExperimentMarketConfig {
    const profileId = requiredString(config, 'profileId').toLowerCase();
    const profileVersion = requiredString(config, 'profileVersion');
    const profileDigest = requiredString(config, 'profileDigest').toLowerCase();
    if (!PROFILE_ID.test(profileId)) throw new Error('Invalid experiment market setting: profileId');
    if (!VERSION.test(profileVersion)) throw new Error('Invalid experiment market setting: profileVersion');
    if (!DIGEST.test(profileDigest)) throw new Error('Invalid experiment market setting: profileDigest');
    const rows = parseExperimentMarketPrices(requiredString(config, 'pricesJson'));
    if (rows.length === 0) throw new Error('Experiment profile contains no market prices');
    return { profileId, profileVersion, profileDigest, prices: new Map(rows.map(row => [row.itemId, row])) };
}

export function resolveExperimentMarketPrice(itemId: number, direction: MarketPriceDirection,
    config: ExperimentMarketConfig): number | null {
    const row = config.prices.get(itemId);
    return row ? direction === 'buy' ? row.buyGp : row.sellGp : null;
}
