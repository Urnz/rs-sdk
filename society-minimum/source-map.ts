import type { SocietyMinimumContract } from './contract.js';
/** Reader capability inventory, not a certificate of source completeness or a measured value. */
const requirements:Record<string,{channels:string[];missing:string}>={
    'founders-at-start':{channels:['applied-genesis','frozen-founder-boundary'],missing:'Exact applied-genesis roster and native bootstrap anchor must be explicitly bound; current active IDs cannot replace them.'},
    'minimum-living-founders':{channels:['population-death','complete-native-boundaries'],missing:'Verified terminal deaths give upper bounds; continuous mortality and complete native boundary coverage are still required for PASS.'},
    'founder-survival':{channels:['frozen-founder-boundary','population-death'],missing:'Verified original-lifecycle deaths bound closing survival from above; an empty death ledger or fresh wall heartbeat does not prove survival.'},
    'hunger-satisfied-time':{channels:['needs-history','player-time','nutrition'],missing:'Replayed per-founder/day time requires original admission, matching policies, complete mode cursors and processed native meals; missing time stays unknown.'},
    'fatigue-satisfied-time':{channels:['needs-history','player-time','sleep-effects'],missing:'Replayed per-founder/day time requires original admission and exact mode/sleep-expiry history; missing time stays unknown.'},
    'hunger-continuous-critical-time':{channels:['needs-history','nutrition'],missing:'Replayed longest critical interval crosses buckets; native meal/watermark gaps cannot become relief or a duration upper bound.'},
    'fatigue-continuous-critical-time':{channels:['needs-history','player-time','sleep-effects'],missing:'Replayed longest critical interval crosses buckets; missing mode/history coverage cannot become a duration upper bound.'},
    'internal-food-relief-share':{channels:['native-integration','nutrition','food-lineage'],missing:'Native actual-relief share is measured per original bucket; complete applications and bound gather/process ancestry are required, zero relief is inconclusive.'},
    'food-reserve-coverage':{channels:['native-asset-boundaries','needs-demand'],missing:'Explicit frozen checkpoint/needs/clock/agent/health/custody snapshots give usable-capacity forecast bounds; all-boundary inventory and access coverage still required.'},
    'food-stock-retention':{channels:['native-asset-boundaries','food-custody'],missing:'Frozen opening/closing relief-capacity bounds per required chain; bank/business/escrow stock is upper-only until access is proved, no WIP double credit.'},
    'legal-housing-access-time':{channels:['housing-access-history','ownership-history','player-time'],missing:'Explicit frozen exact-clock points bound original-founder daily legal access using unchanged title versions, audited capacity and native prepaid rent; missing intervals and visitor rights stay unknown, complete point inventory still required.'},
    'tool-maintenance-cycles':{channels:['native-work'],missing:'Verified repair effects provide a lower count; absent receipts do not prove zero maintenance.'},
    'tool-unusable-demand-time':{channels:['native-tool-demand','cohort-coverage','executor-requests'],missing:'Native intervals provide a lower duration bound; complete high-level demand coverage is still required.'},
    'tool-service-capacity-retention':{channels:['native-tool-boundaries','item-lifecycle'],missing:'Exact comparable opening/closing service capacity, not current durability or number of tools.'},
    'productive-participants':{channels:['native-work'],missing:'Distinct physical producers in each bucket; a receipt subset provides only a lower count.'},
    'productive-stage-kinds':{channels:['native-work'],missing:'Verified food-gathering, food-processing and tool-maintenance; Mining/smelting alone do not replace these stages.'},
    'inter-actor-final-use-chains':{channels:['food-lineage','native-final-use'],missing:'A bound native gather/process/trade/consume chain supplies one daily lower-bound final use; no zero or upper count from missing lineage.'}
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
