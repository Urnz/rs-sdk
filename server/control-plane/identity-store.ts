import { Database } from 'bun:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const localServerId = 'local-default';
export const sessionLifetimeSeconds = 8 * 60 * 60;
const hashOptions = { algorithm: 'argon2id' as const, memoryCost: 65536, timeCost: 3 };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const csrfFor = (token: string) => digest(`rs-control-csrf:${token}`);
export const identityPath = () => resolve(process.env.CONTROL_PLANE_IDENTITY_PATH || resolve(import.meta.dir, '../../.local/control-plane/identity.sqlite'));
export class IdentityError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
}
const denied = () => new IdentityError(403, 'OWNER_REQUIRED', 'Ehhez a helyi szerverhez tulajdonosi jogosultság szükséges.');
const invalidLogin = () => new IdentityError(401, 'INVALID_LOGIN', 'Érvénytelen felhasználónév vagy jelszó.');
export interface Account { id: string; username: string }
export interface Session { account: Account; expiresAt: number }
interface PasswordAccount extends Account { password_hash: string }

/** Separate identity DB. No game/domain state and no plaintext passwords or session tokens. */
export class IdentityStore {
    private db: Database;
    private hashing = 0;
    constructor(path: string, private now = () => Date.now(), readonly = false) {
        if (!readonly && path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        this.db = new Database(path, readonly ? { readonly: true } : { create: true });
        try {
            if (!readonly && path !== ':memory:') chmodSync(path, 0o600);
            this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
            const version = (this.db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
            if (version !== 0 && version !== 1 || readonly && version !== 1) throw new Error('Unsupported control-plane identity schema');
            if (!readonly) {
                this.db.exec('PRAGMA journal_mode=WAL');
                if (version === 0) this.db.transaction(() => {
                    if ((this.db.query('PRAGMA user_version').get() as { user_version: number }).user_version === 1) return;
                    this.db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
                        CREATE TABLE ownership (account_id TEXT NOT NULL REFERENCES accounts(id), resource_id TEXT NOT NULL, PRIMARY KEY(account_id, resource_id));
                        CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL);
                        CREATE INDEX sessions_account ON sessions(account_id);
                        CREATE TABLE login_budget (id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL, attempts INTEGER NOT NULL);
                        CREATE TABLE identity_audit (sequence INTEGER PRIMARY KEY, kind TEXT NOT NULL, actor_id TEXT, subject_id TEXT, resource_id TEXT, created_at INTEGER NOT NULL);
                        PRAGMA user_version=1`);
                }).immediate();
            }
        } catch (error) { this.db.close(); throw error; }
    }
    close() { this.db.close(); }
    private audit(kind: string, actor: string | null, subject: string | null, resource: string | null = null) {
        this.db.query('INSERT INTO identity_audit(kind,actor_id,subject_id,resource_id,created_at) VALUES (?,?,?,?,?)').run(kind, actor, subject, resource, this.now());
    }
    owns(accountId: string, resource = localServerId) {
        return !!this.db.query('SELECT 1 FROM ownership WHERE account_id=? AND resource_id=?').get(accountId, resource);
    }
    private requireOwner(actor: string, resource = localServerId) { if (!this.owns(actor, resource)) throw denied(); }
    private password(value: unknown): asserts value is string {
        if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value) > 1024) throw new IdentityError(400, 'PASSWORD_POLICY', 'A jelszó legalább 12 karakter, legfeljebb 1024 bájt legyen.');
    }
    private username(value: unknown) {
        if (typeof value !== 'string' || value.length < 3 || value.length > 40 || !/^[a-zA-Z0-9]/.test(value) || /[^a-zA-Z0-9._-]/.test(value))
            throw new IdentityError(400, 'USERNAME_POLICY', 'A felhasználónév 3–40 betű, szám, pont, kötőjel vagy aláhúzás lehet.');
        return value.toLowerCase();
    }
    private async boundedHash<T>(work: () => Promise<T>) {
        if (this.hashing >= 2) throw new IdentityError(429, 'AUTH_BUSY', 'A hitelesítés foglalt; próbáld újra később.');
        this.hashing++;
        try { return await work(); } finally { this.hashing--; }
    }
    async createAccount(username: unknown, password: unknown, actor: string | null = null): Promise<Account> {
        const normalized = this.username(username); this.password(password);
        if (actor !== null) this.requireOwner(actor);
        const passwordHash = await this.boundedHash(() => Bun.password.hash(password, hashOptions));
        let created!: Account;
        // Installed Bun SQLite declarations type immediate() as void; capture the committed result explicitly.
        this.db.transaction(() => {
            if (actor === null) {
                if (this.db.query('SELECT 1 FROM accounts LIMIT 1').get()) throw new IdentityError(409, 'ALREADY_INITIALIZED', 'Az első fiók már létezik; új fiókot a tulajdonos hozhat létre.');
            } else this.requireOwner(actor);
            if (this.db.query('SELECT 1 FROM accounts WHERE username=?').get(normalized)) throw new IdentityError(409, 'ACCOUNT_EXISTS', 'Ez a felhasználónév már foglalt.');
            const account = { id: randomUUID(), username: normalized };
            this.db.query('INSERT INTO accounts VALUES (?,?,?)').run(account.id, account.username, passwordHash);
            if (actor === null) this.db.query('INSERT INTO ownership VALUES (?,?)').run(account.id, localServerId);
            this.audit(actor === null ? 'bootstrap-owner' : 'account-created', actor, account.id, actor === null ? localServerId : null);
            created = account;
        }).immediate();
        return created;
    }
    listAccounts(actor: string) {
        this.requireOwner(actor);
        return (this.db.query('SELECT id, username FROM accounts ORDER BY username').all() as Account[])
            .map(account => ({ ...account, ownsLocalServer: this.owns(account.id) }));
    }
    setOwnership(actor: string, subject: string, granted: boolean, resource = localServerId) {
        this.db.transaction(() => {
            this.requireOwner(actor, resource);
            if (!this.db.query('SELECT 1 FROM accounts WHERE id=?').get(subject)) throw new IdentityError(404, 'ACCOUNT_NOT_FOUND', 'A fiók nem található.');
            if (!granted && this.owns(subject, resource)) {
                const count = (this.db.query('SELECT COUNT(*) AS count FROM ownership WHERE resource_id=?').get(resource) as { count: number }).count;
                if (count === 1) throw new IdentityError(409, 'LAST_OWNER', 'Az utolsó tulajdonos jogosultsága nem vonható vissza.');
            }
            if (granted) this.db.query('INSERT OR IGNORE INTO ownership VALUES (?,?)').run(subject, resource);
            else this.db.query('DELETE FROM ownership WHERE account_id=? AND resource_id=?').run(subject, resource);
            this.audit(granted ? 'ownership-granted' : 'ownership-revoked', actor, subject, resource);
        }).immediate();
    }
    async login(username: unknown, password: unknown) {
        if (typeof username !== 'string' || typeof password !== 'string' || username.length > 40 || Buffer.byteLength(password) > 1024) throw invalidLogin();
        this.db.transaction(() => {
            const budget = this.db.query('SELECT started_at, attempts FROM login_budget WHERE id=1').get() as { started_at: number; attempts: number } | null;
            if (!budget || this.now() - budget.started_at >= 60000) this.db.query('INSERT OR REPLACE INTO login_budget VALUES (1,?,1)').run(this.now());
            else {
                if (budget.attempts >= 30) throw new IdentityError(429, 'LOGIN_RATE_LIMIT', 'Túl sok bejelentkezési kísérlet; várj egy percet.');
                this.db.query('UPDATE login_budget SET attempts=attempts+1 WHERE id=1').run();
            }
        }).immediate();
        const account = this.db.query('SELECT * FROM accounts WHERE username=?').get(username.toLowerCase()) as PasswordAccount | null;
        const valid = await this.boundedHash(async () => account ? Bun.password.verify(password, account.password_hash)
            : (await Bun.password.hash(password, hashOptions), false));
        if (!account || !valid) { this.audit('login-failed', null, null); throw invalidLogin(); }
        let issued!: Session & { token: string };
        this.db.transaction(() => {
            const current = this.db.query('SELECT password_hash FROM accounts WHERE id=?').get(account.id) as { password_hash: string } | null;
            if (current?.password_hash !== account.password_hash) throw invalidLogin();
            const token = randomBytes(32).toString('base64url'), expiresAt = this.now() + sessionLifetimeSeconds * 1000;
            this.db.query('DELETE FROM sessions WHERE expires_at<=?').run(this.now());
            this.db.query('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), account.id, expiresAt);
            this.audit('login', account.id, account.id);
            issued = { token, expiresAt, account: { id: account.id, username: account.username } };
        }).immediate();
        return issued;
    }
    session(token: string | null): Session | null {
        if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
        const row = this.db.query('SELECT a.id,a.username,s.expires_at FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?')
            .get(digest(token), this.now()) as (Account & { expires_at: number }) | null;
        return row ? { account: { id: row.id, username: row.username }, expiresAt: row.expires_at } : null;
    }
    logout(token: string) {
        this.db.transaction(() => {
            const session = this.session(token);
            this.db.query('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
            if (session) this.audit('logout', session.account.id, session.account.id);
        }).immediate();
    }
    async changePassword(accountId: string, currentPassword: unknown, nextPassword: unknown) {
        this.password(nextPassword);
        if (typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword) > 1024) throw invalidLogin();
        const account = this.db.query('SELECT * FROM accounts WHERE id=?').get(accountId) as PasswordAccount | null;
        const replacement = await this.boundedHash(async () => {
            if (!account || !await Bun.password.verify(currentPassword, account.password_hash)) throw invalidLogin();
            return Bun.password.hash(nextPassword, hashOptions);
        });
        this.db.transaction(() => {
            const result = this.db.query('UPDATE accounts SET password_hash=? WHERE id=? AND password_hash=?').run(replacement, accountId, account!.password_hash);
            if (result.changes !== 1) throw invalidLogin();
            this.db.query('DELETE FROM sessions WHERE account_id=?').run(accountId);
            this.audit('password-changed', accountId, accountId);
        }).immediate();
    }
}
