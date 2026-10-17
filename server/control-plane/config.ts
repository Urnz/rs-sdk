import { isIP } from 'node:net';
export interface ControlPlaneConfig { port: number; gatewayOrigin: string; engineOrigin: string; probeTimeoutMs: number; proxyTimeoutMs: number;
    transport?: { hostname: string; origin: string; certificatePath: string } }
export function privateBind(address: string) {
    if (!isIP(address)) return false;
    if (address === '::1') return true;
    if (isIP(address) === 6) return /^f[cd][0-9a-f]{2}:/i.test(address);
    const [a, b] = address.split('.').map(Number);
    return a === 127 || a === 10 || a === 192 && b === 168 || a === 172 && b! >= 16 && b! <= 31;
}
export function localOrigin(value: string) {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
        throw new Error('Control plane supports only a local/private HTTP origin');
    return url.origin;
}
export function controlPlaneConfig(env: Record<string, string | undefined> = process.env): ControlPlaneConfig {
    const port = Number(env.CONTROL_PLANE_PORT ?? '7781');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid control plane port');
    const gatewayOrigin = localOrigin(env.CONTROL_PLANE_GATEWAY_ORIGIN ?? 'http://localhost:7780');
    const engineOrigin = localOrigin(env.CONTROL_PLANE_ENGINE_ORIGIN ?? 'http://localhost:8888');
    if ([gatewayOrigin, engineOrigin].some(origin => Number(new URL(origin).port || 80) === port)) throw new Error('Control plane and backend ports must differ');
    const values = [env.CONTROL_PLANE_HTTPS_ORIGIN, env.CONTROL_PLANE_BIND, env.CONTROL_PLANE_TLS_CERT];
    let transport: ControlPlaneConfig['transport'];
    if (values.some(value => value !== undefined)) {
        if (values.some(value => !value)) throw new Error('HTTPS requires origin, private bind address and certificate path');
        const origin = new URL(values[0]!);
        if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
            || Number(origin.port || 443) !== port || !privateBind(values[1]!)) throw new Error('Invalid private HTTPS configuration');
        transport = { origin: origin.origin, hostname: values[1]!, certificatePath: values[2]! };
    }
    return { port, gatewayOrigin, engineOrigin, probeTimeoutMs: 1000, proxyTimeoutMs: 60000, ...(transport ? { transport } : {}) };
}
