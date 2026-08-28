export interface AdminPropertyOwner {
    kind: 'player' | 'business' | 'faction';
    id: string;
}

export interface AdminPropertyView {
    propertyId: string;
    displayName: string;
    description: string;
    type: string;
    location: { x: number; z: number; level: number; region: string };
    purchasePrice: number;
    state: {
        status: 'available' | 'owned' | 'locked' | 'disabled';
        owner: AdminPropertyOwner | null;
        acquiredAt: string | null;
        updatedAt: string;
        version: number;
    };
}

export interface AdminPropertyList {
    enabled: boolean;
    properties: AdminPropertyView[];
}

export interface EnginePropertyPurchaseResult {
    ok: boolean;
    commandId: string;
    username: string;
    propertyId: string;
    property?: AdminPropertyView;
    coinsBefore?: number;
    coinsAfter?: number;
    tick?: number;
    code?: string;
    error?: string;
}

function engineConfig(): { baseUrl: string; token: string } {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim();
    if (!token) throw new Error('Az engine admincsatorna nincs konfigurálva; indítsd a stacket a scripts/start-local.ps1 segítségével.');
    return { baseUrl: (process.env.ENGINE_ADMIN_URL?.trim() || 'http://localhost:8888').replace(/\/$/, ''), token };
}

async function engineRequest<T>(path: string, options: RequestInit): Promise<T> {
    const { baseUrl, token } = engineConfig();
    let response: Response;
    try {
        response = await fetch(`${baseUrl}${path}`, {
            ...options,
            headers: { ...(options.headers || {}), 'X-Engine-Admin-Token': token },
            signal: AbortSignal.timeout(8_000)
        });
    } catch (error) {
        throw new Error(`Az engine admincsatorna nem érhető el: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = await response.json().catch(() => null) as (T & { ok?: boolean; error?: string }) | null;
    if (!response.ok || result?.ok === false) throw new Error(result?.error || `Az engine elutasította az ingatlanműveletet (HTTP ${response.status}).`);
    if (!result) throw new Error('Az engine üres választ adott az ingatlanműveletre.');
    return result;
}

export function listEngineProperties(): Promise<AdminPropertyList> {
    return engineRequest('/api/internal/admin/properties', { method: 'GET' });
}

export function requestEnginePropertyPurchase(
    username: string,
    propertyId: string,
    commandId: string
): Promise<EnginePropertyPurchaseResult> {
    return engineRequest('/api/internal/admin/properties/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, propertyId, commandId })
    });
}
