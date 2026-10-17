import { X509Certificate, createPrivateKey } from 'node:crypto';
import { constants } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import type { ControlPlaneConfig } from './config.js';
import type { SecretStore } from './secret-store.js';

export const tlsKeyName = 'control-plane-tls-key';
export function validateTls(certificate: string, key: string, origin: string, now = Date.now()) {
    try {
        const cert = new X509Certificate(certificate), privateKey = createPrivateKey(key);
        const host = new URL(origin).hostname.replace(/^\[|\]$/g, '');
        if (!cert.checkPrivateKey(privateKey) || !Number.isFinite(Date.parse(cert.validFrom)) || !Number.isFinite(Date.parse(cert.validTo))
            || now < Date.parse(cert.validFrom) || now >= Date.parse(cert.validTo)
            || !(isIP(host) ? cert.checkIP(host) : cert.checkHost(host, { subject: 'never' }))) throw new Error();
        return { cert: certificate, key, secureOptions: constants.SSL_OP_NO_TLSv1 | constants.SSL_OP_NO_TLSv1_1 };
    } catch { throw new Error('Invalid HTTPS certificate, hostname, validity or private key; listener was not opened.'); }
}
export async function loadTls(config: ControlPlaneConfig, secrets: SecretStore) {
    if (!config.transport) return undefined;
    try {
        const key = await secrets.get(tlsKeyName);
        if (!key) throw new Error();
        return validateTls(readFileSync(config.transport.certificatePath, 'utf8'), key, config.transport.origin);
    } catch { throw new Error('HTTPS could not be initialized; check the certificate and OS vault. HTTP fallback is disabled.'); }
}
