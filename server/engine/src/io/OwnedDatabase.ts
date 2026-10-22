import { Database } from 'bun:sqlite';

/** Finalize cached and cache-evicted statements before strict SQLite connection shutdown. */
export class OwnedDatabase extends Database {
    private readonly statements = new Set<ReturnType<Database['query']>>();
    private closed = false;
    override query: Database['query'] = ((...args: Parameters<Database['query']>) => {
        const statement = super.query(...args); this.statements.add(statement); return statement;
    }) as Database['query'];
    override prepare: Database['prepare'] = ((...args: Parameters<Database['prepare']>) => {
        const statement = super.prepare(...args); this.statements.add(statement); return statement;
    }) as Database['prepare'];
    override close(throwOnError = true): void {
        if (this.closed) return;
        if (this.inTransaction) throw new Error('Cannot close active database transaction');
        for (const statement of this.statements) statement.finalize();
        this.statements.clear(); super.close(throwOnError); this.closed = true;
    }
}
