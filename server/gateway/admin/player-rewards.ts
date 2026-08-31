export interface EnginePlayerRewardResult {
    ok: boolean;
    commandId: string;
    settlementId: string;
    username: string;
    amount: number;
    reward?: { status: 'committed'; coinsBefore: number; coinsAfter: number };
    tick?: number;
    code?: string;
    error?: string;
}

function engineConfig(): { baseUrl: string; token: string } {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim();
    if (!token) throw new Error('Az engine admincsatorna nincs konfigurálva.');
    return { baseUrl: (process.env.ENGINE_ADMIN_URL?.trim() || 'http://localhost:8888').replace(/\/$/, ''), token };
}

export async function requestEnginePlayerReward(username: string, amount: number,
    settlementId: string, commandId = crypto.randomUUID()): Promise<EnginePlayerRewardResult> {
    const { baseUrl, token } = engineConfig();
    let response: Response;
    try {
        response = await fetch(`${baseUrl}/api/internal/admin/player-reward`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Engine-Admin-Token': token },
            body: JSON.stringify({ username, amount, settlementId, commandId }),
            signal: AbortSignal.timeout(8_000)
        });
    } catch (error) {
        throw new Error(`Az engine jutalomcsatornája nem érhető el: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = await response.json().catch(() => null) as EnginePlayerRewardResult | null;
    if (!response.ok || !result?.ok) {
        throw new Error(result?.error || `Az engine elutasította a jutalmat (HTTP ${response.status}).`);
    }
    return result;
}
