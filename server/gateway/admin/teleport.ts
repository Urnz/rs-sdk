import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repoRoot } from './paths';

export interface AdminTeleportDestination {
    id: string;
    label: string;
    description: string;
    x: number;
    z: number;
    level: number;
}

export interface EngineTeleportResult {
    ok: boolean;
    commandId: string;
    username: string;
    destination: AdminTeleportDestination;
    before?: { x: number; z: number; level: number };
    after?: { x: number; z: number; level: number };
    tick?: number;
    code?: string;
    error?: string;
}

let cachedDestinations: AdminTeleportDestination[] | null = null;

function validDestination(value: unknown): value is AdminTeleportDestination {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Record<string, unknown>;
    return typeof entry.id === 'string' && /^[a-z0-9][a-z0-9-]{1,48}$/.test(entry.id)
        && typeof entry.label === 'string' && entry.label.length > 0 && entry.label.length <= 80
        && typeof entry.description === 'string' && entry.description.length > 0 && entry.description.length <= 240
        && Number.isInteger(entry.x) && Number(entry.x) >= 0 && Number(entry.x) <= 16383
        && Number.isInteger(entry.z) && Number(entry.z) >= 0 && Number(entry.z) <= 16383
        && Number.isInteger(entry.level) && Number(entry.level) >= 0 && Number(entry.level) <= 3;
}

export async function listAdminTeleportDestinations(): Promise<AdminTeleportDestination[]> {
    if (cachedDestinations) return cachedDestinations;
    const path = join(repoRoot, 'config', 'admin-teleport-destinations.json');
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(validDestination)) {
        throw new Error('Az admin teleport célpont-konfiguráció érvénytelen.');
    }
    const ids = new Set(parsed.map(entry => entry.id));
    if (ids.size !== parsed.length) throw new Error('Az admin teleport célpontazonosítók nem egyediek.');
    cachedDestinations = parsed;
    return cachedDestinations;
}

export async function resolveAdminTeleportDestination(id: string): Promise<AdminTeleportDestination> {
    const destination = (await listAdminTeleportDestinations()).find(entry => entry.id === id);
    if (!destination) throw new Error(`Nem engedélyezett teleport célpont: ${id}`);
    return destination;
}

export async function requestEngineTeleport(
    username: string,
    destinationId: string,
    commandId: string
): Promise<EngineTeleportResult> {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim();
    if (!token) throw new Error('Az engine admincsatorna nincs konfigurálva; indítsd a stacket a scripts/start-local.ps1 segítségével.');
    const baseUrl = process.env.ENGINE_ADMIN_URL?.trim() || 'http://localhost:8888';
    let response: Response;
    try {
        response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/internal/admin/teleport`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Engine-Admin-Token': token
            },
            body: JSON.stringify({ username, destinationId, commandId }),
            signal: AbortSignal.timeout(5_000)
        });
    } catch (error) {
        throw new Error(`Az engine admincsatorna nem érhető el: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = await response.json().catch(() => null) as EngineTeleportResult | null;
    if (!response.ok || !result?.ok) throw new Error(result?.error || `Az engine elutasította a teleportot (HTTP ${response.status}).`);
    return result;
}
