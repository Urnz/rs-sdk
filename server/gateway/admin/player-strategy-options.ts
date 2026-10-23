import type { AgentGoal, AgentPlayerActionRequest, AgentSnapshot, AgentControlProfile } from '../../../agent-state/types.js';
import { stateDigest } from '../../../agent-state/state-objectives.js';
import { canonicalSkillParameters } from '../../../agent-state/skill-binding.js';
import { PLAYER_STRATEGY_POLICY, type StrategyOption, type PlayerStrategyRequest } from '../../../agent-state/player-strategy.js';
import type { SkillArguments, SkillDefinition, SkillStep, SkillValue } from '../../../agent-skills/types.js';
import type { BotWorldState } from '../../../sdk/types.js';
import type { LlmAutonomousExecutionConfig } from '../../../llm-runtime/types.js';
import { evaluateAutonomousSkillPolicy } from './autonomous-skill-policy.js';
import { evaluateAuthorizationEnvelope } from './authorization-envelope.js';
import { bindAutonomousSkillParameters, type AutonomousSkillParameterCandidate } from './autonomous-skill-binding.js';
import type {EconomicContract} from './economic-contracts.js';

export interface PlayerStrategySources {
    contracts?:readonly EconomicContract[];
    snapshot: AgentSnapshot;
    profile: AgentControlProfile;
    parent: AgentGoal;
    world: BotWorldState;
    observedAt: string;
    now: string;
    definitions: SkillDefinition[];
    config: LlmAutonomousExecutionConfig;
    incoming: AgentPlayerActionRequest[];
    spentGp: number;
    sourceAreas?: { sourceId: string; minX: number; maxX: number; minZ: number; maxZ: number; level: number }[];
    excludedSkills?: string[];
}
function operations(steps: SkillStep[], multiplier = 1): { operation: string; args: SkillArguments; multiplier: number }[] {
    return steps.flatMap(s => s.kind === 'operation' ? [{ operation: s.operation, args: s.arguments, multiplier }]
        : s.kind === 'repeat' ? operations(s.steps, multiplier * s.maxIterations) : [{ operation: 'unsupported-call', args: {}, multiplier }]);
}
function resolve(value: SkillValue | undefined, parameters: Record<string, string | number | boolean>): unknown {
    return value && typeof value === 'object' && !Array.isArray(value) && 'parameter' in value
        ? parameters[String(value.parameter)] : value;
}
const text = (v: unknown) => typeof v === 'string' ? v.toLowerCase().trim() : '';

/** Conservative preflight against the observer's own live view. A feasible attempt is not an outcome receipt. */
export function buildPlayerStrategyOptions(input: PlayerStrategySources): Pick<PlayerStrategyRequest, 'options' | 'unavailable'> {
    const { snapshot, world, config } = input, options: StrategyOption[] = [], unavailable: PlayerStrategyRequest['unavailable'] = [];
    const age = Date.parse(input.now) - Date.parse(input.observedAt);
    if (snapshot.identity.playerUsername !== input.profile.avatarPlayerUsername
        || world.player?.name?.toLowerCase() !== input.profile.avatarPlayerUsername || world.player.isDead
        || snapshot.characterLifecycle?.status === 'deceased' || !Number.isFinite(age) || age < 0 || age > 5000)
        return { options, unavailable: [{ skill: 'player-context', kind: 'context', reason: 'Fresh living exact-avatar observation required' }] };
    const inventory = world.inventory, cash = inventory.filter(i => i.id === 995).reduce((sum,i) => sum + i.count, 0);
    const ownCount = (name: unknown) => inventory.filter(i => text(i.name) === text(name)).reduce((sum,i) => sum + i.count, 0);
    const known = snapshot.knownSkills.filter(k => k.status !== 'blocked');
    const catalog = new Set(input.definitions.map(d => `${d.id}@${d.version}`));
    const missing = new Set(snapshot.goals.filter(g => g.parentGoalId === input.parent.goalId && g.skill)
        .map(g => `${g.skill!.id}@${g.skill!.version}`));
    for (const ref of missing) if (!catalog.has(ref)) unavailable.push({ skill: ref, kind: 'procedure', reason: 'Assigned exact skill is unavailable in the visible reviewed catalog' });
    for (const d of input.definitions.slice(0,100).sort((a,b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version))) {
        const ref = `${d.id}@${d.version}`;
        if (!known.some(k => k.skill.id === d.id && k.skill.version === d.version)) continue;
        const sources: AutonomousSkillParameterCandidate[] = input.incoming.filter(r => r.assigneeAgentId === snapshot.identity.agentId
            && r.status === 'approved' && !!r.approvalId && !!r.approvalExpiresAt && r.approvalExpiresAt > input.now
            && r.skill.id === d.id && r.skill.version === d.version).map(r => ({ sourceKind: 'work-order',
                sourceId: r.requestId, skill: r.skill, parameters: r.parameters }));
        for(const c of input.contracts??[]){
            if(c.status!=='active')continue;
            const own=c.partyAAgentId===snapshot.identity.agentId?'a':c.partyBAgentId===snapshot.identity.agentId?'b':null;
            if(!own||own==='a'&&c.partyASatisfied||own==='b'&&c.partyBSatisfied)continue;
            const term=own==='a'?c.partyAProvides:c.partyBProvides;
            if(term.service&&term.skill?.id===d.id&&term.skill.version===d.version)
                sources.push({sourceKind:'contract-obligation',sourceId:c.contractId,skill:term.skill,parameters:{}});
        }
        if (!sources.length) sources.push({ sourceKind: 'approved-policy', sourceId: PLAYER_STRATEGY_POLICY.version,
            skill: d, parameters: d.steps.some(s => s.kind === 'operation' && s.operation === 'food-consume')
                ? { slot: inventory.find(i => i.id === 379)?.slot } : {} });
        for (const source of sources) {
            let kind: PlayerStrategyRequest['unavailable'][number]['kind'] = 'input';
            try {
                if (input.excludedSkills?.includes(ref)) throw new Error('Previous native attempt failed; source recovery or a different skill is required');
                const policy = evaluateAutonomousSkillPolicy(config, d);
                if (!policy.allowed) { kind = 'policy'; throw new Error(policy.reason); }
                const binding = bindAutonomousSkillParameters(d,[source]), params = binding.parameters;
                const envelope = evaluateAuthorizationEnvelope(policy.authorization!,d,params);
                if (!envelope.allowed) { kind = 'policy'; throw new Error(envelope.reason); }
                if (envelope.reservedGp + input.spentGp > input.profile.dailyOperationalBudgetGp
                    || envelope.reservedGp + input.spentGp > (policy.authorization!.maxGpPerDay ?? 0)
                    || envelope.reservedGp > cash) { kind = 'budget'; throw new Error('Worst-case spend exceeds owned cash or remaining daily allowance'); }
                const requirements: string[] = [];
                for (const pre of d.preconditions) {
                    const arg = (key: string) => resolve(pre.arguments[key], params);
                    let valid = false;
                    if (pre.condition === 'inventory-full') valid = inventory.length >= 28;
                    if (pre.condition === 'inventory-free-slots-at-least') valid = 28 - inventory.length >= Number(arg('slots'));
                    if (pre.condition === 'inventory-free-slots-at-most') valid = 28 - inventory.length <= Number(arg('slots'));
                    if (pre.condition === 'inventory-contains') valid = arg('match') === 'exact' && ownCount(arg('name')) >= Number(arg('amount') ?? 1);
                    if (pre.condition === 'skill-level-at-least') valid = world.skills.some(s => text(s.name) === text(arg('skill')) && s.baseLevel >= Number(arg('level')));
                    if (!valid) throw new Error(`Unmet native precondition: ${pre.condition}`);
                    requirements.push(pre.condition);
                }
                let purpose: StrategyOption['purpose'] | null = ['work-order','contract-obligation'].includes(source.sourceKind) ? 'earn-income' : null;
                const evidence = [`own-live:${input.observedAt}`, `reviewed:${ref}`, `grant:${stateDigest(policy.authorization)}`];
                for (const step of operations(d.steps)) {
                    const arg = (key: string) => resolve(step.args[key], params), op = step.operation;
                    const quantity = Number(arg('amount') ?? 1) * step.multiplier;
                    if (op === 'buy-from-shop' || op === 'sell-to-shop') {
                        const item = world.shop.shopItems.find(i => text(i.name) === text(arg('name')));
                        if (!world.shop.isOpen || arg('match') !== 'exact' || !item || !Number.isSafeInteger(quantity) || quantity < 1)
                            throw new Error('Exact currently observed shop item/quantity is required');
                        if (op === 'buy-from-shop' && (item.count < quantity || !Number.isFinite(item.buyPrice) || item.buyPrice < 0
                            || item.buyPrice > (policy.authorization!.maxUnitPriceGp ?? 0))) throw new Error('Observed stock/price is outside the purchase plan');
                        if (op === 'sell-to-shop' && ownCount(arg('name')) < quantity) throw new Error('Sale input is missing');
                        evidence.push(`shop-item:${item.id}:stock:${item.count}:buy:${item.buyPrice}:sell:${item.sellPrice}`);
                        purpose ??= op === 'buy-from-shop' ? 'acquire-input' : 'earn-income';
                    } else if (op === 'food-gather') {
                        const area = input.sourceAreas?.find(a => a.sourceId === arg('sourceId'));
                        if (!area || world.player.worldX < area.minX || world.player.worldX > area.maxX
                            || world.player.worldZ < area.minZ || world.player.worldZ > area.maxZ || world.player.level !== area.level
                            || ownCount('Lobster pot') < 1 || !world.nearbyNpcs.some(n => n.reachable !== false
                                && n.optionsWithIndex.some(o => text(o.text) === 'cage')))
                            throw new Error('Known native source, reachable cage spot and owned tool are required');
                        purpose ??= 'produce'; evidence.push(`native-source:${area.sourceId}`);
                    } else if (op === 'gather-loc' || op === 'gather-npc') {
                        const targets = op === 'gather-loc' ? world.nearbyLocs : world.nearbyNpcs;
                        if (arg('match') !== 'exact' || !targets.some(t => text(t.name) === text(arg('name')) && t.reachable !== false))
                            throw new Error('Exact reachable gathering target is not observed');
                        purpose ??= 'produce';
                    } else if (op === 'food-consume') {
                        const item = inventory.find(i => i.slot === arg('slot') && i.id === 379);
                        if (!item || !input.parent.objective?.predicates.some(p => p.kind === 'hunger-at-most'))
                            throw new Error('Own cooked food and an approved hunger objective are required');
                        purpose ??= 'self-care';
                    } else if (op === 'food-cook') {
                        kind = 'context'; throw new Error('Native kitchen custody must be prepared before this production plan can execute');
                    } else if (!['walk-to','wait-for-area','wait-ticks','open-shop','close-shop'].includes(op)) {
                        kind = 'context'; throw new Error(`No conservative strategy preflight for ${op}`);
                    }
                }
                if (!purpose) continue;
                const parameters = canonicalSkillParameters(binding.parameters), request = input.incoming.find(r => r.requestId === source.sourceId);
                const contract=source.sourceKind==='contract-obligation'?input.contracts?.find(c=>c.contractId===source.sourceId):null;
                const quotedReward=contract?(contract.partyAAgentId===snapshot.identity.agentId?contract.partyBProvides.gp:contract.partyAProvides.gp):null;
                options.push({ optionId: `option.${stateDigest({ skill: {id:d.id,version:d.version}, binding }).slice(0,32)}`,
                    skill: { id:d.id,version:d.version }, parameters, binding, purpose, costGp: envelope.reservedGp,
                    rewardGp: request?.rewardGp ?? quotedReward, risk: policy.authorization!.risk ?? 'routine',
                    requirements: requirements.slice(0,5), evidence: evidence.slice(0,5) });
            } catch (error) { unavailable.push({ skill: ref,kind,reason: String(error instanceof Error ? error.message : error).slice(0,200) }); }
        }
    }
    return { options: options.slice(0,PLAYER_STRATEGY_POLICY.maximumOptions), unavailable: unavailable.slice(0,24) };
}
