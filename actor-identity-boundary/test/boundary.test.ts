import { describe,expect,test } from 'bun:test';
import { join } from 'node:path';
import { assessWorldEntityIdentity,loadActorIdentityBoundaryPolicy,validateActorIdentityBoundaryPolicy } from '../index.js';
import type { PersistentActorEvidenceClaim,WorldEntityIdentityObservation } from '../index.js';

const policy=()=>loadActorIdentityBoundaryPolicy(join(import.meta.dir,'..','..','config','actor-identity-boundary.json'));
function observation(typeId:string,entityKind:WorldEntityIdentityObservation['entityKind']='npc'):WorldEntityIdentityObservation{
    return{entityRef:`world:${entityKind}:${typeId}:1`,entityKind,typeId,displayName:typeId};}
function claim(observed:WorldEntityIdentityObservation,kind:PersistentActorEvidenceClaim['kind']='business-employment'):
PersistentActorEvidenceClaim{return{evidenceId:'evidence-1',kind,persistentRecordId:'record-1',subjectRef:observed.entityRef,
    sourceDigest:'a'.repeat(64)};}
describe('world entity persistent actor boundary',()=>{
    test('keeps visual-only people, animals and mobs ambient without creating identity authority',()=>{for(const observed of[
        observation('man'),observation('woman'),observation('cow','animal'),observation('goblin','mob')]){
        expect(assessWorldEntityIdentity(policy(),observed,[],()=>true)).toMatchObject({entityRef:observed.entityRef,
            disposition:'ambient',reason:'no-verified-persistent-state',acceptedEvidenceIds:[]});}});
    test('promotes only domain-verified persistent economic or social state',()=>{const shopkeeper=observation('generalshopkeeper1'),
        economic=claim(shopkeeper),citizen=observation('man'),social=claim(citizen,'social-relationship');
        expect(assessWorldEntityIdentity(policy(),shopkeeper,[economic],candidate=>candidate.evidenceId===economic.evidenceId))
            .toMatchObject({disposition:'persistent-actor',reason:'verified-economic-state',acceptedEvidenceIds:['evidence-1']});
        expect(assessWorldEntityIdentity(policy(),citizen,[social],()=>true))
            .toMatchObject({disposition:'persistent-actor',reason:'verified-social-state'});});
    test('does not trust a well-formed but unverified persistent-state claim',()=>{const observed=observation('generalshopkeeper1');
        expect(assessWorldEntityIdentity(policy(),observed,[claim(observed)],()=>false)).toMatchObject({disposition:'ambient',
            reason:'no-verified-persistent-state',acceptedEvidenceIds:[]});});
    test('rejects visual promotion policy, foreign evidence and catalog tampering',()=>{const configured=policy(),observed=observation('man');
        expect(()=>validateActorIdentityBoundaryPolicy({schemaVersion:1,defaultDisposition:'ambient',visualTypePromotion:'allowed',
            economicEvidenceKinds:configured.economicEvidenceKinds,socialEvidenceKinds:configured.socialEvidenceKinds})).toThrow('invalid');
        expect(()=>assessWorldEntityIdentity(configured,observed,[{...claim(observed),subjectRef:'world:npc:other:1'}],()=>true))
            .toThrow('claim');expect(()=>assessWorldEntityIdentity({...configured,digest:'0'.repeat(64)},observed,[],()=>false))
            .toThrow('digest mismatch');});
});
