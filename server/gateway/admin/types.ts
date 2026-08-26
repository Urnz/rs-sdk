import type { BotWorldState } from '../../../sdk/types';

export type AdminBotStatus = 'active' | 'stale' | 'offline' | 'starting' | 'stopping' | 'error';

export interface AdminSkill {
    name: string;
    level: number;
    experience: number;
}

export interface AdminItem {
    id: number;
    name: string;
    count: number;
    slot?: number;
}

export interface OfflineSaveSnapshot {
    valid: boolean;
    version: number;
    savedAt: string;
    position: { x: number; z: number; level: number };
    skills: AdminSkill[];
    totalLevel: number;
    totalXp: number;
    combatLevel: number;
    inventory: AdminItem[];
    equipment: AdminItem[];
    bank: AdminItem[];
    coins: number;
    error?: string;
}

export interface ManagedProcessSnapshot {
    status: 'starting' | 'running' | 'stopping' | 'exited' | 'error';
    pid: number | null;
    startedAt: string;
    exitCode: number | null;
    error?: string;
}

export interface ManagedSkillRunSnapshot {
    status: 'starting' | 'running' | 'stopping' | 'exited' | 'error';
    pid: number | null;
    skill: string;
    startedAt: string;
    exitCode: number | null;
    logPath: string;
    error?: string;
}

export interface BotCatalogEntry {
    username: string;
    displayName: string;
    status: AdminBotStatus;
    managed: boolean;
    hasSave: boolean;
    hasCredentials: boolean;
    canSpawn: boolean;
    canDespawn: boolean;
    canRestart: boolean;
    canTeleport: boolean;
    canEditOffline: boolean;
    saveSavedAt: string | null;
    currentSkill: string | null;
    runId: string | null;
    lastError: string | null;
    lastActivityAt: string | null;
    stateAgeMs: number | null;
    position: { x: number; z: number; level: number } | null;
    combatLevel: number;
    totalLevel: number;
    totalXp: number;
    coins: number;
    activity: string;
    skills: AdminSkill[];
    inventory: AdminItem[];
    equipment: AdminItem[];
    bank: AdminItem[];
    process: ManagedProcessSnapshot | null;
}

export interface GatewayBotSnapshot {
    username: string;
    status: 'active' | 'stale' | 'dead';
    connected: boolean;
    connectedAt: number;
    lastStateReceivedAt: number;
    state: BotWorldState | null;
    bankKnown?: boolean;
    bankDeltas?: Array<{ id: number; name: string; count: number }>;
    controllers: number;
    observers: number;
}

export interface EconomySnapshot {
    timestamp: string;
    bots: number;
    online: number;
    totalCoins: number;
    totalXp: number;
    averageTotalLevel: number;
    itemStock: Array<{ id: number; name: string; count: number }>;
}

export interface AuditEntry {
    id: string;
    timestamp: string;
    operator: string;
    action: string;
    username?: string;
    reason: string;
    before?: unknown;
    after?: unknown;
    success: boolean;
    error?: string;
}
