export interface ControlPlaneConfig { port: number; gatewayOrigin: string; engineOrigin: string; probeTimeoutMs: number; proxyTimeoutMs: number }
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
    return { port, gatewayOrigin, engineOrigin, probeTimeoutMs: 1000, proxyTimeoutMs: 60000 };
}
