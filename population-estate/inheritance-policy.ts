import { readFileSync } from 'node:fs';
import { healthDigest, healthKey, healthObject } from '../population-health/policy.js';

export interface InheritanceBinding { ruleId: string; factionId: string; jurisdictionId: string | null; propertyIds: string[] }
export interface InheritancePolicy {
    schemaVersion: 1; policyId: string; version: string; mode: 'admin-single-heir-personal-property';
    bindings: InheritanceBinding[]; digest: string;
}
export interface InheritanceAsset { propertyId: string; beforeVersion: number; beforeRowDigest: string }
export interface InheritancePlan {
    schemaVersion: 1; decisionId: string; estateId: string; deathDigest: string; custodyReceiptDigest: string;
    policyDigest: string; ruleId: string; governanceDigest: string; sourcesDigest: string;
    heirAgentId: string; heirUsername: string; heirLifecycleCreatedAt: string;
    previewDigest: string; approvedRevision: number;
    actor: 'admin'; reason: string; assets: InheritanceAsset[]; createdAt: string;
}
export interface EstateInheritance { plan: InheritancePlan; digest: string; status: 'prepared' | 'completed'; completedAt: string | null }
export function validateInheritancePolicy(raw: unknown): InheritancePolicy {
    const value = healthObject(raw,['schemaVersion','policyId','version','mode','bindings'],'Inheritance policy');
    if (value.schemaVersion !== 1 || value.mode !== 'admin-single-heir-personal-property'
        || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version)
        || !Array.isArray(value.bindings) || value.bindings.length > 256) throw new Error('Inheritance policy is invalid');
    const ids = new Set<string>(), assigned = new Set<string>();
    const bindings = value.bindings.map(raw => {
        const item = healthObject(raw,['ruleId','factionId','jurisdictionId','propertyIds'],'Inheritance binding');
        const ruleId = healthKey(item.ruleId), factionId = healthKey(item.factionId);
        if (ids.has(ruleId) || !Array.isArray(item.propertyIds) || !item.propertyIds.length || item.propertyIds.length > 10000)
            throw new Error('Inheritance binding is duplicate or empty');
        ids.add(ruleId);
        const propertyIds = item.propertyIds.map(healthKey);
        for (const id of propertyIds) { if (assigned.has(id)) throw new Error('Inheritance property has ambiguous jurisdiction'); assigned.add(id); }
        return { ruleId,factionId,jurisdictionId:item.jurisdictionId === null ? null : healthKey(item.jurisdictionId),propertyIds };
    });
    const definition = {schemaVersion:1 as const,policyId:healthKey(value.policyId),version:value.version,
        mode:'admin-single-heir-personal-property' as const,bindings};
    return {...definition,digest:healthDigest(definition)};
}
export function loadInheritancePolicy(path: string): InheritancePolicy { return validateInheritancePolicy(JSON.parse(readFileSync(path,'utf8'))); }
