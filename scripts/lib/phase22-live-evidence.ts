import type { SkillRunResult } from '../../agent-skills/types.js';
import type { EngineThievingEvidenceRecord } from '../../server/engine/src/mods/ThievingEvidenceStore.js';

/** Correlation only. The caller must verify the authoritative journal before ingestion. */
export function matchLivePickpocket(run: SkillRunResult, candidates: EngineThievingEvidenceRecord[]): EngineThievingEvidenceRecord {
    if (run.status !== 'completed' || !run.username
        || run.skill.id !== 'procedure.thieving.pickpocket' || run.skill.version !== '1.0.0')
        throw new Error('Completed exact-version pickpocket run required');
    const steps = run.events.filter(event => event.type === 'step.succeeded' && event.operation === 'thieve-pickpocket');
    if (steps.length !== 1) throw new Error('One successful pickpocket operation required');
    const data = steps[0]!.data;
    const target = data?.target as { kind?: string; id?: number; index?: number; name?: string } | undefined;
    const deltas = data?.inventoryDelta as Array<{ id: number; delta: number }> | undefined;
    if (data?.outcome !== 'succeeded' || target?.kind !== 'npc' || target.name?.toLowerCase() !== 'man'
        || !Number.isInteger(target.id) || !Number.isInteger(target.index)
        || !Array.isArray(deltas) || deltas.length === 0
        || deltas.some(item => !Number.isInteger(item.id) || !Number.isInteger(item.delta) || item.delta <= 0))
        throw new Error('Exact NPC and positive inventory observation required');
    const items = JSON.stringify(deltas.map(item => [item.id, item.delta]).sort((a, b) => a[0]! - b[0]!));
    const matches = candidates.filter(event => event.playerUsername === run.username
        && event.procedureKind === 'pickpocket' && event.effect === 'item-transfer'
        && event.target.kind === 'npc' && event.target.typeId === target.id
        && event.target.instanceIndex === target.index && event.target.name.toLowerCase() === 'man'
        && event.thievingXpDelta > 0
        && JSON.stringify(event.transferredItems.map(item => [item.itemId, item.quantity])
            .sort((a, b) => a[0]! - b[0]!)) === items);
    if (matches.length !== 1) throw new Error('SDK success has no unique exact matching engine outcome');
    return matches[0]!;
}
