import { createHash } from 'node:crypto';

const AUTHORIZATION=Symbol('verified-repair-authorization'),DIGEST=/^[0-9a-f]{64}$/;
export interface VerifiedRepairAuthorization{
    readonly [AUTHORIZATION]:true;
    operationId:string;
    itemInstanceId:string;
    expectedRevision:number;
    restoredDurability:number;
    atSimulationTime:string;
    evidence:{policyId:string;policyDigest:string;materialReceiptId:string;inputReceiptDigest:string;competenceSnapshotDigest:string;
        facilityReceiptDigest:string;startedAtSimulationTime:string};
    authorizationDigest:string;
}
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
type RepairAuthorizationInput=Omit<VerifiedRepairAuthorization,typeof AUTHORIZATION|'authorizationDigest'>;
export function issueVerifiedRepairAuthorization(input:RepairAuthorizationInput):VerifiedRepairAuthorization{
    return{...input,[AUTHORIZATION]:true,authorizationDigest:hash(input)};}
export function assertVerifiedRepairAuthorization(value:VerifiedRepairAuthorization):void{
    const{authorizationDigest,...branded}=value,{[AUTHORIZATION]:brand,...input}=branded;
    if(brand!==true||!DIGEST.test(authorizationDigest)||hash(input)!==authorizationDigest)
        throw new Error('Repair authorization is invalid');
}
