import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { controlPlaneConfig } from './config.js';
import { identityPath } from './identity-store.js';
import { ServerSecretStore } from './secret-store.js';
import { tlsKeyName, validateTls } from './tls.js';

// Import only; neither stdin contents nor parser/crypto errors may reach logs.
try {
    const config = controlPlaneConfig();
    if (!config.transport) throw new Error();
    const input = await Bun.stdin.text();
    if (Buffer.byteLength(input) > 8192) throw new Error();
    const { key } = JSON.parse(input);
    if (typeof key !== 'string') throw new Error();
    validateTls(readFileSync(config.transport.certificatePath, 'utf8'), key, config.transport.origin);
    await new ServerSecretStore(dirname(identityPath())).set(tlsKeyName, key);
    console.log('HTTPS private key imported into the OS vault. Restart the admin to activate the certificate.');
} catch { console.error('HTTPS import failed. Check the HTTPS configuration, certificate, key and OS vault; no plaintext fallback.'); process.exitCode = 1; }
