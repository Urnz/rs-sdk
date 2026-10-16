import { readFileSync } from 'node:fs';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { validateWorldGenesisProfile } from '../world-genesis/profile.js';
import type { WorldGenesisProfile } from '../world-genesis/types.js';
export { digest };
export function object(value: unknown, fields: string[]): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...fields].sort().join(','))
        throw new Error('External trade fields are invalid');
    return value as Record<string, any>;
}
export function key(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(value)) throw new Error('External trade identifier is invalid'); return value;
}
export function username(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-z0-9]{1,12}$/.test(value)) throw new Error('External trade username is invalid'); return value;
}
export function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) throw new Error('External trade integer is invalid'); return Number(value);
}
export function time(value: unknown): string {
    if (typeof value !== 'string' || !Number.isSafeInteger(Date.parse(value)) || new Date(value).toISOString() !== value)
        throw new Error('External trade timestamp is invalid'); return value;
}
export function hash(value: unknown): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('External trade digest is invalid'); return value;
}
function version(value: unknown): string {
    if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw new Error('External trade version is invalid'); return value;
}
export interface ExternalPartner {
    counterpartyId: string; username: string; maximumTrades: number; maximumImportedGp: number; maximumExportedGp: number;
    items: Array<{ itemId: number; maximumImportedUnits: number; maximumExportedUnits: number }>;
}
export interface ExternalTradePolicy {
    schemaVersion: 1; policyId: string; version: string; settlement: 'committed-engine-player-trade';
    automaticRestock: 'forbidden'; maximumSimulationMilliseconds: number; counterparties: ExternalPartner[]; digest: string;
}
export function validateExternalTradePolicy(raw: unknown): ExternalTradePolicy {
    const value = object(raw, ['schemaVersion', 'policyId', 'version', 'settlement', 'automaticRestock', 'maximumSimulationMilliseconds', 'counterparties']);
    if (value.schemaVersion !== 1 || value.settlement !== 'committed-engine-player-trade' || value.automaticRestock !== 'forbidden'
        || !Array.isArray(value.counterparties) || value.counterparties.length < 1 || value.counterparties.length > 100)
        throw new Error('External trade requires finite named engine counterparties');
    const counterparties: ExternalPartner[] = value.counterparties.map((raw: unknown) => {
        const p = object(raw, ['counterpartyId', 'username', 'maximumTrades', 'maximumImportedGp', 'maximumExportedGp', 'items']);
        if (!Array.isArray(p.items) || p.items.length < 1 || p.items.length > 1000) throw new Error('External trade item limits are required');
        const items: ExternalPartner['items'] = p.items.map((raw: unknown) => {
            const item = object(raw, ['itemId', 'maximumImportedUnits', 'maximumExportedUnits']), itemId = integer(item.itemId, 65535);
            if (itemId === 995) throw new Error('External currency must use GP limits');
            return { itemId, maximumImportedUnits: integer(item.maximumImportedUnits, 10000000), maximumExportedUnits: integer(item.maximumExportedUnits, 10000000) };
        });
        if (new Set(items.map(item => item.itemId)).size !== items.length) throw new Error('Duplicate external item limit');
        const maximumTrades = integer(p.maximumTrades, 10000);
        if (!maximumTrades) throw new Error('External trade count must be finite and positive');
        return { counterpartyId: key(p.counterpartyId), username: username(p.username), maximumTrades,
            maximumImportedGp: integer(p.maximumImportedGp, 2147483647), maximumExportedGp: integer(p.maximumExportedGp, 2147483647),
            items: items.sort((a, b) => a.itemId - b.itemId) };
    });
    if (new Set(counterparties.map(item => item.counterpartyId)).size !== counterparties.length
        || new Set(counterparties.map(item => item.username)).size !== counterparties.length) throw new Error('Duplicate external counterparty');
    const duration = integer(value.maximumSimulationMilliseconds, 31536000000);
    if (!duration) throw new Error('External trade duration must be positive');
    const definition = { schemaVersion: 1 as const, policyId: key(value.policyId), version: version(value.version),
        settlement: 'committed-engine-player-trade' as const, automaticRestock: 'forbidden' as const,
        maximumSimulationMilliseconds: duration, counterparties: counterparties.sort((a, b) => a.counterpartyId.localeCompare(b.counterpartyId)) };
    return { ...definition, digest: digest(definition) };
}
export interface ExternalTradeBinding { worldProfileId: string; worldProfileVersion: string; worldProfileDigest: string;
    policyId: string; policyVersion: string; policyDigest: string }
export function validateExternalTradeCatalogs(policyRaw: unknown, bindingRaw: unknown) {
    const p = object(policyRaw, ['schemaVersion', 'policies']), b = object(bindingRaw, ['schemaVersion', 'bindings']);
    if (p.schemaVersion !== 1 || b.schemaVersion !== 1 || !Array.isArray(p.policies) || !Array.isArray(b.bindings)
        || p.policies.length > 100 || b.bindings.length > 100) throw new Error('External trade catalogs are invalid');
    const policies = p.policies.map(validateExternalTradePolicy) as ExternalTradePolicy[];
    const bindings: ExternalTradeBinding[] = b.bindings.map((raw: unknown) => {
        const item = object(raw, ['worldProfileId', 'worldProfileVersion', 'worldProfileDigest', 'policyId', 'policyVersion', 'policyDigest']);
        if (!['blank-slate', 'frontier', 'seeded-economy', 'mature-society', 'historical-burn-in'].includes(item.worldProfileId)) throw new Error('Unknown external trade world profile');
        return { worldProfileId: item.worldProfileId, worldProfileVersion: version(item.worldProfileVersion), worldProfileDigest: hash(item.worldProfileDigest),
            policyId: key(item.policyId), policyVersion: version(item.policyVersion), policyDigest: hash(item.policyDigest) };
    });
    if (new Set(policies.map(item => `${item.policyId}@${item.version}`)).size !== policies.length
        || new Set(bindings.map(item => item.worldProfileId)).size !== bindings.length) throw new Error('Conflicting external trade bindings');
    for (const b of bindings) if (!policies.some(p => p.policyId === b.policyId && p.version === b.policyVersion && p.digest === b.policyDigest)) throw new Error('Stale external trade policy binding');
    return { policies, bindings };
}
export function loadExternalTradeCatalogs(directory: string) {
    return validateExternalTradeCatalogs(JSON.parse(readFileSync(`${directory}/external-trade-policies.json`, 'utf8')),
        JSON.parse(readFileSync(`${directory}/external-trade-world-profile-bindings.json`, 'utf8')));
}
export function resolveExternalTradePolicy(profile: WorldGenesisProfile, catalogs: ReturnType<typeof validateExternalTradeCatalogs>): ExternalTradePolicy | null {
    const { digest: profileDigest, ...definition } = profile;
    if (validateWorldGenesisProfile(definition).digest !== profileDigest) throw new Error('External trade world profile digest differs');
    const binding = catalogs.bindings.find(item => item.worldProfileId === profile.profileId);
    if (!binding) return null;
    if (binding.worldProfileVersion !== profile.version || binding.worldProfileDigest !== profile.digest) throw new Error('Stale external trade world binding');
    const policy = catalogs.policies.find(item => item.policyId === binding.policyId && item.version === binding.policyVersion);
    if (!policy) throw new Error('External trade policy is unavailable');
    const { digest: policyDigest, ...policyDefinition } = policy;
    if (validateExternalTradePolicy(policyDefinition).digest !== policyDigest || policyDigest !== binding.policyDigest) throw new Error('Stale external trade policy digest');
    return structuredClone(policy);
}
