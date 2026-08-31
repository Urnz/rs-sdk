import type { WorldEventKind } from './world-director.js';
import type { TrustedWorldEventAdapter, WorldDirectorSignal } from './world-director-runtime.js';

export interface EngineWorldDirectorEventResult {
    ok: boolean;
    commandId: string;
    eventId: string;
    created?: boolean;
    tick?: number;
    code?: string;
    error?: string;
}

export type EngineWorldDirectorRequester =
    (signal: WorldDirectorSignal, commandId?: string) => Promise<EngineWorldDirectorEventResult>;

function engineConfig(): { baseUrl: string; token: string } {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim();
    if (!token) throw new Error('Az engine World Director csatornája nincs konfigurálva.');
    return { baseUrl: (process.env.ENGINE_ADMIN_URL?.trim() || 'http://localhost:8888').replace(/\/$/, ''), token };
}

export async function requestEngineWorldDirectorEvent(signal: WorldDirectorSignal,
    commandId: string = crypto.randomUUID()): Promise<EngineWorldDirectorEventResult> {
    const { baseUrl, token } = engineConfig();
    let response: Response;
    try {
        response = await fetch(`${baseUrl}/api/internal/admin/world-director/event`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Engine-Admin-Token': token },
            body: JSON.stringify({ commandId, eventId: signal.eventId, cycleKey: signal.cycleKey,
                selectionDigest: signal.selectionDigest, kind: signal.kind, templateId: signal.templateId,
                templateVersion: signal.templateVersion, title: signal.title, summary: signal.summary,
                regions: signal.regions, tags: signal.tags }), signal: AbortSignal.timeout(8_000)
        });
    } catch (error) {
        throw new Error(`Az engine World Director csatornája nem érhető el: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = await response.json().catch(() => null) as EngineWorldDirectorEventResult | null;
    if (!response.ok || !result?.ok) {
        throw new Error(result?.error || `Az engine elutasította a World Director eseményt (HTTP ${response.status}).`);
    }
    return result;
}

export class EngineWorldDirectorAdapter implements TrustedWorldEventAdapter {
    readonly adapterId = 'engine-world-signals-v1';
    readonly supportedKinds: readonly WorldEventKind[] =
        ['economic-signal', 'resource-signal', 'social-signal', 'world-flavor'];

    constructor(private readonly requester: EngineWorldDirectorRequester = requestEngineWorldDirectorEvent) {}

    async publish(signal: WorldDirectorSignal): Promise<void> {
        await this.requester(signal);
    }
}
