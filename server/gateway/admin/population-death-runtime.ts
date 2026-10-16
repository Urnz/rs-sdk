import { existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { AgentStateStore } from '../../../agent-state/store.js';
import { AGENT_STATE_SCHEMA_VERSION } from '../../../agent-state/types.js';
import type { PopulationAgePolicy } from '../../../population-lifecycle/age.js';
import type { PopulationMortalityPolicy } from '../../../population-lifecycle/mortality.js';
import { PlayerHealthEvidenceStore } from '../../engine/src/mods/PlayerHealthEvidenceStore.js';
import { agentStateDbPath, populationHealthEngineEvidencePath } from './paths.js';

/** Reconciliation is synchronous and replay-safe. Engine closure already precedes this projection. */
export function reconcilePopulationDeaths(agents: AgentStateStore, sourcePath: string,
    age: PopulationAgePolicy, mortality: PopulationMortalityPolicy): number {
    if (!existsSync(sourcePath)) {
        if (agents.listPopulationMembers().length) throw new Error('Population death engine authority is unavailable');
        return 0;
    }
    const source = new PlayerHealthEvidenceStore(sourcePath, true);
    try {
        if (source.schemaVersion < 2 && agents.listPopulationMembers().length) throw new Error('Population death authority upgrade is pending');
        let consumed = 0;
        for (const event of source.listDeaths()) {
            if (!agents.getPopulationDeath(event.agentId)) consumed++;
            agents.consumePopulationDeath(source, event.eventId, age, mortality);
        }
        return consumed;
    } finally { source.close(); }
}

export function assertLocalAvatarCanAct(username: string,
    statePath = agentStateDbPath, sourcePath = populationHealthEngineEvidencePath,
    now = new Date().toISOString()): void {
    let source: PlayerHealthEvidenceStore | null = null, database: Database | null = null;
    try {
        if (existsSync(sourcePath)) {
            source = new PlayerHealthEvidenceStore(sourcePath, true);
            if (source.deathFor(username)) throw new Error('Avatar lifecycle is terminal; physical actions and reconnect are forbidden');
        }
        if (!existsSync(statePath)) {
            if (source?.finiteAvatar(username)) throw new Error('Finite avatar identity source is unavailable');
            return;
        }
        database = new Database(statePath, { readonly: true, strict: true });
        const version = (database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > AGENT_STATE_SCHEMA_VERSION) throw new Error('Avatar identity schema is unsupported');
        if (version >= 21) {
            const closed = database.query(`SELECT lifecycle.status FROM agent_identity identity
                LEFT JOIN agent_control_profile control ON control.agent_id=identity.agent_id
                JOIN agent_character_lifecycle lifecycle ON lifecycle.agent_id=identity.agent_id
                WHERE LOWER(identity.player_username)=?1 OR LOWER(control.avatar_player_username)=?1`)
                .all(username.toLowerCase()) as { status: string }[];
            if (closed.some(item => item.status === 'deceased')) throw new Error('Character lifecycle is closed to physical actions');
        }
        const members = version >= 22 ? database.query(`SELECT member.status,lifecycle.status AS lifecycle_status
            FROM agent_population_member member LEFT JOIN agent_character_lifecycle lifecycle ON lifecycle.agent_id=member.agent_id
            WHERE member.player_username=?1`).all(username.toLowerCase()) as { status: string; lifecycle_status: string | null }[] : [];
        if (!members.length && source?.finiteAvatar(username)) throw new Error('Finite avatar membership source disappeared');
        if (members.length > 1) throw new Error('Avatar population binding is ambiguous');
        for (const member of members) {
            if (member.status !== 'active' || member.lifecycle_status !== 'active') throw new Error('Character lifecycle is closed to physical actions');
            if (!source || source.schemaVersion < 2 || !source.isReady(now)) throw new Error('Finite avatar death authority is unavailable');
        }
    } finally { source?.close(); database?.close(true); }
}
