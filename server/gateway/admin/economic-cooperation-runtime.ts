import { createHash } from 'node:crypto';
import { join,dirname } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { EconomicActionRun } from '../../../agent-state/economic-action.js';
import { stateDigest } from '../../../agent-state/state-objectives.js';
import { listAgentDomainTools } from '../../../agent-state/control.js';
import type { LlmPlanningInput,LlmPlanResult,EconomicActionAlternative } from '../../../llm-runtime/types.js';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import type { BotWorldState } from '../../../sdk/types.js';
import { EconomicContractStore,type CreateEconomicOffer,type EconomicOffer,type EconomicObligation } from './economic-contracts.js';
import { acceptFundedEconomicOffer,type EconomicContractSettlementOptions } from './economic-contract-settlement.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';
import { institutionTreasuryPathFor } from './treasury-paths.js';
import { loadCooperationPolicy,type CooperationGrant } from './economic-cooperation-policy.js';
import { agentStateDbPath,economicContractsDbPath,repoRoot } from './paths.js';
import type { ReplanOutcome } from './replan-coordinator.js';
import {validateBusinessCooperationForAgent} from './business-agent-port.js';

interface CooperationChoice extends EconomicActionAlternative {
    offerId:string;expectedRevision:number|null;offer:CreateEconomicOffer;
    ownBinding:string;partnerBinding:string;
}
export interface CooperationRuntimeOptions {
    agentPath:string;policyPath?:string;contractsPath?:string;requiredLeaseOwner?:string;maxLlmCostMicros:number;
    settlement?:EconomicContractSettlementOptions;
    playerState?(agentId:string):{world:BotWorldState;observedAt:string}|null;
    plan(input:LlmPlanningInput):Promise<LlmPlanResult>;
}
const uuid=(value:string)=>{const b=Buffer.from(createHash('sha256').update(value).digest().subarray(0,16));b[6]=(b[6]!&15)|80;b[8]=(b[8]!&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
export const cooperationContractsPath=(agentPath:string)=>agentPath===agentStateDbPath?economicContractsDbPath:join(dirname(agentPath),'economic-contracts.sqlite');
export function cooperationActorBinding(store:AgentStateStore,agentId:string):string {
    const p=store.getControlProfile(agentId),i=store.getIdentity(agentId);if(!p||!i)throw new Error('Unknown economic party');store.assertCharacterCanAct(agentId);
    if(p.role==='player'&&(!p.avatarPlayerUsername||p.avatarPlayerUsername!==i.playerUsername))throw new Error('Exact economic player binding required');
    if(p.role!=='player'&&(p.role!=='institution'||p.subjectKind!=='business'||p.avatarPlayerUsername))throw new Error('Unsupported economic role');
    return stateDigest([i.agentId,i.createdAt,p.role,p.subjectKind,p.subjectId,p.avatarPlayerUsername]);
}
const sameTerm=(a:EconomicObligation,b:EconomicObligation)=>stateDigest({...a,skill:a.skill??null})===stateDigest({...b,skill:b.skill??null});
/** Runs only through the existing leased replan coordinator. No model-supplied terms, consent or physical commands. */
export async function runEconomicCooperation(agentId:string,event:LlmReplanEvent,options:CooperationRuntimeOptions):Promise<ReplanOutcome|null>{
    const use=<T>(fn:(s:AgentStateStore)=>T)=>{const s=new AgentStateStore(options.agentPath);try{return fn(s);}finally{s.close();}};
    const path=options.contractsPath??cooperationContractsPath(options.agentPath);
    const contracts=<T>(fn:(s:EconomicContractStore)=>T)=>{const s=new EconomicContractStore(path);try{return fn(s);}finally{s.close();}};
    let run=use(s=>s.getEconomicAction(event.eventId));
    const pending=use(s=>s.pendingEconomicAction(agentId));
    if(!run&&pending){event={...event,eventId:pending.request.eventId,sourceKey:pending.request.sourceKey};run=pending;}
    const out=(status:string,reason:string,result?:unknown):ReplanOutcome=>({runId:event.eventId,status,reason,decision:{kind:'economic-cooperation',result:result??(run?.result?JSON.parse(run.result):null)}});
    try{
        if(event.agentId!==agentId||run&&(run.request.agentId!==agentId||run.request.sourceKey!==event.sourceKey))throw new Error('Economic action event collision');
        if(run?.status==='applied')return out('completed',run.reason);
        if(run?.status==='waiting')return out('waiting',run.reason);
        if(run?.status==='inferring')return out('bounded-wait','Economic inference is uncertain; reconciliation required.');
        const readGrant=()=>loadCooperationPolicy(options.policyPath??join(repoRoot,'config/economic-cooperation.json')).grants.find(g=>g.agentId===agentId);
        let grant=readGrant();if(!grant){if(run)throw new Error('Economic cooperation grant revoked');return null;}
        const profile=use(s=>s.getControlProfile(agentId)), enrollment=use(s=>s.getAutonomyEnrollment(agentId));
        if(!profile||profile.role!==grant.role||profile.subjectKind!==grant.subjectKind||profile.subjectId!==grant.subjectId
            ||enrollment?.policyId!==grant.policyId||enrollment.policyVersion!==grant.policyVersion)throw new Error('Economic grant subject/enrollment mismatch');
        const binding=use(s=>cooperationActorBinding(s,agentId)),grantDigest=stateDigest(grant);
        const observedAt=run?.request.observedAt??new Date().toISOString();
        const ownRelations=()=>use(s=>{const identities=s.listIdentities();return s.listRelationships(agentId).flatMap(relationship=>{
            const key=relationship.actorKey, matches=key.startsWith('agent.')?identities.filter(i=>i.agentId===key.slice(6))
                :identities.filter(i=>i.agentId===key||i.playerUsername===key);
            return matches.length===1?[{relationship,partnerAgentId:matches[0]!.agentId}]:[];
        });});
        const ownTermAllowed=(term:EconomicObligation,peerId:string,recovery=false)=>{
            if(term.gp>grant!.maxGpPerAction||term.gp>grant!.maxGpPerDay||term.gp>profile.dailyOperationalBudgetGp
                ||term.items.reduce((n,i)=>n+i.count,0)>grant!.maxItemUnits)throw new Error('Economic terms exceed grant risk/budget');
            if(profile.role==='institution'){
                validateBusinessCooperationForAgent(agentId,term.gp,options.agentPath);
                if(term.items.length||term.service)throw new Error('Avatarless Business may promise only treasury GP');
                if(!recovery){const t=new InstitutionTreasuryStore(options.settlement?.treasuryPath??institutionTreasuryPathFor(options.agentPath));
                    try{if((t.get('business',profile.subjectId)?.availableGp??0)<term.gp)throw new Error('Economic treasury lacks cover');}finally{t.close();}}
            }else{
                const state=options.playerState?.(agentId),age=Date.now()-Date.parse(state?.observedAt??'');
                if(!state||age<0||age>5000||state.world.player?.isDead)throw new Error('Fresh own player state required for economic choice');
                if(term.service && (!term.skill||!['procedure.food.gather-lobster','procedure.food.cook-lobster','procedure.food.consume-lobster'].includes(term.skill.id)
                    ||!use(s=>s.listSkillKnowledge(agentId).some(k=>['known','preferred'].includes(k.status)&&k.skill.id===term.skill!.id&&k.skill.version===term.skill!.version))))
                    throw new Error('Work proposal needs a known native-evidence procedure');
                if(!recovery){const count=(id:number)=>state.world.inventory.filter(i=>i.id===id).reduce((n,i)=>n+i.count,0);
                    if(count(995)<term.gp||term.items.some(i=>count(i.id)<i.count))throw new Error('Economic player inventory lacks cover');}
            }
            const peer=use(s=>s.getControlProfile(peerId));
            if(!peer||peer.role==='institution'&&(term.items.length||term.gp>0&&profile.role==='player'))throw new Error('Unsupported inventory-escrow counterparty');
        };
        const enumerate=():CooperationChoice[]=>{
            const choices:CooperationChoice[]=[];
            const relations=ownRelations();
            const trust=(id:string)=>relations.find(r=>r.partnerAgentId===id)?.relationship.trust??-101;
            const offers=contracts(s=>s.listOffers(500,new Date().toISOString())).filter(o=>o.creatorAgentId===agentId||o.counterpartyAgentId===agentId);
            const active=contracts(s=>s.listContracts(500)).filter(c=>c.status==='active'&&(c.partyAAgentId===agentId||c.partyBAgentId===agentId));
            for(const offer of offers.filter(o=>o.counterpartyAgentId===agentId&&o.status==='open')){
                let peerBinding:string;try{peerBinding=use(s=>cooperationActorBinding(s,offer.creatorAgentId));}catch{continue;}
                const base={offerId:offer.offerId,expectedRevision:offer.revision,offer,ownBinding:binding,partnerBinding:peerBinding,
                    partnerAgentId:offer.creatorAgentId,terms:{own:offer.counterpartyProvides,partner:offer.creatorProvides,expiresAt:offer.expiresAt}};
                choices.push({...base,optionId:`decline.${offer.offerId}`,action:'decline-offer',costGp:0,description:'Decline this addressed offer without financial commitment'});
                try{
                    if(trust(offer.creatorAgentId)<grant!.minimumTrust)continue;
                    const origin=contracts(s=>s.cooperationOrigin(offer.offerId));
                    if(!origin||origin.creatorBinding!==peerBinding||origin.counterpartyBinding!==binding)continue;
                    if(Date.parse(offer.expiresAt)-Date.now()>grant!.maxTtlMs||!grant!.templates.some(t=>t.kind===offer.kind&&sameTerm(t.ownProvides,offer.counterpartyProvides)&&sameTerm(t.partnerProvides,offer.creatorProvides)))continue;
                    ownTermAllowed(offer.counterpartyProvides,offer.creatorAgentId);
                    choices.push({...base,optionId:`accept.${offer.offerId}`,action:'accept-offer',costGp:offer.counterpartyProvides.gp,description:'Accept exact immutable bilateral terms through funded escrow'});
                }catch{/* No executable acceptance; refusal stays available. */}
            }
            for(const relation of relations.filter(r=>r.relationship.trust>=grant!.minimumTrust).sort((a,b)=>a.partnerAgentId.localeCompare(b.partnerAgentId)).slice(0,12)){
                const peerId=relation.partnerAgentId;if(peerId===agentId)continue;
                let peerBinding:string;try{peerBinding=use(s=>cooperationActorBinding(s,peerId));}catch{continue;}
                if(active.some(c=>[c.partyAAgentId,c.partyBAgentId].includes(peerId))||offers.some(o=>o.creatorAgentId===agentId&&o.counterpartyAgentId===peerId&&o.status==='open'))continue;
                for(const t of grant!.templates){try{
                    ownTermAllowed(t.ownProvides,peerId);const peer=use(s=>s.getControlProfile(peerId));
                    if(peer?.role==='institution'&&(t.partnerProvides.items.length||t.partnerProvides.service))continue;
                    const offer:CreateEconomicOffer={creatorAgentId:agentId,counterpartyAgentId:peerId,kind:t.kind,title:t.title,summary:t.summary,
                        creatorProvides:t.ownProvides,counterpartyProvides:t.partnerProvides,expiresAt:new Date(Date.parse(observedAt)+t.ttlMs).toISOString()};
                    if(Date.parse(offer.expiresAt)<=Date.now())continue;
                    const optionId=`propose.${stateDigest([peerId,t.templateId]).slice(0,32)}`;
                    choices.push({optionId,action:t.kind==='work'?'propose-work':'propose-offer',partnerAgentId:peerId,costGp:t.ownProvides.gp,description:t.title,
                        terms:{own:t.ownProvides,partner:t.partnerProvides,expiresAt:offer.expiresAt},offerId:uuid(`cooperation:${agentId}:${event.eventId}:${optionId}`),
                        expectedRevision:null,offer,ownBinding:binding,partnerBinding:peerBinding});
                }catch{/* Unfunded/out-of-scope templates never reach the model. */}}
            }
            return choices.slice(0,12);
        };
        if(!run){const choices=enumerate();if(!choices.length)return null;
            const goal={goalId:'economic-cooperation',title:'Choose bounded voluntary cooperation',description:'Own goals, personal trust and reciprocal terms; no forced consent'};
            const input:LlmPlanningInput={agentId,mode:'choose-economic-action',cooperationRole:grant.role,goal,
                goalHierarchy:[{...goal,parentGoalId:null,horizon:'current',priority:50}],allowedSkills:[],runId:event.eventId,
                economicAlternatives:choices.map(({optionId,action,partnerAgentId,costGp,description,terms})=>({optionId,action,partnerAgentId,costGp,description,terms})),
                trustedContext:JSON.stringify({subject:`${profile.subjectKind}:${profile.subjectId}`,relationships:ownRelations()
                    .filter(r=>choices.some(c=>r.partnerAgentId===c.partnerAgentId)).map(({relationship:r,partnerAgentId})=>({actor:partnerAgentId,trust:r.trust,affinity:r.affinity})),
                    limits:{gp:grant.maxGpPerAction,dailyGp:grant.maxGpPerDay,itemUnits:grant.maxItemUnits}}),untrustedText:[event.summary.slice(0,1000)]};
            run=use(s=>s.prepareEconomicAction({eventId:event.eventId,sourceKey:event.sourceKey,agentId,profileRevision:profile.revision,grantDigest,
                binding,policyId:grant!.policyId,policyVersion:grant!.policyVersion,observedAt,input,choices},options.maxLlmCostMicros,options.requiredLeaseOwner));
        }
        if(run.request.grantDigest!==grantDigest||run.request.binding!==binding)throw new Error('Economic grant or actor binding changed');
        use(s=>s.assertEconomicActionAuthority(run!.request,options.requiredLeaseOwner));
        if(run.status==='prepared'){
            if(!use(s=>s.claimEconomicInference(event.eventId)))return out('bounded-wait','Economic inference already claimed');
            const plan=await options.plan(run.request.input);run=use(s=>s.finishEconomicInference(event.eventId,plan));
            if(run.status==='waiting')return out(plan.status,run.reason);
            if(run.status==='inferring')return out('bounded-wait','Economic inference is uncertain; reconciliation required.');
        }
        grant=readGrant();if(!grant||stateDigest(grant)!==run.request.grantDigest)throw new Error('Economic grant revoked during inference');
        const selected=run.plan?.decision?.kind==='choose-alternative'?(run.request.choices as CooperationChoice[]).find(c=>c.optionId===(run!.plan!.decision as {optionId:string}).optionId):null;
        if(!selected)throw new Error('Economic selection is unavailable');
        if(run.status==='decided'&&!enumerate().some(c=>stateDigest(c)===stateDigest(selected)))throw new Error('Economic consent/terms/funding context changed');
        if(use(s=>cooperationActorBinding(s,agentId))!==selected.ownBinding||use(s=>cooperationActorBinding(s,selected.partnerAgentId))!==selected.partnerBinding)
            throw new Error('Economic participant binding changed');
        const tool=selected.action==='accept-offer'||selected.action==='decline-offer'?'respond-economic-offer':selected.action==='propose-work'?'propose-work-need':'propose-economic-offer';
        if(!listAgentDomainTools(profile).includes(tool))throw new Error('Economic role tool denied');
        use(s=>s.beginEconomicApplication(event.eventId,selected.costGp,grant!.maxGpPerDay,options.requiredLeaseOwner));
        let applied:EconomicOffer;
        if(selected.action==='propose-offer'||selected.action==='propose-work'){
            if(!contracts(s=>s.getOffer(selected.offerId))){
                if(Date.parse(selected.offer.expiresAt)<=Date.now())throw new Error('Prepared economic offer expired before creation');
                ownTermAllowed(selected.offer.creatorProvides,selected.partnerAgentId);
            }
            applied=contracts(s=>s.createCooperationOffer(selected.offer,{actionId:event.eventId,creatorBinding:selected.ownBinding,
                counterpartyBinding:selected.partnerBinding,grantDigest:run!.request.grantDigest},run!.request.observedAt,selected.offerId));
        }else if(selected.action==='decline-offer'){
            applied=contracts(s=>{const existing=s.getOffer(selected.offerId);if(existing?.status==='declined')return existing;
                return s.decline(selected.offerId,agentId,selected.expectedRevision!,'Declined by the addressed economic actor.');});
        }else{
            const existing=contracts(s=>s.getOffer(selected.offerId));
            if(!existing||existing.termsDigest!==(selected.offer as EconomicOffer).termsDigest)throw new Error('Economic offer terms changed before acceptance');
            applied=(await acceptFundedEconomicOffer(selected.offerId,agentId,selected.expectedRevision!,{...options.settlement,agentPath:options.agentPath,
                contractsPath:path,treasuryPath:options.settlement?.treasuryPath??institutionTreasuryPathFor(options.agentPath)})).offer;
        }
        const result={action:selected.action,offerId:applied.offerId,contractId:applied.contractId,status:applied.status};
        use(s=>s.settleEconomicAction(event.eventId,'applied','Economic action applied; consent and native performance remain distinct.',JSON.stringify(result)));
        return out('completed','Economic action applied; consent and native performance remain distinct.',result);
    }catch(error){const reason=error instanceof Error?error.message:String(error);const current=use(s=>s.getEconomicAction(event.eventId));
        if(current&&['prepared','decided'].includes(current.status))use(s=>s.settleEconomicAction(event.eventId,'waiting',reason));
        return out('bounded-wait',reason);
    }
}
