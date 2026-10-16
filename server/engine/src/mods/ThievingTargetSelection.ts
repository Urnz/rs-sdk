import type { EngineThievingKind } from './ThievingEvidenceStore.js';

/** RuneScript may retain both pointers. The procedure, not pointer ordering,
 * determines which entity actually owns the observed effect. */
export function selectThievingTarget<N, L>(procedureKind: EngineThievingKind,
    npc: N | null | undefined, loc: L | null | undefined): {kind:'npc';entity:N} | {kind:'loc';entity:L} {
    if (procedureKind === 'pickpocket') {
        if (!npc) throw new Error('Pickpocket evidence requires an active npc target');
        return {kind:'npc',entity:npc};
    }
    if (!['lockpick-door','container-theft','property-burglary'].includes(procedureKind))
        throw new Error('Unsupported Thieving target procedure');
    if (!loc) throw new Error('Location Thieving evidence requires an active loc target');
    return {kind:'loc',entity:loc};
}
