import {digest,object,hash,time} from '../external-trade/policy.js';
import {check} from '../external-trade/source.js';
export {digest as xpStateDigest};
export interface XpActivityState {repetitionScore:number;updatedAt:number;awards:number;baseXp:number;grantedXp:number}
export interface XpPlayerState {activities:Record<string,XpActivityState>}
export function xpCohort(raw:unknown):string[]{
    check(Array.isArray(raw) && raw.length>=1 && raw.length<=50,'XP baseline requires 1-50 players');
    const names=raw as unknown[];
    check(names.every(name=>typeof name==='string' && /^[a-z0-9 _-]{1,12}$/.test(name) && name.trim()===name),'Invalid canonical XP player');
    check(new Set(names).size===names.length,'Duplicate XP player');return [...names as string[]].sort();
}
export function canonicalXpPlayers(raw:unknown):Record<string,XpPlayerState>{
    check(raw && typeof raw==='object' && !Array.isArray(raw),'Invalid XP players');
    const entries=Object.entries(raw);check(entries.length<=10000,'XP player limit exceeded');let activities=0;
    return Object.fromEntries(entries.sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>{
        xpCohort([name]);const player=object(value,['activities']);
        check(player.activities && typeof player.activities==='object' && !Array.isArray(player.activities),'Invalid XP activities');
        const rows=Object.entries(player.activities);activities+=rows.length;check(activities<=100000,'XP activity limit exceeded');
        return [name,{activities:Object.fromEntries(rows.sort(([a],[b])=>a.localeCompare(b)).map(([key,raw])=>{
            check(key.length>0 && key.length<=512,'Invalid XP activity key');
            const state=object(raw,['repetitionScore','updatedAt','awards','baseXp','grantedXp']);
            for(const value of [state.repetitionScore,state.baseXp,state.grantedXp])check(typeof value==='number' && Number.isFinite(value) && value>=0 && value<=Number.MAX_SAFE_INTEGER,'Invalid XP counter');
            check(Number.isSafeInteger(state.awards) && state.awards>=0 && Number.isSafeInteger(state.updatedAt)
                && state.updatedAt>=0 && state.updatedAt<=8640000000000000,'Invalid XP timestamp or award count');
            return [key,{repetitionScore:state.repetitionScore,updatedAt:state.updatedAt,awards:state.awards,baseXp:state.baseXp,grantedXp:state.grantedXp} as XpActivityState];
        }))}];
    }));
}
export function xpConfigurationDigest(config:Record<string,boolean|number|string>):string{
    check(config && typeof config==='object' && !Array.isArray(config) && Object.values(config).every(value=>
        ['boolean','number','string'].includes(typeof value) && (typeof value!=='number'||Number.isFinite(value))),'Invalid XP configuration');
    return digest(config);
}
export interface XpStateSnapshot {
    schemaVersion:1;authority:'engine-diminishing-xp-store';observedAt:string;cohort:string[];
    players:Record<string,XpPlayerState>;empty:boolean;cohortDigest:string;configurationDigest:string;storeDigest:string;digest:string;
}
export function makeXpStateSnapshot(players:Record<string,XpPlayerState>,cohort:string[],configurationDigest:string,storeDigest:string,observedAt:string):XpStateSnapshot{
    const names=xpCohort(cohort),selected=canonicalXpPlayers(Object.fromEntries(names.map(name=>[name,Object.hasOwn(players,name)?players[name]:{activities:{}}])));
    const body={schemaVersion:1 as const,authority:'engine-diminishing-xp-store' as const,observedAt:time(observedAt),cohort:names,players:selected,
        empty:Object.values(selected).every(player=>Object.keys(player.activities).length===0),cohortDigest:digest({cohort:names,players:selected}),
        configurationDigest:hash(configurationDigest),storeDigest:hash(storeDigest)};
    return {...body,digest:digest(body)};
}
export function validateXpStateSnapshot(raw:unknown,expectedCohort?:string[],expectedConfigurationDigest?:string):XpStateSnapshot{
    const v=object(raw,['schemaVersion','authority','observedAt','cohort','players','empty','cohortDigest','configurationDigest','storeDigest','digest']);
    check(v.schemaVersion===1 && v.authority==='engine-diminishing-xp-store','Unsupported XP snapshot');
    const players=canonicalXpPlayers(v.players),cohort=xpCohort(v.cohort);
    check(digest(Object.keys(players).sort())===digest(cohort),'XP snapshot cohort differs');
    const checked=makeXpStateSnapshot(players,cohort,v.configurationDigest,v.storeDigest,v.observedAt);
    check(checked.digest===v.digest && checked.empty===v.empty && checked.cohortDigest===v.cohortDigest,'XP snapshot digest differs');
    if(expectedCohort)check(digest(cohort)===digest(xpCohort(expectedCohort)),'XP snapshot avatars differ');
    if(expectedConfigurationDigest)check(checked.configurationDigest===expectedConfigurationDigest,'XP snapshot configuration differs');
    return checked;
}
