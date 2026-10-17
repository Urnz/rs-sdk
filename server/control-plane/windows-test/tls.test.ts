import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:https';
import { generateKeyPairSync, X509Certificate } from 'node:crypto';
import { IdentityStore, csrfFor } from '../identity-store.js';
import { ServerSecretStore } from '../secret-store.js';
import { tlsKeyName, validateTls } from '../tls.js';

const repo = join(import.meta.dir, '../../..');
test('native private HTTPS launcher validates TLS, vault import, canonical origins, Secure sessions and CSRF without opening HTTP', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'admin-https-')), path = join(dir, 'identity.sqlite');
    const identities = new IdentityStore(path), owner = await identities.createAccount('https-owner', 'synthetic HTTPS password'); identities.close();
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() }), port = probe.port!; await probe.stop(true);
    const origin = `https://admin.invalid:${port}`, certificatePath = join(dir, 'certificate.crt'), secrets = new ServerSecretStore(dir);
    const env = { ...process.env, CONTROL_PLANE_PORT: String(port), CONTROL_PLANE_HTTPS_ORIGIN: origin, CONTROL_PLANE_BIND: '127.0.0.1',
        CONTROL_PLANE_TLS_CERT: certificatePath, CONTROL_PLANE_IDENTITY_PATH: path };
    const run = async (args: string[], input?: string) => {
        const child = Bun.spawn(args, { env, cwd: repo, stdin: input === undefined ? 'ignore' : new Blob([input]), stdout: 'pipe', stderr: 'pipe', windowsHide: true });
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        return { exit, output: stdout + stderr };
    };
    const stop = () => run(['pwsh', '-NoProfile', '-File', join(repo, 'scripts/stop-admin.ps1'), '-StateDirectory', dir]);
    try {
        expect((await run(['pwsh', '-NoProfile', '-File', join(import.meta.dir, 'create-tls-fixture.ps1'), '-Directory', dir])).exit).toBe(0);
        const certificate = await readFile(certificatePath, 'utf8'), key = await readFile(join(dir, 'private.pem'), 'utf8');
        expect(validateTls(certificate, key, origin).key).toBe(key);
        expect(() => validateTls(certificate, key, 'https://wrong.invalid')).toThrow('Invalid HTTPS');
        expect(() => validateTls(certificate, key, origin, Date.parse(new X509Certificate(certificate).validTo))).toThrow('Invalid HTTPS');
        const wrongKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
        expect(() => validateTls(certificate, wrongKey, origin)).toThrow('Invalid HTTPS');
        const failedImport = await run([process.execPath, 'server/control-plane/import-tls.ts'], JSON.stringify({ key: wrongKey }));
        expect(failedImport.exit).toBe(1); expect(failedImport.output).not.toContain(wrongKey); expect(await secrets.status(tlsKeyName)).toBe(false);
        const imported = await run(['pwsh', '-NoProfile', '-File', join(repo, 'scripts/import-admin-tls.ps1'), '-PrivateKeyPath', join(dir, 'private.pem')]);
        expect(imported.exit).toBe(0); expect(imported.output).not.toContain(key); expect(await secrets.status(tlsKeyName)).toBe(true);
        await rm(join(dir, 'private.pem')); // Runtime must obtain the key exclusively from the vault.
        const start = await run(['pwsh', '-NoProfile', '-File', join(repo, 'scripts/start-admin.ps1'), '-Port', String(port), '-StateDirectory', dir]);
        expect(start.exit).toBe(0); expect(start.output).toContain(origin);
        expect((await run([process.execPath, 'server/control-plane/readiness.ts'])).exit).toBe(0);
        const call = (path: string, options: { method?: string; headers?: Record<string, string>; data?: unknown; trust?: boolean } = {}) => new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
            const req = request({ hostname: '127.0.0.1', port, servername: 'admin.invalid', path, method: options.method ?? 'GET',
                ...(options.trust === false ? {} : { ca: certificate }), timeout: 2000, headers: { Host: `admin.invalid:${port}`, ...options.headers } }, response => {
                let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
                response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body })); response.on('error', reject);
            });
            req.on('timeout', () => req.destroy(new Error('fixture request timed out'))); req.on('error', reject);
            req.end(options.data === undefined ? undefined : JSON.stringify(options.data));
        });
        const health = await call('/health'); expect(health.status).toBe(200); expect(health.headers['strict-transport-security']).toContain('max-age=');
        await expect(call('/health', { trust: false })).rejects.toThrow();
        expect((await call('/health', { headers: { Host: `forged.invalid:${port}`, 'X-Forwarded-Host': `admin.invalid:${port}`, 'X-Forwarded-Proto': 'https' } })).status).toBe(403);
        const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Admin-Request': 'rs-sdk-admin' };
        expect((await call('/api/control-plane/login', { method: 'POST', data: { username: owner.username, password: 'synthetic HTTPS password' } })).status).toBe(403);
        const login = await call('/api/control-plane/login', { method: 'POST', headers, data: { username: owner.username, password: 'synthetic HTTPS password' } });
        expect(login.status).toBe(200); const cookie = login.headers['set-cookie']![0]!; expect(cookie).toContain('; Secure'); expect(cookie).toContain('HttpOnly; SameSite=Strict');
        const token = cookie.split(';')[0]!.split('=')[1]!, authenticated = { ...headers, Cookie: cookie.split(';')[0]! };
        expect((await call('/api/control-plane/logout', { method: 'POST', headers: authenticated, data: {} })).status).toBe(403);
        expect((await call('/api/control-plane/logout', { method: 'POST', headers: { ...authenticated, 'X-Control-CSRF': csrfFor(token) }, data: {} })).status).toBe(200);
        expect((await call('/api/control-plane/session', { headers: authenticated })).status).toBe(401);
        let acceptedPlaintext = false;
        try { const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) }); acceptedPlaintext = response.ok; await response.body?.cancel(); } catch {}
        expect(acceptedPlaintext).toBe(false);
        // Use a distinct TLS implementation: Bun's client maxVersion is not a reliable protocol probe.
        const protocolProbe = await run(['node', '--input-type=module', '-e', `
            import {connect} from 'node:tls';let input='';for await(const chunk of process.stdin)input+=chunk;
            const {port,certificate}=JSON.parse(input);
            function handshake(minVersion,maxVersion){return new Promise((resolve,reject)=>{
                const socket=connect({host:'127.0.0.1',port,servername:'admin.invalid',ca:certificate,minVersion,maxVersion,timeout:2000});
                socket.on('secureConnect',()=>{const protocol=socket.getProtocol();socket.destroy();resolve(protocol)});
                socket.on('error',()=>resolve(null));socket.on('timeout',()=>{socket.destroy();reject(new Error('protocol timeout'))});
            })}
            if(await handshake('TLSv1.2','TLSv1.2')!=='TLSv1.2')process.exit(2);
            if(await handshake('TLSv1','TLSv1.1')!==null)process.exit(3);
            console.log('TLSv1.2 accepted; TLSv1.1 rejected');
        `], JSON.stringify({ port, certificate }));
        expect(protocolProbe.exit).toBe(0); expect(protocolProbe.output).toContain('TLSv1.1 rejected');
        expect((await stop()).exit).toBe(0);
        await secrets.delete(tlsKeyName);
        const missing = await run([process.execPath, 'server/control-plane/main.ts']); expect(missing.exit).toBe(1); expect(missing.output).toContain('fallback is disabled');
        expect(missing.output).not.toContain(key);
        await expect(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    } finally { await stop(); await secrets.delete(tlsKeyName); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}, 60000);
