import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentStateStore } from '../../agent-state/store.js';
import { GovernanceStore } from '../../server/gateway/admin/governance.js';
import { FineAdjudicatorGrantStore, createFineAdjudicatorAuthorityVerifier,
    type FineDecisionRequest, type IssueFineAdjudicatorGrant,
    type RecordedFineProposal } from '../index.js';

const roots: string[] = [];
const t0 = '2030-01-01T09:00:00.000Z', t1 = '2030-01-01T10:00:00.000Z';
const t2 = '2030-01-01T11:00:00.000Z', t3 = '2030-01-01T12:00:00.000Z';
const attestation = 'a'.repeat(64), action = 'b'.repeat(64);
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup() {
    const root = mkdtempSync(join(tmpdir(), 'fine-grants-')); roots.push(root);
    const governance = new GovernanceStore(join(root, 'governance.sqlite'));
    governance.createFaction({ factionId: 'city', kind: 'city', name: 'City' }, t0);
    governance.createJurisdiction({ jurisdictionId: 'city-law', factionId: 'city',
        kind: 'city', name: 'City law' }, t0);
    const agents = new AgentStateStore(join(root, 'agents.sqlite'));
    for (const agentId of ['court-admin', 'city-judge', 'outsider']) {
        agents.createIdentity({ agentId, playerUsername: agentId,
            displayName: agentId, background: 'Local test identity.',
            personalityTraits: ['careful'] }, t0);
    }
    const path = join(root, 'fine-grants.sqlite');
    const grants = new FineAdjudicatorGrantStore(path, governance, agents,
        command => 'issuedByAgentId' in command && command.issuedByAgentId === 'court-admin'
            || 'revokedByAgentId' in command && command.revokedByAgentId === 'court-admin'
            ? attestation : null);
    return { path, governance, agents, grants };
}
function issue(grantId = 'city-grant-1', occurredAt = t1): IssueFineAdjudicatorGrant {
    return { grantId, jurisdictionId: 'city-law', adjudicatorAgentId: 'city-judge',
        issuedByAgentId: 'court-admin', authorityEvidenceDigest: attestation, occurredAt };
}
function close(value: ReturnType<typeof setup>): void {
    value.grants.close(); value.agents.close(); value.governance.close();
}

describe('historical fine-adjudicator grants', () => {
    test('issues and revokes a scoped capability with exact replay and historical lookup', () => {
        const value = setup();
        try {
            const granted = value.grants.issue(issue());
            expect(granted).toMatchObject({ status: 'active', revision: 1 });
            expect(value.grants.issue(issue())).toEqual(granted);
            expect(value.grants.isAuthorizedAt('city-law', 'city-judge', t0)).toBeFalse();
            expect(value.grants.isAuthorizedAt('city-law', 'city-judge', t1)).toBeTrue();
            expect(value.grants.isAuthorizedAt('city-law', 'outsider', t1)).toBeFalse();
            expect(() => value.grants.issue(issue('overlap', t1))).toThrow('overlaps');
            const revoke = { grantId: granted.grantId, revokedByAgentId: 'court-admin',
                authorityEvidenceDigest: attestation, occurredAt: t2 };
            const revoked = value.grants.revoke(revoke, granted.revision);
            expect(revoked).toMatchObject({ status: 'revoked', revision: 2, revokedAt: t2 });
            expect(value.grants.revoke(revoke, granted.revision)).toEqual(revoked);
            expect(value.grants.isAuthorizedAt('city-law', 'city-judge', t1)).toBeTrue();
            expect(value.grants.isAuthorizedAt('city-law', 'city-judge', t2)).toBeFalse();
            expect(() => value.grants.issue(issue('backdated', t1))).toThrow('overlaps');
            value.grants.issue(issue('city-grant-2', t3));
            expect(value.grants.isAuthorizedAt('city-law', 'city-judge', t3)).toBeTrue();
            expect(value.grants.verifyAuditChain()).toBeTrue();
        } finally { close(value); }
    });

    test('requires distinct existing agents, active jurisdiction and separately attested admin action', () => {
        const value = setup();
        try {
            expect(() => value.grants.issue({ ...issue(), issuedByAgentId: 'city-judge' }))
                .toThrow('appoint themselves');
            expect(() => value.grants.issue({ ...issue(), adjudicatorAgentId: 'absent-agent' }))
                .toThrow('identities');
            expect(() => value.grants.issue({ ...issue(), issuedByAgentId: 'outsider' }))
                .toThrow('not trusted');
            value.governance.setFactionStatus('city', 1, 'disabled', 'court-admin',
                'Court disabled', t1);
            expect(() => value.grants.issue(issue())).toThrow('inactive');
        } finally { close(value); }
    });

    test('the decision adapter requires both a historical grant and a separate explicit action', () => {
        const value = setup();
        try {
            value.grants.issue(issue());
            const decision: FineDecisionRequest = { decisionId: 'decision-1', proposalId: 'proposal-1',
                proposalDigest: 'c'.repeat(64), jurisdictionId: 'city-law',
                suspectAgentId: 'suspect', disposition: 'approved',
                adjudicatorAgentId: 'city-judge', decisionEvidenceDigest: action, occurredAt: t1 };
            const proposal = { proposalId: 'proposal-1' } as RecordedFineProposal;
            const verify = createFineAdjudicatorAuthorityVerifier(value.grants, () => action);
            expect(verify(decision, proposal)).toBe(action);
            expect(verify({ ...decision, adjudicatorAgentId: 'outsider' }, proposal)).toBeNull();
            const noAction = createFineAdjudicatorAuthorityVerifier(value.grants, () => null);
            expect(noAction(decision, proposal)).toBeNull();
            value.grants.revoke({ grantId: 'city-grant-1', revokedByAgentId: 'court-admin',
                authorityEvidenceDigest: attestation, occurredAt: t2 }, 1);
            expect(verify({ ...decision, occurredAt: t2 }, proposal)).toBeNull();
            expect(verify(decision, proposal)).toBe(action);
        } finally { close(value); }
    });

    test('detects row tampering, survives reopening and rejects a newer schema', () => {
        const value = setup();
        try {
            value.grants.issue(issue());
            expect(value.grants.verifyAuditChain()).toBeTrue();
            value.grants.close();
            const reopened = new FineAdjudicatorGrantStore(value.path, value.governance,
                value.agents, () => attestation);
            expect(reopened.isAuthorizedAt('city-law', 'city-judge', t1)).toBeTrue();
            const db = new Database(value.path);
            db.run("UPDATE fine_adjudicator_grant SET adjudicator_agent_id='outsider' WHERE grant_id='city-grant-1'");
            db.close();
            expect(reopened.verifyAuditChain()).toBeFalse();
            expect(() => reopened.isAuthorizedAt('city-law', 'city-judge', t1)).toThrow('audit chain');
            reopened.close();
            const newer = new Database(value.path);
            newer.run('PRAGMA user_version = 2');
            newer.close();
            expect(() => new FineAdjudicatorGrantStore(value.path, value.governance,
                value.agents, () => attestation)).toThrow('newer than supported');
        } finally { value.agents.close(); value.governance.close(); }
    });
});
