import type { SocietyMinimumContract } from './contract.js';
/** Reader capability inventory, not a certificate of source completeness or a measured value. */
const requirements:Record<string,{channels:string[];missing:string}>={
    'founders-at-start':{channels:['applied-genesis','frozen-founder-boundary'],missing:'Current population and selected IDs are not the exact opening founders.'},
    'minimum-living-founders':{channels:['population-death','complete-native-boundaries'],missing:'All frozen founders, including offline members, at every native boundary.'},
    'founder-survival':{channels:['frozen-founder-boundary','population-death'],missing:'Exact closing survivors of the original founder lifecycles.'},
    'hunger-satisfied-time':{channels:['needs-history','player-time','nutrition'],missing:'Exact per-founder/per-bucket satisfied person-time and complete physiological mutations.'},
    'fatigue-satisfied-time':{channels:['needs-history','player-time','sleep-effects'],missing:'Exact per-founder/per-bucket satisfied person-time, including sleep and offline transitions.'},
    'hunger-continuous-critical-time':{channels:['needs-history','nutrition'],missing:'Longest continuous critical interval over the entire evaluation, including bucket crossings.'},
    'fatigue-continuous-critical-time':{channels:['needs-history','player-time','sleep-effects'],missing:'Longest continuous critical interval; discontinuities cannot be interpolated.'},
    'internal-food-relief-share':{channels:['native-integration','nutrition','food-lineage'],missing:'All relief and verified internal lineage in each original bucket, not a whole-window average.'},
    'food-reserve-coverage':{channels:['native-asset-boundaries','needs-demand'],missing:'Usable food reserve against measured physiological demand at every native boundary.'},
    'food-stock-retention':{channels:['native-asset-boundaries','food-custody'],missing:'Comparable opening/closing usable stock with complete custody; WIP mirrors are not additional stock.'},
    'legal-housing-access-time':{channels:['housing-access-history','ownership-history','player-time'],missing:'Legal minimum-tier access per founder/bucket; rent or sleep receipts alone do not prove it.'},
    'tool-maintenance-cycles':{channels:['native-work'],missing:'Verified repair effects provide a lower count; absent receipts do not prove zero maintenance.'},
    'tool-unusable-demand-time':{channels:['native-tool-demand','cohort-coverage','executor-requests'],missing:'Native intervals provide a lower duration bound; complete high-level demand coverage is still required.'},
    'tool-service-capacity-retention':{channels:['native-tool-boundaries','item-lifecycle'],missing:'Exact comparable opening/closing service capacity, not current durability or number of tools.'},
    'productive-participants':{channels:['native-work'],missing:'Distinct physical producers in each bucket; a receipt subset provides only a lower count.'},
    'productive-stage-kinds':{channels:['native-work'],missing:'Verified food-gathering, food-processing and tool-maintenance; Mining/smelting alone do not replace these stages.'},
    'inter-actor-final-use-chains':{channels:['food-lineage','native-final-use'],missing:'Producer-to-distinct-consumer final-use lineage in every bucket, not transfers or trades.'}
};
const gates:Record<string,string>={
    'applied-genesis-baseline':'Applied result, exact native opening state and genesis identity.',
    'complete-source-coverage':'Every required denominator, source head, native boundary and complete request history.',
    'unchanged-clock-and-world-policy':'Pinned world build/mod/config/clock history over warmup and evaluation.',
    'finite-lifecycle-no-respawn':'Bound finite lifecycles and complete death/respawn enforcement history.',
    'no-post-genesis-admin-or-fallback-value':'Complete administrative/value mutation history after genesis, including warmup.',
    'no-external-shop-or-import-value':'Complete source history for imports, external shop value and fallback replenishment.',
    'frozen-founder-roster':'The original applied founders, without silently replacing missing or dead members.',
    'verified-internal-lineage-and-final-use':'Verified internal production ancestry through distinct-consumer final use.'
};
export function minimumSourceMap(contract:SocietyMinimumContract){
    if(Object.keys(requirements).length!==contract.requirements.length||contract.requirements.some(r=>!requirements[r.requirementId])
        ||Object.keys(gates).length!==contract.policy.integrityGates.length||contract.policy.integrityGates.some(g=>!gates[g]))throw Error('Minimum source map differs from contract');
    return{requirements:contract.requirements.map(r=>({...r,...requirements[r.requirementId]!})),
        integrity:contract.policy.integrityGates.map(gateId=>({gateId,missing:gates[gateId]!}))};
}
