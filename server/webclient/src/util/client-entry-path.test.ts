import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('client page module entry paths', () => {
    test.each([
        ['server/engine/view/client.ejs', "from '/client/client.js?v=<%= cachebust %>'"],
        ['server/engine/view/bot.ejs', "from '/bot/client.js?v=<%= cachebust %>'"]
    ])('%s uses a root-relative module URL', async (template, expectedImport) => {
        const source = await readFile(template, 'utf8');

        expect(source).toContain(expectedImport);
    });
});
