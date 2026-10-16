import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { LegalFinding } from './evidence-types.js';
import { JusticeAdjudicatorGrantStore, type JusticeCapability } from './justice-adjudicator-grants.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
const USERNAME = /^[a-z0-9]{1,12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ZERO = '0'.repeat(64);

export interface JusticeRestitution {
    gp: number;
    items: Array<{ id: number; count: number }>;
}

export interface JusticeDecisionRequest {
    decisionId: string;
    findingId: string;
    findingDigest: string;
    jurisdictionId: string;
    suspectAgentId: string;
    subjectUsername: string;
    beneficiaryUsername: string | null;
    disposition: 'approved' | 'rejected';
    custodySeconds: number;
    custodyLocation: { x: number; z: number; level: number };
    restitution: JusticeRestitution;
    policyId: string;
    policyDigest: string;
    adjudicatorAgentId: string;
    authorityEvidenceDigest: string;
    occurredAt: string;
}

export interface RecordedJusticeDecision extends JusticeDecisionRequest {
    decisionDigest: string;
    recordedAt: string;
}

export interface JusticeFindingSource {
    verifyAuditChain(): boolean;
    getFinding(findingId: string): LegalFinding | null;
}

/** Must verify effective policy, adjudicator grant, explicit human/NPC action, and avatar bindings. */
export type JusticeDecisionVerifier = (request: Readonly<JusticeDecisionRequest>,
    finding: Readonly<LegalFinding>) => string | null;

type Row = { decision_id: string; finding_id: string; finding_digest: string; jurisdiction_id: string;
    suspect_agent_id: string; subject_username: string; beneficiary_username: string | null;
    disposition: JusticeDecisionRequest['disposition']; custody_seconds: number; custody_location_json: string;
    restitution_json: string; policy_id: string; policy_digest: string; adjudicator_agent_id: string;
    authority_evidence_digest: string; occurred_at: string; decision_digest: string; recorded_at: string };
type AuditRow = { sequence: number; decision_id: string; decision_digest: string; recorded_at: string;
    previous_hash: string; entry_hash: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function iso(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
function decision(row: Row): RecordedJusticeDecision {
    return { decisionId: row.decision_id, findingId: row.finding_id, findingDigest: row.finding_digest,
        jurisdictionId: row.jurisdiction_id, suspectAgentId: row.suspect_agent_id,
        subjectUsername: row.subject_username, beneficiaryUsername: row.beneficiary_username,
        disposition: row.disposition, custodySeconds: row.custody_seconds,
        custodyLocation: JSON.parse(row.custody_location_json) as JusticeDecisionRequest['custodyLocation'],
        restitution: JSON.parse(row.restitution_json) as JusticeRestitution, policyId: row.policy_id,
        policyDigest: row.policy_digest, adjudicatorAgentId: row.adjudicator_agent_id,
        authorityEvidenceDigest: row.authority_evidence_digest, occurredAt: row.occurred_at,
        decisionDigest: row.decision_digest, recordedAt: row.recorded_at };
}
function facts(value: RecordedJusticeDecision): JusticeDecisionRequest {
    const { decisionDigest: _digest, recordedAt: _recorded, ...input } = value;
    void _digest; void _recorded; return input;
}

/** Append-only adjudication. It records authority but performs no custody or asset mutation. */
export class JusticeDecisionStore {
    private readonly database: Database;
    constructor(path: string, private readonly findings: JusticeFindingSource,
        private readonly grants: JusticeAdjudicatorGrantStore,
        private readonly verifyDecision: JusticeDecisionVerifier) {
        if (!(grants instanceof JusticeAdjudicatorGrantStore))
            throw new Error('Justice decisions require an audited adjudicator grant catalog');
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys=ON'); this.migrate();
    }
    close(): void { this.database.close(true); }

    get(decisionId: string): RecordedJusticeDecision | null {
        if (!ID.test(decisionId)) throw new Error('justice decision id is invalid');
        if (!this.verifyAuditChain()) throw new Error('Justice decision audit chain is invalid');
        const row = this.database.query('SELECT * FROM justice_decision WHERE decision_id=?1').get(decisionId) as Row | null;
        return row ? decision(row) : null;
    }

    record(input: JusticeDecisionRequest, recordedAt = new Date().toISOString()): RecordedJusticeDecision {
        this.assertShape(input, recordedAt);
        if (!this.findings.verifyAuditChain() || !this.verifyAuditChain())
            throw new Error('Justice decision source audit chain is invalid');
        const finding = this.findings.getFinding(input.findingId);
        if (!finding || finding.findingDigest !== input.findingDigest
            || finding.jurisdictionId !== input.jurisdictionId || finding.suspectAgentId !== input.suspectAgentId
            || input.occurredAt < finding.recordedAt)
            throw new Error('Justice decision is not bound to its legal finding');
        if (input.disposition === 'approved' && finding.conclusion !== 'responsible')
            throw new Error('Justice remedy requires a responsible legal finding');
        const required: JusticeCapability[] = ['adjudication'];
        if (input.custodySeconds > 0) required.push('custody');
        if (input.restitution.gp > 0 || input.restitution.items.length > 0) required.push('restitution');
        if (!this.grants.isAuthorizedAt(input.jurisdictionId,input.adjudicatorAgentId,required,input.occurredAt))
            throw new Error('Justice adjudicator lacks the required historical grant');
        const attested = this.verifyDecision(Object.freeze(structuredClone(input)), Object.freeze({ ...finding }));
        if (attested !== input.authorityEvidenceDigest)
            throw new Error('Justice decision policy or adjudicator authority is not trusted');
        const decisionDigest = hash(input), existing = this.get(input.decisionId);
        if (existing) {
            if (existing.decisionDigest !== decisionDigest) throw new Error('Justice decision id was reused');
            return existing;
        }
        this.database.transaction(() => {
            this.database.run(`INSERT INTO justice_decision VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,
                ?11,?12,?13,?14,?15,?16,?17,?18)`, [input.decisionId,input.findingId,input.findingDigest,
                input.jurisdictionId,input.suspectAgentId,input.subjectUsername.toLowerCase(),
                input.beneficiaryUsername?.toLowerCase() ?? null,input.disposition,input.custodySeconds,
                JSON.stringify(input.custodyLocation),JSON.stringify(input.restitution),input.policyId,input.policyDigest,
                input.adjudicatorAgentId,input.authorityEvidenceDigest,input.occurredAt,decisionDigest,recordedAt]);
            const previous = (this.database.query('SELECT entry_hash FROM justice_decision_audit ORDER BY sequence DESC LIMIT 1')
                .get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
            const payload = { decisionId: input.decisionId, decisionDigest, recordedAt };
            this.database.run(`INSERT INTO justice_decision_audit(decision_id,decision_digest,recorded_at,
                previous_hash,entry_hash) VALUES(?1,?2,?3,?4,?5)`,
            [input.decisionId,decisionDigest,recordedAt,previous,hash({ previousHash: previous, payload })]);
        }).immediate();
        return this.get(input.decisionId)!;
    }

    verifyAuditChain(): boolean {
        try {
            const rows = this.database.query('SELECT * FROM justice_decision ORDER BY rowid').all() as Row[];
            const audits = this.database.query('SELECT * FROM justice_decision_audit ORDER BY sequence').all() as AuditRow[];
            if (rows.length !== audits.length) return false;
            const byId = new Map(rows.map(row => [row.decision_id, row])); let previous = ZERO;
            for (const audit of audits) {
                const row = byId.get(audit.decision_id); if (!row) return false;
                const value = decision(row), input = facts(value);
                this.assertShape(input, value.recordedAt);
                if (value.decisionDigest !== hash(input) || audit.decision_digest !== value.decisionDigest
                    || audit.recorded_at !== value.recordedAt) return false;
                const payload = { decisionId: value.decisionId, decisionDigest: value.decisionDigest,
                    recordedAt: value.recordedAt };
                if (audit.previous_hash !== previous
                    || audit.entry_hash !== hash({ previousHash: previous, payload })) return false;
                previous = audit.entry_hash;
            }
            return true;
        } catch { return false; }
    }

    private assertShape(input: JusticeDecisionRequest, recordedAt: string): void {
        if (!input || Object.keys(input).sort().join(',') !== ['decisionId','findingId','findingDigest',
            'jurisdictionId','suspectAgentId','subjectUsername','beneficiaryUsername','disposition','custodySeconds',
            'custodyLocation','restitution','policyId','policyDigest','adjudicatorAgentId','authorityEvidenceDigest',
            'occurredAt'].sort().join(',')) throw new Error('Justice decision fields are invalid');
        const location = input.custodyLocation, restitution = input.restitution;
        const validItems = restitution && Array.isArray(restitution.items) && restitution.items.length <= 28
            && restitution.items.every(item => item && Object.keys(item).sort().join(',') === 'count,id'
                && Number.isSafeInteger(item.id) && item.id >= 0 && item.id <= 65535
                && Number.isSafeInteger(item.count) && item.count > 0 && item.count <= 2_147_483_647);
        if (![input.decisionId,input.findingId,input.jurisdictionId,input.suspectAgentId,input.policyId,
            input.adjudicatorAgentId].every(value => typeof value === 'string' && ID.test(value))
            || !DIGEST.test(input.findingDigest) || !DIGEST.test(input.policyDigest)
            || !DIGEST.test(input.authorityEvidenceDigest) || !USERNAME.test(input.subjectUsername)
            || (input.beneficiaryUsername !== null && !USERNAME.test(input.beneficiaryUsername))
            || !['approved','rejected'].includes(input.disposition) || !Number.isSafeInteger(input.custodySeconds)
            || input.custodySeconds < 0 || input.custodySeconds > 86_400 || !location
            || Object.keys(location).sort().join(',') !== 'level,x,z' || !Number.isSafeInteger(location.x)
            || location.x < 0 || location.x > 16383 || !Number.isSafeInteger(location.z)
            || location.z < 0 || location.z > 16383 || !Number.isSafeInteger(location.level)
            || location.level < 0 || location.level > 3 || !restitution
            || Object.keys(restitution).sort().join(',') !== 'gp,items' || !Number.isSafeInteger(restitution.gp)
            || restitution.gp < 0 || restitution.gp > 1_000_000_000 || !validItems
            || !iso(input.occurredAt) || !iso(recordedAt) || recordedAt < input.occurredAt)
            throw new Error('Justice decision schema or time is invalid');
        const remedy = input.custodySeconds > 0 || restitution.gp > 0 || restitution.items.length > 0;
        if ((input.disposition === 'approved' && !remedy)
            || (input.disposition === 'rejected' && remedy)
            || ((restitution.gp > 0 || restitution.items.length > 0) && input.beneficiaryUsername === null))
            throw new Error('Justice decision disposition and remedy are inconsistent');
    }

    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 1) throw new Error(`Justice decision schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        this.database.transaction(() => {
            this.database.run(`CREATE TABLE justice_decision(decision_id TEXT PRIMARY KEY,finding_id TEXT NOT NULL UNIQUE,
                finding_digest TEXT NOT NULL,jurisdiction_id TEXT NOT NULL,suspect_agent_id TEXT NOT NULL,
                subject_username TEXT NOT NULL,beneficiary_username TEXT,disposition TEXT NOT NULL,
                custody_seconds INTEGER NOT NULL,custody_location_json TEXT NOT NULL,restitution_json TEXT NOT NULL,
                policy_id TEXT NOT NULL,policy_digest TEXT NOT NULL,adjudicator_agent_id TEXT NOT NULL,
                authority_evidence_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,decision_digest TEXT NOT NULL UNIQUE,
                recorded_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE justice_decision_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                decision_id TEXT NOT NULL UNIQUE REFERENCES justice_decision(decision_id),decision_digest TEXT NOT NULL,
                recorded_at TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version=1');
        }).immediate();
    }
}
