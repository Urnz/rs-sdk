import { existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';

import { institutionTreasuryDbPath } from '../server/gateway/admin/paths.js';

const count = (database: Database, table: string): number => {
    const exists = database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1").get(table);
    return exists ? (database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count : 0;
};
if (!existsSync(institutionTreasuryDbPath)) {
    console.log(JSON.stringify({ exists: false }));
    process.exit(0);
}
const database = new Database(institutionTreasuryDbPath, { readonly: true });
try {
    const externalCredits = count(database, 'institution_treasury_external_credit');
    const externalCreditAudits = count(database, 'institution_treasury_external_credit_audit');
    console.log(JSON.stringify({ exists: true,
        integrity: (database.query('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
        accounts: count(database, 'institution_treasury'),
        reservations: count(database, 'institution_treasury_reservation'),
        transfers: count(database, 'institution_treasury_transfer'), externalCredits, externalCreditAudits,
        externalCreditAuditCompleteByCount: externalCredits === externalCreditAudits }, null, 2));
} finally { database.close(); }
