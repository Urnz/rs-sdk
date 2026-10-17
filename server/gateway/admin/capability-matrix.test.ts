import { expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { auditCapabilityMatrix, discoverCapabilityEvidence, type CapabilityMatrix } from './capability-audit.js';
import { requireDomainAccess } from '../../control-plane/authorization.js';
import { IdentityStore } from '../../control-plane/identity-store.js';

const root = join(import.meta.dir, '../../..');
const matrix = JSON.parse(await readFile(join(import.meta.dir, 'public/capability-matrix.v1.json'), 'utf8')) as CapabilityMatrix;
const backend = ['server/gateway/admin/routes.ts', 'server/control-plane/service.ts', 'server/control-plane/auth.ts'];
const frontend = (await readdir(join(import.meta.dir, 'public'))).filter(name => name.endsWith('.js')).map(name => `server/gateway/admin/public/${name}`);
const sources = Object.fromEntries(await Promise.all([...backend, ...frontend].map(async path => [path, await readFile(join(root, path), 'utf8')])));
const actual = discoverCapabilityEvidence(sources);

test('versioned matrix accounts for every discovered backend declaration, routing guard and frontend request', () => {
    expect(auditCapabilityMatrix(matrix, actual).problems).toEqual([]);
    expect(matrix.capabilities.every(item => item.methods.length === 1)).toBe(true);
    expect(matrix.capabilities.filter(item => item.coverage === 'missing')).toHaveLength(33);
    expect(matrix.capabilities.filter(item => item.coverage === 'available')).toHaveLength(121);
    expect(matrix.capabilities.filter(item => item.coverage === 'infrastructure')).toHaveLength(1);
    expect(matrix.capabilities.flatMap(item => item.operations)).toHaveLength(170);
});

test('orphan backend, orphan frontend and unsupported UI claims produce concrete failures', () => {
    const backendCopy = structuredClone(matrix);
    const id = backendCopy.capabilities[0]!.backend[0]!;
    backendCopy.capabilities.forEach(item => { item.backend = item.backend.filter(value => value !== id); });
    expect(auditCapabilityMatrix(backendCopy, actual).problems.some(problem => problem.startsWith('Orphan backend:'))).toBe(true);
    const frontendCopy = structuredClone(matrix);
    const available = frontendCopy.capabilities.find(item => item.coverage === 'available')!;
    const call = available.frontend[0]!;
    frontendCopy.capabilities.forEach(item => { item.frontend = item.frontend.filter(value => value !== call); });
    const issues = auditCapabilityMatrix(frontendCopy, actual).problems;
    expect(issues.some(problem => problem.startsWith('Orphan frontend:'))).toBe(true);
    expect(issues.some(problem => problem.startsWith('Unsupported UI claim:'))).toBe(true);
    const untrackedGap = structuredClone(matrix); untrackedGap.capabilities.find(item => item.coverage === 'missing')!.gap = null;
    expect(auditCapabilityMatrix(untrackedGap, actual).problems.some(problem => problem.startsWith('Unexplained gap:'))).toBe(true);
    const wrongEndpoint = structuredClone(matrix);
    wrongEndpoint.capabilities.find(item => item.coverage === 'available')!.operations = [{ method: 'POST', path: '/api/admin/wrong-target' }];
    expect(auditCapabilityMatrix(wrongEndpoint, actual).problems.some(problem => problem.startsWith('Frontend/backend mismatch:'))).toBe(true);
});

test('source discovery catches new routes, method changes, new client calls and removed calls without importing a runtime', () => {
    const added = discoverCapabilityEvidence({ ...sources, 'server/gateway/admin/routes.ts': sources['server/gateway/admin/routes.ts']!
        + "\nif (req.method === 'DELETE' && url.pathname === '/api/admin/new-operation') return json({ok:true});" });
    expect(auditCapabilityMatrix(matrix, added).problems.filter(problem => problem.startsWith('Unregistered'))).toHaveLength(2);
    const methodChange = discoverCapabilityEvidence({ ...sources, 'server/gateway/admin/routes.ts': sources['server/gateway/admin/routes.ts']!
        .replace("req.method === 'GET' && url.pathname === '/api/admin/config'", "req.method === 'DELETE' && url.pathname === '/api/admin/config'") });
    expect(auditCapabilityMatrix(matrix, methodChange).problems.some(problem => problem.startsWith('Unregistered guard:'))).toBe(true);
    const extraClient = discoverCapabilityEvidence({ ...sources, 'server/gateway/admin/public/new-client.js': "api('/api/admin/no-backend', {method:'POST'});" });
    expect(auditCapabilityMatrix(matrix, extraClient).problems.some(problem => problem.startsWith('Orphan frontend:'))).toBe(true);
    const removed = actual.filter(item => item.kind !== 'frontend');
    expect(auditCapabilityMatrix(matrix, removed).problems.some(problem => problem.startsWith('Stale evidence:'))).toBe(true);
});

test('available entry points resolve to real pages, views and controls; gaps cannot pretend to have a UI', async () => {
    for (const item of matrix.capabilities) {
        if (item.coverage !== 'available') { expect(item.entry).toBeNull(); continue; }
        const [page, view] = item.entry!.page.split('#');
        expect(['index.html', 'servers.html', 'account.html', 'login.html', 'observations.html']).toContain(page!);
        const html = await readFile(join(import.meta.dir, 'public', page!), 'utf8');
        expect(item.entry!.selector).toMatch(/^#[a-z0-9-]+$/);
        expect(html).toContain(`id="${item.entry!.selector.slice(1)}"`);
        if (view) expect(html).toContain(`data-admin-tab-panel="${view}"`);
    }
});

test('documented gateway roles agree with the actual authorization gate for every method and route family', async () => {
    const identities = new IdentityStore(':memory:');
    try {
        const owner = await identities.createAccount('matrix-owner', 'synthetic matrix owner password');
        const viewer = await identities.createAccount('matrix-viewer', 'synthetic matrix viewer password', owner.id);
        const operator = await identities.createAccount('matrix-operator', 'synthetic matrix operator password', owner.id);
        identities.setRole(owner.id, viewer.id, 'local-default', 'viewer'); identities.setRole(owner.id, operator.id, 'local-default', 'operator');
        for (const item of matrix.capabilities.filter(item => item.route.startsWith('/api/admin/'))) {
            const path = item.route.replace(/:[a-z-]+/g, 'example');
            for (const [role, actor] of [['owner', owner.id], ['operator', operator.id], ['viewer', viewer.id]]) {
                const run = () => requireDomainAccess(identities, actor!, 'local-default', new Request('http://127.0.0.1' + path, { method: item.methods[0] }));
                if (item.roles.includes(role!)) expect(run).not.toThrow(); else expect(run).toThrow();
            }
        }
    } finally { identities.close(); }
});
