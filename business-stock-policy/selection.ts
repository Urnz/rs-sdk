import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { validateBusinessStockPolicyCatalog, type BusinessStockPolicyCatalog } from './policy.js';

/** Read selected policies from the same Business authority used by native commerce.
 * No fallback on corrupt selections; absent additive schema retains the base catalog.
 */
export function selectedBusinessStockCatalog(base: BusinessStockPolicyCatalog, source?: string | Database): BusinessStockPolicyCatalog {
    if (!source || typeof source === 'string' && !existsSync(source)) return base;
    const db = typeof source === 'string' ? new OwnedDatabase(source,{readonly:true,strict:true}) : source;
    try {
        if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_institution_selection'").get()) return base;
        const versions=db.query('SELECT version FROM business_institution_schema').all() as {version:number}[];
        if (versions.length!==1 || versions[0]!.version!==1) throw new Error('Unsupported selected Business stock schema');
        const rows = db.query(`SELECT s.business_id,s.stock_json,a.stock_json audit_stock,a.stock_digest,a.business_id audit_business,
            p.status policy_status FROM business_institution_selection s
            LEFT JOIN business_institution_application a ON a.application_id=s.application_id
            LEFT JOIN business_policy_proposal p ON p.proposal_id=a.proposal_id ORDER BY s.business_id`).all() as {
                business_id:string;stock_json:string;audit_stock:string|null;stock_digest:string|null;audit_business:string|null;policy_status:string|null;
            }[];
        const policies = [...base.policies];
        for (const row of rows) {
            if (row.business_id!==row.audit_business || row.stock_json!==row.audit_stock
                || createHash('sha256').update(row.stock_json).digest('hex')!==row.stock_digest || !row.policy_status)
                throw new Error('Selected Business stock audit differs');
            // A later explicit policy supersedes this selection, retaining its historical audit.
            if(row.policy_status!=='approved') continue;
            const raw: unknown = JSON.parse(row.stock_json);
            if (!Array.isArray(raw)) throw new Error('Corrupt selected Business stock policy');
            if (!raw.length) continue;
            const selected = validateBusinessStockPolicyCatalog({schemaVersion:1,policies:raw});
            for (const p of selected.policies) {
                const index = policies.findIndex(b=>b.businessId===row.business_id && b.itemId===p.itemId && b.policyId===p.policyId);
                if (p.businessId!==row.business_id || index < 0) throw new Error('Selected stock policy exact subject differs');
                policies[index]=p;
            }
        }
        return validateBusinessStockPolicyCatalog({schemaVersion:1,policies});
    } finally { if (typeof source === 'string') db.close(true); }
}
