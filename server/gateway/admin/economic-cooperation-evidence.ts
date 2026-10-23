import type {EconomicContractStore} from './economic-contracts.js';
import type {AdminSkillRun} from './skill-history.js';
import type {SkillRunResult} from '../../../agent-skills/types.js';
import {verifyFoodSkillRunSources} from './native-food-skills.js';
import {repoRoot} from './paths.js';

export interface CooperationNativeEvidence {workspace:string;worldId:string;checkpointPath:string;businessPath:string}
/** Extra native proof only for new autonomous cooperation contracts; legacy evidence contracts are unchanged. */
export function assertCooperationContractRunEvidence(store:EconomicContractStore,contractId:string,actorId:string,run:AdminSkillRun,
    source?:CooperationNativeEvidence):void{
    const c=store.getContract(contractId);if(!c||!store.cooperationOrigin(c.sourceOfferId))return;
    const term=c.partyAAgentId===actorId?c.partyAProvides:c.partyBAgentId===actorId?c.partyBProvides:null;
    if(!term?.service)return;
    const op=term.skill?.id==='procedure.food.gather-lobster'?'food-gather':term.skill?.id==='procedure.food.consume-lobster'?'food-consume':term.skill?.id==='procedure.food.cook-lobster'?'food-cook':null;
    const events=run.events.filter(e=>e.type==='step.succeeded'&&e.operation?.startsWith('food-'));
    const receiptTime=(events[0]?.data?.receipt as {clock?:{wallTime?:string}}|undefined)?.clock?.wallTime;
    const stamp=Date.parse(receiptTime??'');
    if(term.service!=='one-native-invocation'||!op||events.length!==1||events[0]!.operation!==op||!Number.isFinite(stamp)||stamp<Date.parse(c.acceptedAt)||stamp>Date.parse(run.finishedAt)
        ||!verifyFoodSkillRunSources(source?.workspace??repoRoot,run as unknown as SkillRunResult,source))
        throw new Error('Autonomous cooperation service requires its exact canonical native receipt');
}
