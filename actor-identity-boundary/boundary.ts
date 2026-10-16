import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ActorIdentityBoundaryPolicy,PersistentActorEvidenceClaim,PersistentActorEvidenceKind,
    PersistentActorEvidenceVerifier,WorldEntityIdentityAssessment,WorldEntityIdentityObservation } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{0,127}$/i,DIGEST=/^[0-9a-f]{64}$/;
const ECONOMIC:PersistentActorEvidenceKind[]=['business-ownership','business-employment','property-entitlement','treasury-control'];
const SOCIAL:PersistentActorEvidenceKind[]=['governance-membership','social-relationship'];
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]));}
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
export function actorIdentityBoundaryPolicyDigest(value:Omit<ActorIdentityBoundaryPolicy,'digest'>):string{return hash(value);}
export function validateActorIdentityBoundaryPolicy(value:unknown):ActorIdentityBoundaryPolicy{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Actor identity boundary policy is invalid');
    const input=value as Record<string,unknown>;
    if(Object.keys(input).sort().join(',')!=='defaultDisposition,economicEvidenceKinds,schemaVersion,socialEvidenceKinds,visualTypePromotion'
        ||input.schemaVersion!==1||input.defaultDisposition!=='ambient'||input.visualTypePromotion!=='forbidden'
        ||!Array.isArray(input.economicEvidenceKinds)||JSON.stringify(input.economicEvidenceKinds)!==JSON.stringify(ECONOMIC)
        ||!Array.isArray(input.socialEvidenceKinds)||JSON.stringify(input.socialEvidenceKinds)!==JSON.stringify(SOCIAL))
        throw new Error('Actor identity boundary policy is invalid');
    const definition={schemaVersion:1 as const,defaultDisposition:'ambient' as const,visualTypePromotion:'forbidden' as const,
        economicEvidenceKinds:[...ECONOMIC],socialEvidenceKinds:[...SOCIAL]};
    return{...definition,digest:actorIdentityBoundaryPolicyDigest(definition)};}
export function loadActorIdentityBoundaryPolicy(path:string):ActorIdentityBoundaryPolicy{
    return validateActorIdentityBoundaryPolicy(JSON.parse(readFileSync(path,'utf8')) as unknown);}
export function assessWorldEntityIdentity(policy:ActorIdentityBoundaryPolicy,observation:WorldEntityIdentityObservation,
    claims:PersistentActorEvidenceClaim[],verify:PersistentActorEvidenceVerifier):WorldEntityIdentityAssessment{
    const{digest:policyDigest,...definition}=policy;if(policyDigest!==actorIdentityBoundaryPolicyDigest(definition))
        throw new Error('Actor identity boundary policy digest mismatch');
    if(!observation||!ID.test(observation.entityRef)||!['npc','animal','mob'].includes(observation.entityKind)
        ||!ID.test(observation.typeId)||typeof observation.displayName!=='string'||!observation.displayName.trim()
        ||observation.displayName.length>80||!Array.isArray(claims)||claims.length>100)
        throw new Error('World entity identity observation is invalid');
    const allowed=new Set([...policy.economicEvidenceKinds,...policy.socialEvidenceKinds]);
    for(const claim of claims){if(!claim||!ID.test(claim.evidenceId)||!allowed.has(claim.kind)||!ID.test(claim.persistentRecordId)
        ||claim.subjectRef!==observation.entityRef||!DIGEST.test(claim.sourceDigest))throw new Error('Persistent actor evidence claim is invalid');}
    if(new Set(claims.map(claim=>claim.evidenceId)).size!==claims.length)throw new Error('Persistent actor evidence ids must be unique');
    const accepted=claims.filter(claim=>verify(claim,observation)),economic=new Set(policy.economicEvidenceKinds),
        social=new Set(policy.socialEvidenceKinds),hasEconomic=accepted.some(claim=>economic.has(claim.kind)),
        hasSocial=accepted.some(claim=>social.has(claim.kind));
    const disposition=hasEconomic||hasSocial?'persistent-actor' as const:'ambient' as const,
        reason=hasEconomic?'verified-economic-state' as const:hasSocial?'verified-social-state' as const:
            'no-verified-persistent-state' as const,acceptedEvidenceIds=accepted.map(claim=>claim.evidenceId).sort();
    const result={entityRef:observation.entityRef,disposition,reason,acceptedEvidenceIds,policyDigest};
    return{...result,digest:hash({observation,result})};}
