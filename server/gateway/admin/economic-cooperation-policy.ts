import { readFileSync } from 'node:fs';
import { validateEconomicOffer, type EconomicObligation, type EconomicOfferKind } from './economic-contracts.js';

export interface CooperationTemplate { templateId:string; kind:EconomicOfferKind; title:string; summary:string;
    ownProvides:EconomicObligation; partnerProvides:EconomicObligation; ttlMs:number }
export interface CooperationGrant { agentId:string; role:'player'|'institution'; subjectKind:'player'|'business'; subjectId:string;
    policyId:string; policyVersion:string; minimumTrust:number; maxGpPerAction:number; maxGpPerDay:number;
    maxItemUnits:number; maxTtlMs:number; templates:CooperationTemplate[] }
export interface CooperationPolicy {schemaVersion:1;grants:CooperationGrant[]}
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid cooperation object');return v as Record<string,unknown>;}
function keys(o:Record<string,unknown>,names:string[]){if(Object.keys(o).sort().join()!==names.sort().join())throw new Error('Unexpected cooperation fields');}
function id(v:unknown):string{if(typeof v!=='string'||!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(v)||v.length>64)throw new Error('Invalid cooperation id');return v;}
function integer(v:unknown,min=0,max=2147483647):number{if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)throw new Error('Invalid cooperation limit');return Number(v);}
function term(v:unknown):EconomicObligation{
    const o=obj(v);keys(o,Object.hasOwn(o,'skill')?['gp','items','service','skill']:['gp','items','service']);
    if(!Array.isArray(o.items))throw new Error('Invalid cooperation items');
    for(const value of o.items)keys(obj(value),['id','name','count']);
    if(o.skill!=null)keys(obj(o.skill),['id','version']);
    return o as unknown as EconomicObligation;
}
export function validateCooperationPolicy(value:unknown):CooperationPolicy{
    const root=obj(value);keys(root,['schemaVersion','grants']);
    if(root.schemaVersion!==1||!Array.isArray(root.grants)||root.grants.length>100)throw new Error('Invalid cooperation grants');
    const grants=root.grants.map(value=>{
        const g=obj(value);keys(g,['agentId','role','subjectKind','subjectId','policyId','policyVersion','minimumTrust','maxGpPerAction','maxGpPerDay','maxItemUnits','maxTtlMs','templates']);
        if(!(g.role==='player'&&g.subjectKind==='player'||g.role==='institution'&&g.subjectKind==='business')
            ||typeof g.policyVersion!=='string'||!/^\d+\.\d+\.\d+$/.test(g.policyVersion)||!Array.isArray(g.templates)||g.templates.length>6)
            throw new Error('Invalid cooperation role/templates');
        const maxTtlMs=integer(g.maxTtlMs,1000,86400000), maxItemUnits=integer(g.maxItemUnits,0,10000);
        const templates=g.templates.map(value=>{
            const t=obj(value);keys(t,['templateId','kind','title','summary','ownProvides','partnerProvides','ttlMs']);
            const ttlMs=integer(t.ttlMs,1000,maxTtlMs);
            const v=validateEconomicOffer({creatorAgentId:'actor-a',counterpartyAgentId:'actor-b',kind:t.kind as EconomicOfferKind,title:t.title as string,
                summary:t.summary as string,creatorProvides:term(t.ownProvides),counterpartyProvides:term(t.partnerProvides),expiresAt:new Date(1000000000000+ttlMs).toISOString()},new Date(1000000000000).toISOString());
            if([...v.creatorProvides.items,...v.counterpartyProvides.items].reduce((n,i)=>n+i.count,0)>maxItemUnits)throw new Error('Cooperation item risk exceeds grant');
            if([...v.creatorProvides.items,...v.counterpartyProvides.items].some(i=>i.id===995))throw new Error('Coins must use the bounded GP obligation');
            for(const term of [v.creatorProvides,v.counterpartyProvides])if(term.service&&(term.service!=='one-native-invocation'
                ||!term.skill||!['procedure.food.gather-lobster','procedure.food.cook-lobster','procedure.food.consume-lobster'].includes(term.skill.id)))
                throw new Error('Cooperation service must mean one exact native invocation');
            return {templateId:id(t.templateId),kind:v.kind,title:v.title,summary:v.summary,ownProvides:v.creatorProvides,partnerProvides:v.counterpartyProvides,ttlMs};
        });
        if(new Set(templates.map(t=>t.templateId)).size!==templates.length)throw new Error('Duplicate cooperation templates');
        return {agentId:id(g.agentId),role:g.role as CooperationGrant['role'],subjectKind:g.subjectKind as CooperationGrant['subjectKind'],subjectId:id(g.subjectId),
            policyId:id(g.policyId),policyVersion:g.policyVersion,minimumTrust:integer(g.minimumTrust,-100,100),maxGpPerAction:integer(g.maxGpPerAction),
            maxGpPerDay:integer(g.maxGpPerDay),maxItemUnits,maxTtlMs,templates};
    });
    if(new Set(grants.map(g=>g.agentId)).size!==grants.length)throw new Error('Duplicate cooperation actor grants');
    return {schemaVersion:1,grants};
}
export const loadCooperationPolicy=(path:string)=>validateCooperationPolicy(JSON.parse(readFileSync(path,'utf8')));
