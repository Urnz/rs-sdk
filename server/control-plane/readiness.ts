import { request } from 'node:https';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { controlPlaneConfig } from './config.js';

// Probe the bound socket with the configured TLS name/Host and certificate validation.
// No global certificate override, proxy headers or public DNS is needed.
try {
    const config = controlPlaneConfig();
    let ready = false;
    if (!config.transport) {
        const response = await fetch(`http://127.0.0.1:${config.port}/health`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
        ready = response.ok && (await response.json()).service === 'rs-sdk-control-plane';
    } else {
        const transport = config.transport, origin = new URL(transport.origin);
        ready = await new Promise<boolean>((resolve, reject) => {
            const req = request({ hostname: transport.hostname, port: config.port, path: '/health', method: 'GET',
                servername: origin.hostname.replace(/^\[|\]$/g, ''), headers: { Host: origin.host },
                ca: [...rootCertificates, readFileSync(transport.certificatePath)], timeout: 2000 }, response => {
                let body = ''; response.setEncoding('utf8');
                response.on('data', chunk => { body += chunk; if (body.length > 8192) req.destroy(new Error()); });
                response.on('error', reject);
                response.on('end', () => { try { resolve(response.statusCode === 200 && JSON.parse(body).service === 'rs-sdk-control-plane'); } catch { resolve(false); } });
            });
            req.on('timeout', () => req.destroy(new Error())); req.on('error', reject); req.end();
        });
    }
    if (!ready) throw new Error();
    console.log('Admin readiness verified.');
} catch { console.error('Admin readiness failed.'); process.exitCode = 1; }
