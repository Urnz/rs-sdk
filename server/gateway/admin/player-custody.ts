export interface EnginePlayerCustodyRequest {
    custodyId: string;
    decisionId: string;
    decisionDigest: string;
    username: string;
    jurisdictionId: string;
    x: number;
    z: number;
    level: number;
    startedAt: string;
    releaseAt: string;
}

export interface EnginePlayerCustodyResult {
    ok: boolean;
    commandId: string;
    custodyId: string;
    username: string;
    custody?: EnginePlayerCustodyRequest & {
        status: 'active' | 'released';
        releasedAt: string | null;
        orderDigest: string;
    };
    tick?: number;
    code?: string;
    error?: string;
}

function engineConfig(): { baseUrl: string; token: string } {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim();
    if (!token) throw new Error('Az engine custody csatornája nincs konfigurálva.');
    return { baseUrl: (process.env.ENGINE_ADMIN_URL?.trim() || 'http://localhost:8888').replace(/\/$/, ''), token };
}

/** Narrow engine port: it applies a frozen order and never decides whether custody is lawful. */
export async function requestEnginePlayerCustody(request: EnginePlayerCustodyRequest,
    commandId: string = crypto.randomUUID()): Promise<EnginePlayerCustodyResult> {
    const { baseUrl, token } = engineConfig();
    let response: Response;
    try {
        response = await fetch(`${baseUrl}/api/internal/admin/player-custody`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Engine-Admin-Token': token },
            body: JSON.stringify({ commandId, ...request }), signal: AbortSignal.timeout(8_000)
        });
    } catch (error) {
        throw new Error(`Az engine custody csatornája nem érhető el: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = await response.json().catch(() => null) as EnginePlayerCustodyResult | null;
    if (!response.ok || !result?.ok)
        throw new Error(result?.error || `Az engine elutasította a custody műveletet (HTTP ${response.status}).`);
    return result;
}
