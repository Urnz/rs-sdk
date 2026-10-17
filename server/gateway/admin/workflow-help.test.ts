import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workflowGuides, fieldHints } from './public/workflow-help.js';

const read = (name: string) => readFile(join(import.meta.dir, 'public', name), 'utf8');

test('guides cover the actual navigation and preserve local, existing destinations', async () => {
    const html = await read('index.html');
    const views = Array.from(html.matchAll(/data-tab="([a-z-]+)"/g), match => match[1]!);
    expect(Object.keys(workflowGuides).sort()).toEqual([...views, 'servers', 'account', 'observations'].sort());
    for (const [key, guide] of Object.entries(workflowGuides)) {
        expect(guide.steps.length).toBeGreaterThanOrEqual(2);
        expect(guide.before.length).toBeGreaterThan(30); expect(guide.expected.length).toBeGreaterThan(30);
        expect(guide.trouble.length).toBeGreaterThan(30);
        for (const [href] of guide.links) {
            if (href!.startsWith('#')) { expect(views).toContain(href!.slice(1)); continue; }
            expect(['servers.html', 'account.html']).toContain(href!);
            expect(await read(href!)).toContain('<html lang="hu">');
        }
        expect(key).not.toBe('login');
    }
    for (const page of ['index', 'servers', 'account', 'observations']) {
        const markup = await read(`${page}.html`);
        expect(markup).toContain('src="workflow-help.js"'); expect(markup).toContain('href="workflow-help.css"');
        expect(markup).toContain('data-workflow-guide=');
    }
});

test('field hints bind to existing forms/fields and instructions keep important workflow boundaries explicit', async () => {
    const html = await Promise.all(['index.html', 'servers.html', 'account.html'].map(read));
    for (const [selector] of fieldHints) {
        const match = selector!.match(/^#([a-z-]+) \[name="([a-zA-Z]+)"\]$/)!;
        expect(match).not.toBeNull();
        expect(html.some(page => new RegExp(`<form[^>]*id="${match[1]}"[^>]*>[\\s\\S]*?name="${match[2]}"[\\s\\S]*?<\\/form>`).test(page))).toBe(true);
    }
    expect(workflowGuides.experiments.steps[0]).toContain('önmagában nem állítja át');
    expect(workflowGuides.experiments.terms.Seed).toContain('önmagában nem jelent azonos kezdő');
    expect(workflowGuides.skills.trouble).toContain('önmagában nem helyettesíti');
    expect(workflowGuides.servers.terms.Archiválás).toContain('nincs visszaaktiválás');
    expect(workflowGuides['world-events'].expected).toContain('előnézet még nem küld');
    const source = await read('workflow-help.js');
    expect(source).not.toMatch(/\b(fetch|api|requestSubmit)\s*\(|\.click\s*\(|innerHTML|localStorage|sessionStorage/);
});
