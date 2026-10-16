import type { ReintegrationDescriptor,ReintegrationKnowledge } from './types.js';
import { ReintegrationEvidenceStore,ReintegrationStateStore } from './store.js';

/** Observer-only context projection. Missing/tampered source evidence contributes no descriptor. */
export function projectObserverReintegrationDescriptors(evidence:ReintegrationEvidenceStore,state:ReintegrationStateStore,
    viewerAgentId:string,worldProfileId:string):ReintegrationDescriptor[]{
    try{const audience={kind:'observer' as const,observerAgentId:viewerAgentId,worldProfileId},grouped=new Map<string,{
        sourceEventIds:string[];adjustmentIds:string[]}>();
    for(const adjustment of state.listForAudience(audience)){
        if(adjustment.projection!=='reputation'||adjustment.knowledgeId===null)continue;
        const event=evidence.getEvent(adjustment.eventId),knowledge=evidence.getKnowledge(adjustment.knowledgeId);
        if(!event||!knowledge||!evidence.verifyEvent(event)||!evidence.verifyKnowledge(knowledge,event)
            ||knowledge.audience.kind!=='observer'||knowledge.audience.observerAgentId!==viewerAgentId
            ||knowledge.audience.worldProfileId!==worldProfileId)continue;
        const current=grouped.get(adjustment.subjectAgentId)??{sourceEventIds:[],adjustmentIds:[]};
        current.sourceEventIds.push(event.eventId);current.adjustmentIds.push(adjustment.adjustmentId);
        grouped.set(adjustment.subjectAgentId,current)
    }
    return[...grouped.entries()].map(([targetAgentId,value])=>({viewerAgentId,targetAgentId,
        description:'Known completed reform effort' as const,sourceEventIds:[...new Set(value.sourceEventIds)].sort(),
        adjustmentIds:[...new Set(value.adjustmentIds)].sort()})).sort((a,b)=>a.targetAgentId.localeCompare(b.targetAgentId))
    }catch{return[]}
}

/** Helper for source adapters that must prove knowledge was learned by this exact audience. */
export function reintegrationKnowledgeMatchesObserver(knowledge:Readonly<ReintegrationKnowledge>,eventId:string,
    viewerAgentId:string,worldProfileId:string):boolean{return knowledge.eventId===eventId
    &&knowledge.audience.kind==='observer'&&knowledge.audience.observerAgentId===viewerAgentId
    &&knowledge.audience.worldProfileId===worldProfileId}
