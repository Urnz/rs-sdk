import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FencingCandidateSnapshot, FencingMarketPolicy, FencingMarketProjection,
    FencingOpportunity, FencingParticipationDecision } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{1,127}$/i,DIGEST=/^[0-9a-f]{64}$/;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]))}
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}
function id(value:string,field:string):string{if(typeof value!=='string'||!ID.test(value))throw new Error(`${field} is invalid`);return value}
function integer(value:number,field:string,minimum=0):number{if(!Number.isSafeInteger(value)||value<minimum||value>2_147_483_647)
    throw new Error(`${field} is invalid`);return value}
function exact(value:object,keys:string[],field:string):void{if(Object.keys(value).sort().join(',')!==[...keys].sort().join(','))
    throw new Error(`${field} is invalid`)}
export function fencingMarketPolicyDigest(value:Omit<FencingMarketPolicy,'digest'>):string{return hash(value)}
export function validateFencingMarketPolicy(value:unknown):FencingMarketPolicy{if(!value||typeof value!=='object'||Array.isArray(value))
    throw new Error('Fencing market policy is invalid');const input=value as Record<string,unknown>;
    exact(input,['schemaVersion','minimumFamiliarity','minimumTrust','minimumExpectedProfitGp'],'Fencing market policy');
    if(input.schemaVersion!==1)throw new Error('Fencing market policy is invalid');const definition={schemaVersion:1 as const,
        minimumFamiliarity:integer(Number(input.minimumFamiliarity),'minimumFamiliarity'),
        minimumTrust:integer(Number(input.minimumTrust),'minimumTrust'),
        minimumExpectedProfitGp:integer(Number(input.minimumExpectedProfitGp),'minimumExpectedProfitGp')};
    if(definition.minimumFamiliarity>100||definition.minimumTrust>100)throw new Error('Fencing relationship policy is invalid');
    return{...definition,digest:fencingMarketPolicyDigest(definition)}}
export function loadDefaultFencingMarketPolicy():FencingMarketPolicy{return validateFencingMarketPolicy(JSON.parse(
    readFileSync(join(import.meta.dir,'..','config','fencing-market-policy.json'),'utf8')) as unknown)}
export function decideFencingParticipation(policy:FencingMarketPolicy,candidateInput:FencingCandidateSnapshot,
    opportunityInput:FencingOpportunity):FencingParticipationDecision{const{digest,...definition}=policy;
    if(digest!==fencingMarketPolicyDigest(definition))throw new Error('Fencing market policy digest mismatch');
    const candidate=validateCandidate(candidateInput),opportunity=validateOpportunity(opportunityInput);
    const expectedProfitGp=opportunity.expectedResaleGp-opportunity.acquisitionCostGp-opportunity.estimatedRiskCostGp;
    const relationship=candidate.relationships.find(value=>value.counterpartyAgentId===opportunity.sellerAgentId);
    const reason:FencingParticipationDecision['reason']=candidate.lifecycleStatus!=='active'?'inactive'
        :candidate.availableGp<opportunity.acquisitionCostGp?'insufficient-funds'
        :candidate.storageAvailableUnits<opportunity.storageUnits?'insufficient-storage'
        :opportunity.requiredCapabilities.some(value=>!candidate.capabilities.includes(value))?'missing-capability'
        :!relationship||relationship.familiarity<policy.minimumFamiliarity||relationship.trust<policy.minimumTrust?'no-relationship'
        :expectedProfitGp<policy.minimumExpectedProfitGp?'unprofitable':'eligible-profitable';
    const base={candidateId:candidate.candidateId,opportunityId:opportunity.opportunityId,
        candidateKind:candidate.kind,operatorAgentId:candidate.operatorAgentId,
        participate:reason==='eligible-profitable',reason,expectedProfitGp,
        committedCapitalGp:reason==='eligible-profitable'?opportunity.acquisitionCostGp:0,
        sourceDigests:[candidate.sourceEvidenceDigest,opportunity.sourceEvidenceDigest] as[string,string],policyDigest:policy.digest};
    return{...base,decisionDigest:hash(base)}}
export function projectFencingMarket(policy:FencingMarketPolicy,candidates:FencingCandidateSnapshot[],
    opportunity:FencingOpportunity):FencingMarketProjection{if(!Array.isArray(candidates)||candidates.length>10_000)
    throw new Error('Fencing candidates are invalid');const decisions=candidates.map(candidate=>
        decideFencingParticipation(policy,candidate,opportunity));const participants=decisions.filter(value=>value.participate)
        .sort((left,right)=>right.expectedProfitGp-left.expectedProfitGp||left.candidateId.localeCompare(right.candidateId));
    return{opportunityId:opportunity.opportunityId,availability:participants.length?'available':'unavailable',participants}}
export function assertFencingParticipationDecision(policy:FencingMarketPolicy,candidate:FencingCandidateSnapshot,
    opportunity:FencingOpportunity,decision:FencingParticipationDecision):void{const expected=decideFencingParticipation(policy,candidate,opportunity);
    if(!decision.participate||decision.decisionDigest!==expected.decisionDigest)throw new Error('Fencing participation is not authorized')}
function validateCandidate(value:FencingCandidateSnapshot):FencingCandidateSnapshot{if(!value||typeof value!=='object')
    throw new Error('Fencing candidate is invalid');exact(value,['candidateId','kind','operatorAgentId','lifecycleStatus','availableGp',
        'storageAvailableUnits','capabilities','relationships','sourceEvidenceDigest'],'Fencing candidate');
    if(!['agent','business'].includes(value.kind)||!['active','deceased','imprisoned','insolvent','inactive'].includes(value.lifecycleStatus)
        ||!DIGEST.test(value.sourceEvidenceDigest)||!Array.isArray(value.capabilities)||!Array.isArray(value.relationships)
        ||value.capabilities.some(item=>typeof item!=='string'||!ID.test(item)))throw new Error('Fencing candidate is invalid');
    const capabilities=[...new Set(value.capabilities)].sort(),relationships=value.relationships.map((entry,index)=>{
        if(!entry||typeof entry!=='object')throw new Error(`relationships[${index}] is invalid`);
        exact(entry,['counterpartyAgentId','familiarity','trust'],`relationships[${index}]`);return{
            counterpartyAgentId:id(entry.counterpartyAgentId,`relationships[${index}].counterpartyAgentId`),
            familiarity:integer(entry.familiarity,`relationships[${index}].familiarity`),
            trust:integer(entry.trust,`relationships[${index}].trust`)}});
    if(relationships.some(item=>item.familiarity>100||item.trust>100)
        ||new Set(relationships.map(item=>item.counterpartyAgentId)).size!==relationships.length)throw new Error('Fencing relationships are invalid');
    return{candidateId:id(value.candidateId,'candidateId'),kind:value.kind,operatorAgentId:id(value.operatorAgentId,'operatorAgentId'),
        lifecycleStatus:value.lifecycleStatus,availableGp:integer(value.availableGp,'availableGp'),
        storageAvailableUnits:integer(value.storageAvailableUnits,'storageAvailableUnits'),capabilities,relationships,
        sourceEvidenceDigest:value.sourceEvidenceDigest}}
function validateOpportunity(value:FencingOpportunity):FencingOpportunity{if(!value||typeof value!=='object')
    throw new Error('Fencing opportunity is invalid');exact(value,['opportunityId','sellerAgentId','itemId','quantity','storageUnits',
        'assetId','provenanceDigest','acquisitionCostGp','expectedResaleGp','estimatedRiskCostGp','requiredCapabilities',
        'sourceEvidenceDigest'],'Fencing opportunity');
    if(!DIGEST.test(value.sourceEvidenceDigest)||!Array.isArray(value.requiredCapabilities)
        ||value.requiredCapabilities.some(item=>typeof item!=='string'||!ID.test(item)))throw new Error('Fencing opportunity is invalid');
    const assetId=value.assetId===null?null:id(value.assetId,'assetId');if((assetId===null)!==(value.provenanceDigest===null)
        ||value.provenanceDigest!==null&&!DIGEST.test(value.provenanceDigest))throw new Error('Fencing opportunity provenance is invalid');
    return{opportunityId:id(value.opportunityId,'opportunityId'),sellerAgentId:id(value.sellerAgentId,'sellerAgentId'),
        itemId:integer(value.itemId,'itemId'),quantity:integer(value.quantity,'quantity',1),storageUnits:integer(value.storageUnits,'storageUnits',1),
        assetId,provenanceDigest:value.provenanceDigest,
        acquisitionCostGp:integer(value.acquisitionCostGp,'acquisitionCostGp',1),expectedResaleGp:integer(value.expectedResaleGp,'expectedResaleGp'),
        estimatedRiskCostGp:integer(value.estimatedRiskCostGp,'estimatedRiskCostGp'),
        requiredCapabilities:[...new Set(value.requiredCapabilities)].sort(),sourceEvidenceDigest:value.sourceEvidenceDigest}}
