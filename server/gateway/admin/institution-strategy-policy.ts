import { readFileSync } from 'node:fs';
import { validateBusinessStockPolicyCatalog, type BusinessStockPolicy } from '../../../business-stock-policy/policy.js';
import { stateDigest } from '../../../agent-state/state-objectives.js';
import type { BusinessPolicyMode } from './business-manager.js';

export interface InstitutionPolicyOption {
    optionId: string; objective: string; mode: BusinessPolicyMode; maxRewardGp: number;
    preferredSkills: { id: string; version: string }[];
    stockPolicies: BusinessStockPolicy[];
    work: { policyId: string; employmentId: string; durationMinutes: number;
        parameters: Record<string, string | number | boolean>;
        target: { kind: 'delivery'; recipient: string } | { kind: 'cook'; kitchenRunId: string; batchId: string } } | null;
}
export interface InstitutionStrategyGrant {
    agentId: string; businessId: string; policyId: string; policyVersion: string;
    maxGpPerDecision: number; maxGpPerDay: number; options: InstitutionPolicyOption[];
}
export interface InstitutionStrategyPolicy { schemaVersion: 1; grants: InstitutionStrategyGrant[] }
const object = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid institution policy object');
    return v as Record<string, unknown>;
};
const keys = (v: Record<string, unknown>, expected: string[]) => {
    if (Object.keys(v).sort().join() !== expected.sort().join()) throw new Error('Unexpected institution policy fields');
};
const id = (v: unknown) => {
    if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(v)) throw new Error('Invalid institution policy id'); return v;
};
const gp = (v: unknown) => {
    if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) > 2_147_483_647) throw new Error('Invalid institution gp bound'); return Number(v);
};
export function validateInstitutionStrategyPolicy(raw: unknown): InstitutionStrategyPolicy {
    const root = object(raw); keys(root, ['schemaVersion', 'grants']);
    if (root.schemaVersion !== 1 || !Array.isArray(root.grants) || root.grants.length > 100) throw new Error('Invalid institution grants');
    const grants = root.grants.map(value => {
        const g = object(value); keys(g, ['agentId','businessId','policyId','policyVersion','maxGpPerDecision','maxGpPerDay','options']);
        if (!Array.isArray(g.options) || !g.options.length || g.options.length > 12) throw new Error('Invalid institution option count');
        const businessId = id(g.businessId);
        const options = g.options.map(value => {
            const o = object(value); keys(o, ['optionId','objective','mode','maxRewardGp','preferredSkills','stockPolicies','work']);
            if (typeof o.objective !== 'string' || !o.objective.trim() || o.objective.length > 320
                || !['balanced','growth','profit','survival'].includes(String(o.mode)) || !Array.isArray(o.preferredSkills)
                || o.preferredSkills.length > 20 || !Array.isArray(o.stockPolicies) || o.stockPolicies.length>20) throw new Error('Invalid institution option');
            const preferredSkills = o.preferredSkills.map(value => { const s = object(value); keys(s,['id','version']);
                if (typeof s.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(s.version)) throw new Error('Invalid institution skill version');
                return { id: id(s.id), version: s.version }; });
            const stockPolicies = o.stockPolicies.length ? validateBusinessStockPolicyCatalog({schemaVersion:1,policies:o.stockPolicies}).policies : [];
            if (stockPolicies.some(p => p.businessId !== businessId)) throw new Error('Institution stock subject differs');
            let work: InstitutionPolicyOption['work'] = null;
            if (o.work !== null) {
                const w = object(o.work); keys(w, ['policyId','employmentId','durationMinutes','parameters','target']);
                const parameters = object(w.parameters);
                if (Object.keys(parameters).length > 20 || Object.entries(parameters).some(([k,v]) => !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(k)
                    || !['string','number','boolean'].includes(typeof v) || typeof v === 'number' && !Number.isFinite(v)
                    || typeof v === 'string' && v.length > 200)) throw new Error('Invalid institution work parameters');
                const t = object(w.target);
                if (t.kind === 'delivery') { keys(t,['kind','recipient']); if (typeof t.recipient !== 'string' || !/^[a-z0-9]{1,12}$/.test(t.recipient)) throw new Error('Invalid delivery recipient'); }
                else if (t.kind === 'cook') { keys(t,['kind','kitchenRunId','batchId']); id(t.kitchenRunId); id(t.batchId); }
                else throw new Error('Invalid institution work target');
                const durationMinutes = gp(w.durationMinutes); if (durationMinutes < 1 || durationMinutes > 1440) throw new Error('Invalid institution shift duration');
                work = { policyId:id(w.policyId),employmentId:id(w.employmentId),durationMinutes,
                    parameters:parameters as Record<string,string|number|boolean>,
                    target:t as unknown as NonNullable<InstitutionPolicyOption['work']>['target'] };
            }
            return { optionId:id(o.optionId),objective:o.objective,mode:o.mode as BusinessPolicyMode,maxRewardGp:gp(o.maxRewardGp),preferredSkills,stockPolicies,work };
        });
        if (new Set(options.map(o=>o.optionId)).size !== options.length) throw new Error('Duplicate institution options');
        if (typeof g.policyVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(g.policyVersion)) throw new Error('Invalid institution policy version');
        return {agentId:id(g.agentId),businessId,policyId:id(g.policyId),policyVersion:g.policyVersion,
            maxGpPerDecision:gp(g.maxGpPerDecision),maxGpPerDay:gp(g.maxGpPerDay),options};
    });
    if (new Set(grants.map(g=>g.agentId)).size !== grants.length || new Set(grants.map(g=>g.businessId)).size !== grants.length)
        throw new Error('Institution grants need unique exact agents and Businesses');
    return {schemaVersion:1,grants};
}
export const loadInstitutionStrategyPolicy = (path: string) => validateInstitutionStrategyPolicy(JSON.parse(readFileSync(path,'utf8')));
export const institutionGrantDigest = (grant: InstitutionStrategyGrant) => stateDigest(grant);
