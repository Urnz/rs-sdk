import { createHash } from 'node:crypto';
export interface BankingRiskLimits { maxInstitutions:number; maxEdges:number; maxContagionDepth:number;
    maxExposureGp:number; maxWithdrawalGpPerBank:number; maxDefaults:number; lossGivenDefaultBps:number }
export interface BankingRiskBank { bankId:string; cashGp:number; depositsGp:number; withdrawalDemandGp:number }
export interface BankingRiskExposure { creditorId:string; debtorId:string; amountGp:number }
export interface BankingRiskScenario { scenarioId:string; seedDefaultIds:string[]; banks:BankingRiskBank[]; exposures:BankingRiskExposure[] }
export interface BankingRiskResult { scenarioId:string; digest:string; withdrawals:Array<{bankId:string;requestedGp:number;paidGp:number;unpaidGp:number;insolvent:boolean}>;
    defaults:string[]; lossesByInstitution:Record<string,number>; truncated:boolean }
const safe=(n:number,max:number,label:string)=>{if(!Number.isSafeInteger(n)||n<0||n>max)throw new Error(`${label} is outside the simulation limit`);return n};
const ident=(v:string)=>{const n=v.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(n))throw new Error('Risk institution id is invalid');return n};
export function simulateBankingRisk(input:BankingRiskScenario,limits:BankingRiskLimits):BankingRiskResult{
    safe(limits.maxInstitutions,100,'Institution count');safe(limits.maxEdges,1_000,'Exposure edge count');safe(limits.maxContagionDepth,10,'Contagion depth');
    safe(limits.maxExposureGp,2_147_483_647,'Exposure');safe(limits.maxWithdrawalGpPerBank,2_147_483_647,'Withdrawal');safe(limits.maxDefaults,100,'Default count');safe(limits.lossGivenDefaultBps,10_000,'Loss given default');
    if(input.banks.length>limits.maxInstitutions||input.exposures.length>limits.maxEdges)throw new Error('Risk scenario exceeds bounded topology');
    const ids=new Set<string>();const banks=input.banks.map(b=>{const bankId=ident(b.bankId);if(ids.has(bankId))throw new Error('Risk scenario has duplicate institution');ids.add(bankId);
        return{bankId,cashGp:safe(b.cashGp,2_147_483_647,'Bank cash'),depositsGp:safe(b.depositsGp,2_147_483_647,'Bank deposits'),withdrawalDemandGp:safe(b.withdrawalDemandGp,limits.maxWithdrawalGpPerBank,'Withdrawal demand')}});
    const exposures=input.exposures.map(e=>{const creditorId=ident(e.creditorId),debtorId=ident(e.debtorId);if(creditorId===debtorId||!ids.has(creditorId)||!ids.has(debtorId))throw new Error('Risk exposure has invalid counterparties');return{creditorId,debtorId,amountGp:safe(e.amountGp,limits.maxExposureGp,'Exposure')}});
    const withdrawals=banks.map(b=>{const paidGp=Math.min(b.cashGp,b.withdrawalDemandGp);return{bankId:b.bankId,requestedGp:b.withdrawalDemandGp,paidGp,unpaidGp:b.withdrawalDemandGp-paidGp,insolvent:b.cashGp<b.withdrawalDemandGp}});
    const defaults=new Set(input.seedDefaultIds.map(ident));for(const w of withdrawals)if(w.insolvent)defaults.add(w.bankId);for(const d of defaults)if(!ids.has(d))throw new Error('Risk default is not a scenario institution');
    const losses:Record<string,number>={};let frontier=[...defaults],depth=0,truncated=false;
    while(frontier.length&&depth<limits.maxContagionDepth){const next:string[]=[];for(const debtor of frontier)for(const e of exposures.filter(x=>x.debtorId===debtor)){
        const loss=Math.floor(e.amountGp*limits.lossGivenDefaultBps/10_000);losses[e.creditorId]=(losses[e.creditorId]??0)+loss;
        const creditor=banks.find(b=>b.bankId===e.creditorId)!;if(!defaults.has(e.creditorId)&&(losses[e.creditorId]??0)>creditor.cashGp){if(defaults.size>=limits.maxDefaults){truncated=true;continue}defaults.add(e.creditorId);next.push(e.creditorId)}}frontier=next;depth++}
    if(frontier.length)truncated=true;const canonical={scenarioId:ident(input.scenarioId),withdrawals,defaults:[...defaults].sort(),lossesByInstitution:Object.fromEntries(Object.entries(losses).sort()),truncated};
    return{...canonical,digest:createHash('sha256').update(JSON.stringify(canonical)).digest('hex')};
}
