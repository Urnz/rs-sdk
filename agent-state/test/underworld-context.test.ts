import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentStateStore } from '../store.js';
import { UnderworldClaimStore, type UnderworldClaimVerifier } from '../underworld-claims.js';
import { projectAttestedObserverUnderworldContext } from '../underworld-context.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const now = '2030-01-01T12:00:00.000Z';
const source = { kind: 'observed-counterparty-action' as const, id: 'observation-1', revision: 1 };
function verifier(): UnderworldClaimVerifier {
    return { verifyClaim: ref => ref.id === source.id ? {
        observerAgentId: 'observer', actorKey: 'Horvik', role: 'possible-fence-counterparty',
        validFrom: '2030-01-01T10:00:00.000Z', validUntil: '2030-01-02T10:00:00.000Z',
        sourceDigest: 'a'.repeat(64) } : null,
    verifyRevocation: () => ({ claimId: 'claim-1', sourceDigest: 'b'.repeat(64),
        occurredAt: '2030-01-01T13:00:00.000Z' }) };
}

test('possible partner requires both an observer-specific attestation and direct contact memory', () => {
    const root = mkdtempSync(join(tmpdir(), 'underworld-context-')); roots.push(root);
    const agents = new AgentStateStore(join(root, 'agents.sqlite'));
    const claims = new UnderworldClaimStore(join(root, 'claims.sqlite'));
    try {
        agents.createIdentity({ agentId: 'observer', playerUsername: 'observer', displayName: 'Observer',
            background: 'Test.', personalityTraits: ['curious'] });
        agents.createIdentity({ agentId: 'outsider', playerUsername: 'outsider', displayName: 'Outsider',
            background: 'Test.', personalityTraits: ['curious'] });
        agents.setRelationship('observer', null, { actorKey: 'Horvik', displayName: 'Horvik',
            tags: ['fence'] });
        claims.attest('event-1', 'claim-1', source, verifier(), now);
        let context = projectAttestedObserverUnderworldContext(agents, claims, verifier(), 'observer', now);
        expect(context.contacts[0]).toMatchObject({ possibleFenceClaimIds: [],
            blockers: ['no-direct-episode-evidence', 'underworld-claim-not-attested'] });
        const episode = agents.createEpisode('observer', { episodeId: 'meeting-1', kind: 'interaction',
            summary: 'A meeting.', source: 'manual', trust: 'trusted', actors: ['Horvik'],
            occurredAt: '2030-01-01T11:00:00.000Z' });
        agents.setRelationship('observer', 1, { actorKey: 'Horvik', displayName: 'Horvik',
            evidenceEpisodeIds: [episode.episodeId] });
        context = projectAttestedObserverUnderworldContext(agents, claims, verifier(), 'observer', now);
        expect(context.contacts[0]).toMatchObject({ possibleFenceClaimIds: ['claim-1'], blockers: [] });
        expect(projectAttestedObserverUnderworldContext(agents, claims, verifier(), 'outsider', now)
            .contacts).toEqual([]);
        claims.revoke('event-2', 'claim-1', { ...source, id: 'revocation-1' }, verifier());
        context = projectAttestedObserverUnderworldContext(agents, claims, verifier(), 'observer',
            '2030-01-01T13:00:00.000Z');
        expect(context.contacts[0]).toMatchObject({ possibleFenceClaimIds: [],
            blockers: ['underworld-claim-not-attested'] });
    } finally { claims.close(); agents.close(); }
});
