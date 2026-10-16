import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {canonicalXpPlayers,makeXpStateSnapshot,validateXpStateSnapshot,xpCohort,xpConfigurationDigest,xpStateDigest,
    type XpStateSnapshot,type XpPlayerState} from '../../../../society-experiments/xp-state.js';

export interface XpActivityContext {
    script: string;
    targetKind: 'loc' | 'npc' | 'obj' | 'none';
    targetId: number | null;
    x: number;
    z: number;
    level: number;
}

export interface DiminishingXpConfig {
    affectedSkills: Set<string>;
    regionSize: number;
    recoveryMinutes: number;
    tierStarts: [number, number, number, number, number];
    multipliers: [number, number, number, number, number];
}

export interface DiminishingXpAward {
    activityKey: string;
    baseXp: number;
    grantedXp: number;
    multiplier: number;
    repetitionScore: number;
    nextRecoveryAt: string | null;
}

interface ActivityState {
    repetitionScore: number;
    updatedAt: number;
    awards: number;
    baseXp: number;
    grantedXp: number;
}

interface PlayerState {
    activities: Record<string, ActivityState>;
}

interface BaselineCommand {kind:'reset'|'restore';commandId:string;expectedStoreDigest:string;reason:string;cohort:string[];sourceCommandId:string|null}
export interface XpBaselineReceipt {sequence:number;request:BaselineCommand;at:string;before:XpStateSnapshot;beforePlayers:Record<string,XpPlayerState>;afterCohortDigest:string;previousHash:string;hash:string}
interface PersistedState {
    schemaVersion: 1 | 2;
    players: Record<string, PlayerState>;
    audit?:{sequence:number;headHash:string;entries:XpBaselineReceipt[]};
}
const auditRoot=xpStateDigest('diminishing-xp-baseline-audit-v1');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function baselineCommand(raw:BaselineCommand):BaselineCommand{
    if(!raw || !uuid.test(raw.commandId) || !/^[0-9a-f]{64}$/.test(raw.expectedStoreDigest)
        || typeof raw.reason!=='string' || !raw.reason.trim() || raw.reason.length>1000
        || !['reset','restore'].includes(raw.kind) || (raw.kind==='reset'?raw.sourceCommandId!==null:!uuid.test(raw.sourceCommandId??'')))
        throw new Error('Invalid XP baseline command');
    return {...raw,cohort:xpCohort(raw.cohort)};
}
function rawFileDigest(path:string):string|null{
    try{return createHash('sha256').update(readFileSync(path)).digest('hex');}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}

export interface DiminishingXpSummary {
    playersTracked: number;
    activitiesTracked: number;
}

export interface DiminishingXpActivityView {
    username: string;
    activityKey: string;
    repetitionScore: number;
    nextMultiplier: number;
    updatedAt: string;
    nextRecoveryAt: string;
}

const defaultStatePath = fileURLToPath(new URL('../../../../.local/admin/diminishing-xp-state.json', import.meta.url));

function finiteNumber(config: Record<string, boolean | number | string>, key: string): number {
    const value = config[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid diminishing XP setting: ${key}`);
    return value;
}

export function parseDiminishingXpConfig(config: Record<string, boolean | number | string>): DiminishingXpConfig {
    const affectedSkillsValue = config.affectedSkills;
    if (typeof affectedSkillsValue !== 'string') throw new Error('Invalid diminishing XP setting: affectedSkills');
    const affectedSkills = new Set(affectedSkillsValue.split(',').map(value => value.trim().toUpperCase()).filter(Boolean));
    if (affectedSkills.size === 0) throw new Error('At least one affected skill is required');

    const regionSize = finiteNumber(config, 'regionSize');
    const recoveryMinutes = finiteNumber(config, 'recoveryMinutes');
    const tierStarts = [1, finiteNumber(config, 'tier2At'), finiteNumber(config, 'tier3At'), finiteNumber(config, 'tier4At'), finiteNumber(config, 'tier5At')] as DiminishingXpConfig['tierStarts'];
    const multipliers = [1, finiteNumber(config, 'multiplier2'), finiteNumber(config, 'multiplier3'), finiteNumber(config, 'multiplier4'), finiteNumber(config, 'multiplier5')] as DiminishingXpConfig['multipliers'];
    if (!Number.isInteger(regionSize) || regionSize < 8 || regionSize > 256) throw new Error('regionSize must be an integer between 8 and 256');
    if (recoveryMinutes <= 0 || recoveryMinutes > 10080) throw new Error('recoveryMinutes must be between 0 and 10080');
    if (tierStarts.some(value => !Number.isInteger(value) || value < 1)
        || tierStarts.some((value, index) => index > 0 && value <= tierStarts[index - 1]!)) {
        throw new Error('Diminishing XP tier thresholds must be strictly increasing positive integers');
    }
    if (multipliers.some(value => value < 0 || value > 1)
        || multipliers.some((value, index) => index > 0 && value > multipliers[index - 1]!)) {
        throw new Error('Diminishing XP multipliers must be between 0 and 1 and must not increase');
    }
    return { affectedSkills, regionSize, recoveryMinutes, tierStarts, multipliers };
}

function validActivityState(value: unknown): value is ActivityState {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Record<string, unknown>;
    return typeof entry.repetitionScore === 'number' && Number.isFinite(entry.repetitionScore) && entry.repetitionScore >= 0
        && typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) && entry.updatedAt >= 0
        && Number.isInteger(entry.awards) && Number(entry.awards) >= 0
        && typeof entry.baseXp === 'number' && Number.isFinite(entry.baseXp) && entry.baseXp >= 0
        && typeof entry.grantedXp === 'number' && Number.isFinite(entry.grantedXp) && entry.grantedXp >= 0;
}

function loadState(path: string): {state:PersistedState;fileDigest:string|null} {
    try {
        const bytes=readFileSync(path);
        const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
        if (!parsed || typeof parsed !== 'object' || ![1,2].includes(Number((parsed as { schemaVersion?: unknown }).schemaVersion))) {
            throw new Error('unsupported state schema');
        }
        const players = (parsed as { players?: unknown }).players;
        if (!players || typeof players !== 'object' || Array.isArray(players)) throw new Error('invalid players');
        for (const player of Object.values(players as Record<string, unknown>)) {
            if (!player || typeof player !== 'object') throw new Error('invalid player state');
            const activities = (player as { activities?: unknown }).activities;
            if (!activities || typeof activities !== 'object' || Array.isArray(activities)
                || !Object.values(activities as Record<string, unknown>).every(validActivityState)) throw new Error('invalid activity state');
        }
        const state=parsed as PersistedState;state.players=canonicalXpPlayers(players);
        if(state.schemaVersion===1){if(state.audit!==undefined)throw new Error('Legacy XP schema cannot contain audit history');}
        else{
            const audit=state.audit;if(!audit || !Array.isArray(audit.entries) || audit.entries.length>10000 || audit.entries.length!==audit.sequence)throw new Error('XP audit tail differs');
            let head=auditRoot;const ids=new Set<string>();
            for(const [index,entry] of audit.entries.entries()){
                const {hash,...body}=entry;baselineCommand(entry.request);validateXpStateSnapshot(entry.before);
                canonicalXpPlayers(entry.beforePlayers);
                if(Object.keys(entry.beforePlayers).some(name=>!entry.request.cohort.includes(name))
                    || makeXpStateSnapshot(entry.beforePlayers,entry.request.cohort,entry.before.configurationDigest,entry.before.storeDigest,entry.before.observedAt).cohortDigest!==entry.before.cohortDigest)
                    throw new Error('XP audit before-image differs');
                if(entry.sequence!==index+1 || entry.previousHash!==head || hash!==xpStateDigest(body) || ids.has(entry.request.commandId)
                    || new Date(entry.at).toISOString()!==entry.at || entry.before.cohort.join(',')!==entry.request.cohort.join(',')
                    || !/^[0-9a-f]{64}$/.test(entry.afterCohortDigest))throw new Error('XP audit chain differs');
                if(entry.request.kind==='restore' && !audit.entries.slice(0,index).some(source=>source.request.commandId===entry.request.sourceCommandId && source.request.kind==='reset'))
                    throw new Error('XP restore source missing');
                ids.add(entry.request.commandId);head=hash;
            }
            if(audit.headHash!==head)throw new Error('XP audit head differs');
        }
        return {state,fileDigest:createHash('sha256').update(bytes).digest('hex')};
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {state:{ schemaVersion: 1, players: {} },fileDigest:null};
        throw new Error(`Diminishing XP state cannot be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function buildXpActivityKey(skill: string, context: XpActivityContext, regionSize: number): string {
    const regionX = Math.floor(context.x / regionSize);
    const regionZ = Math.floor(context.z / regionSize);
    const target = context.targetId === null ? context.targetKind : `${context.targetKind}:${context.targetId}`;
    return `${skill.toUpperCase()}|${context.script || 'unknown'}|${target}|${context.level}:${regionX},${regionZ}`;
}

export function decayRepetitionScore(score: number, updatedAt: number, now: number, recoveryMinutes: number): number {
    if (now <= updatedAt) return score;
    return Math.max(0, score - (now - updatedAt) / (recoveryMinutes * 60_000));
}

export function multiplierForRepetition(repetition: number, config: DiminishingXpConfig): number {
    let tier = 0;
    for (let index = 1; index < config.tierStarts.length; index++) {
        if (repetition >= config.tierStarts[index]!) tier = index;
    }
    return config.multipliers[tier]!;
}

export class DiminishingXpStore {
    private state: PersistedState;
    private fileDigest:string|null;

    constructor(private readonly path = defaultStatePath) {
        const loaded=loadState(path);this.state=loaded.state;this.fileDigest=loaded.fileDigest;
    }

    award(
        username: string,
        skill: string,
        context: XpActivityContext,
        baseXp: number,
        config: DiminishingXpConfig,
        now = Date.now()
    ): DiminishingXpAward {
        const playerKey = username.trim().toLowerCase();
        if (!playerKey) throw new Error('Diminishing XP award requires a player identity');
        const activityKey = buildXpActivityKey(skill, context, config.regionSize);
        xpCohort([playerKey]);
        if(!Number.isFinite(baseXp)||baseXp<0||!Number.isSafeInteger(now)||now<0)throw new Error('Invalid XP award');
        const player = Object.hasOwn(this.state.players,playerKey)?this.state.players[playerKey]!:{activities:{}};
        const previous = Object.hasOwn(player.activities,activityKey)?player.activities[activityKey]:undefined;
        const repetitionScore = previous
            ? decayRepetitionScore(previous.repetitionScore, previous.updatedAt, now, config.recoveryMinutes)
            : 0;
        const multiplier = multiplierForRepetition(Math.ceil(repetitionScore) + 1, config);
        const grantedXp = baseXp === 0 || multiplier === 0 ? 0 : Math.max(1, Math.round(baseXp * multiplier));
        const activity = {
            repetitionScore: repetitionScore + 1,
            updatedAt: now,
            awards: (previous?.awards ?? 0) + 1,
            baseXp: (previous?.baseXp ?? 0) + baseXp,
            grantedXp: (previous?.grantedXp ?? 0) + grantedXp
        };
        const players=canonicalXpPlayers({...this.state.players,[playerKey]:{activities:{...player.activities,[activityKey]:activity}}});
        this.persist({...this.state,players});
        return {
            activityKey, baseXp, grantedXp, multiplier, repetitionScore: repetitionScore + 1,
            nextRecoveryAt: repetitionScore + 1 > 0 ? new Date(now + config.recoveryMinutes * 60_000).toISOString() : null
        };
    }

    summary(): DiminishingXpSummary {
        return {
            playersTracked: Object.keys(this.state.players).length,
            activitiesTracked: Object.values(this.state.players).reduce((total, player) => total + Object.keys(player.activities).length, 0)
        };
    }

    inspect(config: DiminishingXpConfig, now = Date.now(), limit = 100): DiminishingXpActivityView[] {
        const activities: DiminishingXpActivityView[] = [];
        for (const [username, player] of Object.entries(this.state.players)) {
            for (const [activityKey, activity] of Object.entries(player.activities)) {
                const repetitionScore = decayRepetitionScore(
                    activity.repetitionScore,
                    activity.updatedAt,
                    now,
                    config.recoveryMinutes
                );
                activities.push({
                    username,
                    activityKey,
                    repetitionScore,
                    nextMultiplier: multiplierForRepetition(Math.ceil(repetitionScore) + 1, config),
                    updatedAt: new Date(activity.updatedAt).toISOString(),
                    nextRecoveryAt: new Date(now + Math.min(1, repetitionScore) * config.recoveryMinutes * 60_000).toISOString()
                });
            }
        }
        return activities.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, Math.max(1, limit));
    }

    snapshot(cohort:string[],configuration:Record<string,boolean|number|string>,now=Date.now()):XpStateSnapshot{
        this.assertCurrent();parseDiminishingXpConfig(configuration);
        return makeXpStateSnapshot(this.state.players,cohort,xpConfigurationDigest(configuration),xpStateDigest(this.state),new Date(now).toISOString());
    }

    /** Caller must establish that every selected player is offline before changing XP history. */
    applyBaseline(raw:BaselineCommand,configuration:Record<string,boolean|number|string>,now=Date.now()){
        const request=baselineCommand(raw);this.assertCurrent();
        const existing=this.state.audit?.entries.find(entry=>entry.request.commandId===request.commandId);
        if(existing){if(xpStateDigest(existing.request)!==xpStateDigest(request))throw new Error('XP command identity conflict');
            return {receipt:structuredClone(existing),replayed:true,snapshot:this.snapshot(request.cohort,configuration,now)};}
        if(request.expectedStoreDigest!==xpStateDigest(this.state))throw new Error('XP baseline compare-and-set conflict');
        const before=this.snapshot(request.cohort,configuration,now);
        let restored:Record<string,XpPlayerState>={};
        if(request.kind==='restore'){
            const source=this.state.audit?.entries.find(entry=>entry.request.commandId===request.sourceCommandId && entry.request.kind==='reset');
            if(!source || source.before.cohort.join(',')!==request.cohort.join(',') || source.before.configurationDigest!==before.configurationDigest)
                throw new Error('XP restore requires an exact native reset and configuration');
            restored=source.beforePlayers;
        }
        const players=canonicalXpPlayers(Object.fromEntries(Object.entries(this.state.players).filter(([name])=>!request.cohort.includes(name))));
        for(const [name,player] of Object.entries(restored))Object.defineProperty(players,name,{value:structuredClone(player),enumerable:true,configurable:true,writable:true});
        const audit=this.state.audit??{sequence:0,headHash:auditRoot,entries:[]};
        if(audit.entries.length>=10000)throw new Error('XP baseline audit limit reached');
        const after=makeXpStateSnapshot(players,request.cohort,before.configurationDigest,before.storeDigest,before.observedAt);
        const beforePlayers=canonicalXpPlayers(Object.fromEntries(Object.entries(this.state.players).filter(([name])=>request.cohort.includes(name))));
        const body={sequence:audit.sequence+1,request,at:before.observedAt,before,beforePlayers,afterCohortDigest:after.cohortDigest,previousHash:audit.headHash};
        const receipt={...body,hash:xpStateDigest(body)};
        this.persist({schemaVersion:2,players,audit:{sequence:receipt.sequence,headHash:receipt.hash,entries:[...audit.entries,receipt]}});
        return {receipt:structuredClone(receipt),replayed:false,snapshot:this.snapshot(request.cohort,configuration,now)};
    }
    private assertCurrent(){if(rawFileDigest(this.path)!==this.fileDigest)throw new Error('XP state changed outside this runtime; restart required');}
    private persist(next:PersistedState): void {
        mkdirSync(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
        const lock=`${this.path}.lock`;let descriptor:number|undefined;
        try {
            descriptor=openSync(lock,'wx',0o600);this.assertCurrent();
            writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {encoding:'utf8',mode:0o600,flag:'wx'});
            const file=openSync(temporary,'r+');try{fsyncSync(file);}finally{closeSync(file);}
            renameSync(temporary, this.path);
            this.state=next;this.fileDigest=rawFileDigest(this.path);
        } catch (error) {
            try { unlinkSync(temporary); } catch { /* nothing to clean up */ }
            throw error;
        }finally{if(descriptor!==undefined){closeSync(descriptor);try{unlinkSync(lock);}catch{/* A retained lock requires operator recovery, never a competing write. */}}}
    }
}
