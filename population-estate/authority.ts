import { AgentStateStore } from '../agent-state/store.js';
import { PlayerHealthEvidenceStore } from '../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { populationDeathMembershipDigest, type PopulationDeathRecord } from '../population-lifecycle/death.js';
import { healthDigest } from '../population-health/policy.js';
import { existsSync } from 'node:fs';

const verified = new WeakSet<object>();
export function assertVerifiedEstateDeath(value: unknown): asserts value is VerifiedEstateDeath {
    if (!value || typeof value !== 'object' || !verified.has(value)) throw new Error('Unverified estate death');
}
export class VerifiedEstateDeath {
    private constructor(readonly death: Readonly<PopulationDeathRecord>, readonly agentPath: string,
        readonly enginePath: string, readonly estateId: string) { verified.add(this); Object.freeze(this); }
    static load(agentPath: string, enginePath: string, agentId: string): VerifiedEstateDeath {
        if (!existsSync(agentPath) || !existsSync(enginePath)) throw new Error('Estate death authority is unavailable');
        const agents = new AgentStateStore(agentPath); let engine: PlayerHealthEvidenceStore | null = null;
        try {
            engine = new PlayerHealthEvidenceStore(enginePath, true);
            const death = agents.getPopulationDeath(agentId), member = agents.getPopulationMember(agentId);
            if (!death || !member || member.characterLifecycle.status !== 'deceased'
                || member.characterLifecycle.statusChangedAtSimulationTime !== death.atSimulationTime
                || populationDeathMembershipDigest(member) !== death.membershipDigest)
                throw new Error('Estate requires the exact terminal population death');
            const proof = engine.listDeaths().find(event => event.eventId === death.eventId);
            if (!proof || healthDigest(proof) !== healthDigest(death)) throw new Error('Estate death source conflicts');
            const frozen = structuredClone(death);
            const freeze = (value: object) => { Object.freeze(value); for (const child of Object.values(value))
                if (child && typeof child === 'object') freeze(child); };
            freeze(frozen);
            return new VerifiedEstateDeath(frozen, agentPath, enginePath, `estate-${healthDigest({ eventId: death.eventId,
                digest: death.eventDigest }).slice(0, 40)}`);
        } finally { engine?.close(); agents.close(); }
    }
    assert(): void { assertVerifiedEstateDeath(this); }
}
