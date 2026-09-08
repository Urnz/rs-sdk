import { MarketClient, MARKET_SORTS, type MarketItemsOptions, type MarketItemOptions, type MarketHistoryOptions } from '../sdk/market';
export const marketTool = {
    name: 'get_market',
    description:
        'Read public Grand Exchange prices/history without connecting, launching or taking control of a bot. No trading or private offers. Use the game HTTP origin (local default http://localhost:8888), not the gateway port. See the Grand Exchange guide resource for trading.',
    inputSchema: {
        type: 'object' as const,
        properties: {
            origin: {
                type: 'string',
                description: 'Game HTTP(S) origin, e.g. http://localhost:8888.',
            },
            operation: { type: 'string', enum: ['status', 'items', 'item', 'history'] },
            query: { type: 'string', maxLength: 80 },
            item_id: { type: 'integer', minimum: 1 },
            days: { type: 'integer', enum: [1, 7, 30, 90] },
            sort: { type: 'string', enum: [...MARKET_SORTS] },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0, maximum: 100000 },
            from: { type: 'integer', minimum: 0 },
            to: { type: 'integer', minimum: 1 },
            interval: { type: 'integer', enum: [3600000, 86400000] },
        },
        required: ['origin', 'operation'],
        additionalProperties: false,
    },
};
export async function readMarket(args: Record<string, unknown>) {
    if (typeof args.origin !== 'string') throw new Error('Provide the game HTTP origin.');
    const market = new MarketClient(args.origin);
    const { days, sort, limit, offset, from, to, interval } = args;
    if (args.operation === 'status') return market.status();
    if (args.operation === 'items') {
        if (args.query !== undefined && typeof args.query !== 'string') throw new Error('query must be text.');
        return market.items(args.query ?? '', {
            days,
            sort,
            limit,
            offset,
        } as MarketItemsOptions);
    }
    if (typeof args.item_id !== 'number') throw new Error('item_id is required for item/history reads.');
    if (args.operation === 'item') return market.item(args.item_id, { days } as MarketItemOptions);
    if (args.operation === 'history')
        return market.history(args.item_id, {
            from,
            to,
            interval,
        } as MarketHistoryOptions);
    throw new Error('Use operation status, items, item or history.');
}
