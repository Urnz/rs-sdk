import { describe, expect, test } from 'bun:test';
import { MarketClient, type MarketItems } from '../market';
import { BotSDK } from '../index';
import { readMarket, marketTool } from '../../mcp/market-tools';

describe('read-only market SDK', () => {
    test('HTTP origin, query encoding, credentials stripped, and BotSDK wrappers', async () => {
        const seen: URL[] = [];
        const methods: string[] = [];
        const server = Bun.serve({
            port: 0,
            fetch(req) {
                seen.push(new URL(req.url));
                methods.push(req.method);
                return Response.json({ items: [], history: [], id: 1511 });
            },
        });
        try {
            const origin = server.url.origin;
            const market = new MarketClient(origin + '/bot?password=never-send&bot=private');
            await market.items('logs & runes', { limit: 10, offset: 20 });
            expect(seen[0]!.pathname).toBe('/api/market/items');
            expect(seen[0]!.searchParams.get('q')).toBe('logs & runes');
            expect(seen[0]!.searchParams.get('offset')).toBe('20');
            const sdk = new BotSDK({
                botUsername: 'private',
                password: 'never-send',
                browserLaunchUrl: origin + '/bot',
                autoLaunchBrowser: false,
            });
            await sdk.getMarketItems('logs', { sort: 'name-desc' });
            expect(seen[1]!.searchParams.get('sort')).toBe('name-desc');
            await sdk.getMarketItem(1511);
            await sdk.getMarketHistory(1511, {
                from: 1,
                to: 3600001,
                interval: 3600000,
            });
            expect(seen[2]!.pathname).toBe('/api/market/items/1511');
            expect(seen[3]!.pathname).toBe('/api/market/items/1511/history');
            expect(seen[3]!.searchParams.get('interval')).toBe('3600000');
            expect(seen.every((u) => !u.href.includes('private') && !u.href.includes('never-send'))).toBe(true);
            expect(methods).toEqual(['GET', 'GET', 'GET', 'GET']);
        } finally {
            server.stop(true);
        }
    });
    test('propagates API errors and validates item IDs', async () => {
        const server = Bun.serve({
            port: 0,
            fetch: () => Response.json({ error: 'Tradeable item not found' }, { status: 404 }),
        });
        try {
            const client = new MarketClient(server.url.origin);
            await expect(client.item(99999)).rejects.toThrow('Market API 404');
            expect(() => client.item(-1)).toThrow();
            expect(() => client.history(NaN)).toThrow();
            expect(() => new MarketClient('ws://localhost')).toThrow();
        } finally {
            server.stop(true);
        }
    });
});

test('typed market periods/rankings and MCP reads forward options without a bot', async () => {
    const seen: URL[] = [];
    const response: MarketItems = {
        items: [],
        total: 0,
        offset: 0,
        limit: 25,
        days: 7,
        sort: 'buyValue',
        updatedAt: 123,
        summary: { volume: 0, gross: 0, activeItems: 0, totalItems: 1 },
        featured: null,
    };
    const server = Bun.serve({
        port: 0,
        fetch(req) {
            seen.push(new URL(req.url));
            return Response.json(response);
        },
    });
    try {
        const client = new MarketClient(server.url.origin);
        const data = await client.items('', { sort: 'buyValue', days: 7 });
        expect(data.summary.totalItems).toBe(1);
        expect(data.updatedAt).toBe(123);
        expect(seen[0]!.searchParams.get('days')).toBe('7');
        expect(seen[0]!.searchParams.get('sort')).toBe('buyValue');
        await client.item(1511, { days: 90 });
        expect(seen[1]!.searchParams.get('days')).toBe('90');
        const sdk = new BotSDK({
            botUsername: 'never-connect',
            password: 'secret',
            browserLaunchUrl: server.url.origin,
        });
        await sdk.getMarketItem(1511, { days: 30 });
        expect(sdk.isConnected()).toBe(false);
        expect(seen[2]!.searchParams.get('days')).toBe('30');
        const result = await readMarket({
            origin: server.url.origin + '/bot?password=secret',
            operation: 'items',
            days: 7,
            sort: 'volume',
        });
        expect(result).toEqual(response);
        expect(seen[3]!.href).not.toContain('secret');
        expect(marketTool.inputSchema.required).not.toContain('bot_name');
        expect(seen[3]!.searchParams.get('sort')).toBe('volume');
    } finally {
        server.stop(true);
    }
});
test('non-JSON server errors retain HTTP status and origin guidance', async () => {
    const server = Bun.serve({
        port: 0,
        fetch: () => new Response('Bad gateway', { status: 502 }),
    });
    try {
        await expect(new MarketClient(server.url.origin).items()).rejects.toThrow('Market API 502: expected JSON');
    } finally {
        server.stop(true);
    }
});

test('disabled GE is discoverable and public reads report a typed unavailable error', async () => {
    const { GEUnavailableError } = await import('../market');
    const server = Bun.serve({
        port: 0,
        fetch(req) {
            if (new URL(req.url).pathname === '/api/market/status') return Response.json({ enabled: false, message: 'Grand Exchange is not available on this server.' });
            return Response.json({ error: 'Grand Exchange is not available on this server.', reason: 'ge_unavailable' }, { status: 503 });
        },
    });
    try {
        const market = new MarketClient(server.url.origin);
        const sdk = new BotSDK({ botUsername: 'unused', browserLaunchUrl: server.url.origin, autoLaunchBrowser: false });
        expect((await sdk.getGEAvailability()).enabled).toBe(false);
        expect(await readMarket({ origin: server.url.origin, operation: 'status' })).toMatchObject({ enabled: false });
        for (const read of [() => market.items(), () => market.item(1511), () => market.history(1511)]) {
            await expect(read()).rejects.toBeInstanceOf(GEUnavailableError);
        }
        expect((await sdk.sendGESearch('logs')).reason).toBe('ge_unavailable');
        expect(sdk.isConnected()).toBe(false);
    } finally {
        server.stop(true);
    }
});
