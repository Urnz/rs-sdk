import { expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';

test('public MCP market research lists its guide and never connects a bot', async () => {
    let requests = 0;
    const server = Bun.serve({
        port: 0,
        fetch(req) {
            requests++;
            expect(new URL(req.url).pathname).toBe('/api/market/items');
            return Response.json({ items: [], total: 0 });
        },
    });
    const client = new Client({ name: 'market-test', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dir, '../../mcp/server.ts')], stderr: 'pipe' });
    transport.stderr?.on('data', () => {});
    try {
        await client.connect(transport);
        expect((await client.listTools()).tools.some((t) => t.name === 'get_market')).toBe(true);
        expect((await client.listResources()).resources.some((r) => r.uri === 'file://../sdk/MARKET.md')).toBe(true);
        const result = await client.callTool({ name: 'get_market', arguments: { origin: server.url.origin, operation: 'items', query: 'logs' } });
        expect(result.isError).not.toBe(true);
        expect(requests).toBe(1);
        const bots = await client.callTool({ name: 'list_bots', arguments: {} });
        expect(JSON.parse((bots.content as Array<{ text: string }>)[0]!.text).count).toBe(0);
    } finally {
        await client.close();
        server.stop(true);
    }
}, 30_000);
