export interface EnginePlayerEscrowItem {
    id: number;
    count: number;
}

export interface EnginePlayerEscrowAssets {
    gp: number;
    items: EnginePlayerEscrowItem[];
}

export type EnginePlayerEscrowOperation = 'hold' | 'release' | 'commit';

export interface EnginePlayerEscrowRequest {
    escrowId: string;
    operation: EnginePlayerEscrowOperation;
    username: string;
    payeeUsername?: string;
    assets?: EnginePlayerEscrowAssets;
}

export interface EnginePlayerEscrowResult {
    ok: boolean;
    commandId: string;
    escrowId: string;
    operation: EnginePlayerEscrowOperation;
    username: string;
    payeeUsername?: string;
    escrow?: {
        escrowId: string;
        username: string;
        assets: EnginePlayerEscrowAssets;
        status: 'pending' | 'held' | 'releasing' | 'released' | 'rejected' | 'reconcile' | 'settling' | 'committed';
        payeeUsername: string | null;
        committedAt: string | null;
    };
    tick?: number;
    code?: string;
    error?: string;
}

function engineConfig(): { baseUrl: string; token: string } {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim();
    if (!token) throw new Error('Az engine játékos-escrow csatornája nincs konfigurálva.');
    return { baseUrl: (process.env.ENGINE_ADMIN_URL?.trim() || 'http://localhost:8888').replace(/\/$/, ''), token };
}

export async function requestEnginePlayerEscrow(request: EnginePlayerEscrowRequest,
    commandId: string = crypto.randomUUID()): Promise<EnginePlayerEscrowResult> {
    const { baseUrl, token } = engineConfig();
    let response: Response;
    try {
        response = await fetch(`${baseUrl}/api/internal/admin/player-escrow`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Engine-Admin-Token': token },
            body: JSON.stringify({ commandId, escrowId: request.escrowId, operation: request.operation,
                username: request.username, ...(request.payeeUsername === undefined
                    ? {} : { payeeUsername: request.payeeUsername }),
                ...(request.assets === undefined ? {} : { assets: request.assets }) }),
            signal: AbortSignal.timeout(8_000)
        });
    } catch (error) {
        throw new Error(`Az engine játékos-escrow csatornája nem érhető el: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = await response.json().catch(() => null) as EnginePlayerEscrowResult | null;
    if (!response.ok || !result?.ok) {
        throw new Error(result?.error || `Az engine elutasította a játékos-escrow műveletet (HTTP ${response.status}).`);
    }
    return result;
}
