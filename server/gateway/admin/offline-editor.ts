import { SKILL_NAMES } from './save-reader';

export interface OfflineSaveEditItem {
    id: number;
    count: number;
}

export interface OfflineSaveEditSkill {
    name: string;
    experience: number;
}

export interface OfflineSaveDraft {
    expectedSavedAt: string;
    coins: number;
    skills: OfflineSaveEditSkill[];
    inventory: OfflineSaveEditItem[];
    bank: OfflineSaveEditItem[];
}

export interface OfflineSaveSummary extends Omit<OfflineSaveDraft, 'expectedSavedAt'> {
    savedAt: string;
}

export interface OfflineSaveResult {
    ok: boolean;
    commandId: string;
    username: string;
    operation: 'edit' | 'restore';
    backupId?: string;
    before?: OfflineSaveSummary;
    after?: OfflineSaveSummary;
    tick?: number;
    code?: string;
    error?: string;
}

export interface OfflineSaveBackup {
    id: string;
    username: string;
    createdAt: string;
    operation: 'edit' | 'restore';
    commandId: string;
    size: number;
}

export interface OfflineSaveReadiness {
    editable: boolean;
    code: 'ready' | 'player-online' | 'login-pending' | 'logout-pending';
}

export interface EnginePlayerLogoutResult {
    ok: boolean;
    commandId: string;
    username: string;
    tick?: number;
    code?: string;
    error?: string;
}

const enabledSkills = new Set(SKILL_NAMES.filter((_, index) => index !== 18 && index !== 19));

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
    if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${label}: egész szám szükséges ${minimum} és ${maximum} között.`);
    }
    return Number(value);
}

function items(value: unknown, label: string): OfflineSaveEditItem[] {
    if (!Array.isArray(value) || value.length > 2048) throw new Error(`${label}: érvénytelen itemlista.`);
    return value.map((raw, index) => {
        if (!raw || typeof raw !== 'object') throw new Error(`${label} ${index + 1}. sora érvénytelen.`);
        const entry = raw as Record<string, unknown>;
        const id = integer(entry.id, `${label} ${index + 1}. item ID`, 0, 65_534);
        if (id === 995) throw new Error('A coinokat a külön Pénz mezőben kell megadni.');
        return { id, count: integer(entry.count, `${label} ${index + 1}. mennyiség`, 1, 2_147_483_647) };
    });
}

export function validateOfflineSaveDraft(value: unknown): OfflineSaveDraft {
    if (!value || typeof value !== 'object') throw new Error('Hiányzó offline mentéstervezet.');
    const draft = value as Record<string, unknown>;
    const expectedSavedAt = typeof draft.expectedSavedAt === 'string' ? draft.expectedSavedAt.trim() : '';
    if (!expectedSavedAt || Number.isNaN(Date.parse(expectedSavedAt))) throw new Error('A megnyitott mentés időbélyege hiányzik vagy érvénytelen.');
    if (!Array.isArray(draft.skills) || draft.skills.length > enabledSkills.size) throw new Error('Érvénytelen skilllista.');
    const seen = new Set<string>();
    const skills = draft.skills.map((raw, index): OfflineSaveEditSkill => {
        if (!raw || typeof raw !== 'object') throw new Error(`A(z) ${index + 1}. skill érvénytelen.`);
        const entry = raw as Record<string, unknown>;
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        if (!enabledSkills.has(name as typeof SKILL_NAMES[number]) || seen.has(name)) throw new Error(`Ismeretlen vagy ismétlődő skill: ${name || index + 1}`);
        seen.add(name);
        return { name, experience: integer(entry.experience, `${name} XP`, 0, 2_000_000_000) };
    });
    return {
        expectedSavedAt,
        coins: integer(draft.coins, 'Pénz', 0, 2_147_483_647),
        skills,
        inventory: items(draft.inventory, 'Inventory'),
        bank: items(draft.bank, 'Bank')
    };
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
    if (!response.ok || result?.ok === false) throw new Error(result?.error || `Az engine elutasította a mentésműveletet (HTTP ${response.status}).`);
    if (!result) throw new Error('Az engine üres választ adott a mentésműveletre.');
    return result;
}

export function requestEngineOfflineEdit(username: string, draft: OfflineSaveDraft, commandId: string): Promise<OfflineSaveResult> {
    return engineRequest('/api/internal/admin/offline-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, draft, commandId })
    });
}

export function requestEnginePlayerLogout(username: string, commandId: string): Promise<EnginePlayerLogoutResult> {
    return engineRequest('/api/internal/admin/player-logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, commandId })
    });
}

export function requestEngineOfflineRestore(
    username: string,
    backupId: string,
    expectedSavedAt: string,
    commandId: string
): Promise<OfflineSaveResult> {
    return engineRequest('/api/internal/admin/offline-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, backupId, expectedSavedAt, commandId })
    });
}

export async function listEngineOfflineBackups(username: string): Promise<{ backups: OfflineSaveBackup[]; readiness: OfflineSaveReadiness }> {
    return engineRequest<{ backups: OfflineSaveBackup[]; readiness: OfflineSaveReadiness }>(
        `/api/internal/admin/offline-backups/${encodeURIComponent(username)}`,
        { method: 'GET' }
    );
}
