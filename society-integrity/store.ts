import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { validateWorldGenesisResult } from '../world-genesis/result.js';
import { validateGenesisAssetAllocation } from '../world-genesis/provenance.js';
import type { WorldGenesisResult } from '../world-genesis/types.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';

export const SOCIETY_INTEGRITY_SCHEMA_VERSION = 1;
export const SOCIETY_INTEGRITY_SOURCES = ['engine.offline-save', 'engine.player-reward', 'engine.cheat-value', 'engine.debugproc',
    'engine.save-fallback', 'gateway.treasury-balance', 'gateway.treasury-genesis', 'gateway.business-stock-genesis'] as const;
export type IntegritySource = typeof SOCIETY_INTEGRITY_SOURCES[number];
export interface IntegrityMutation { source: IntegritySource; operationId: string; actor: string; payload: unknown }
export interface IntegrityStamp { clockId: string; profileDigest: string; simulationTime: string; wallTime: string }
export interface FoodMutationOrigin { origin: 'bootstrap' | 'import'; runId: string; resultDigest: string;
    clockId: string; profileDigest: string; sourceDigest: string }
export interface IntegrityCompensation {coinsBefore:number;coinsAfter:number;nativeStatus:'rejected'}
export interface IntegrityRun { runId: string; resultDigest: string; result: WorldGenesisResult; genesisAppliedAtSimulationTime:string;
    invalidateOnInjection: boolean; status: 'bootstrapping' | 'observing' | 'reset'; invalidated: boolean }
export interface IntegrityEvent {sequence:number;eventId:string;status:'pending'|'committed'|'no-effect';kind:string;
    stamp?:IntegrityStamp;mutation?:IntegrityMutation;asset?:unknown}
interface RunRow { run_id: string; definition: string; definition_digest: string; status: IntegrityRun['status']; invalidated: number }
interface EventRow { sequence: number; run_id: string; event_id: string; payload: string; previous_hash: string; hash: string;
    status: 'pending' | 'committed' | 'no-effect' }
function timestamp(value: string) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
        throw new Error('Society integrity requires canonical timestamps');
}
function mutationKey(value: IntegrityMutation) {
    if (!SOCIETY_INTEGRITY_SOURCES.includes(value.source) || !value.operationId || value.operationId.length > 200
        || !value.actor || value.actor.length > 150) throw new Error('Society intervention identity is invalid');
    const normalized = JSON.parse(JSON.stringify(value)) as IntegrityMutation;
    if (normalized.payload === undefined) throw new Error('Society intervention payload is missing');
    return normalized;
}
export function saveValueSnapshot(value: { coins: number; skills: Array<{ name: string; experience: number }>;
    inventory: Array<{ id: number; count: number }>; bank: Array<{ id: number; count: number }>;
    equipment: Array<{ id: number; count: number; slot?: number }>; position: { x: number; z: number; level: number } }) {
    return { coins: value.coins, skills: [...value.skills].sort((a,b)=>a.name.localeCompare(b.name)),
        inventory: value.inventory, bank: value.bank, equipment: value.equipment, position: value.position };
}
export function saveCreatesValue(before:Parameters<typeof saveValueSnapshot>[0],after:Parameters<typeof saveValueSnapshot>[0]):boolean {
    const counts=(save:typeof before)=>{
        const values=new Map<number,number>();
        for(const item of [...save.inventory,...save.bank,...save.equipment])values.set(item.id,(values.get(item.id)??0)+item.count);
        return values;
    };
    const previous=counts(before);
    return after.coins>before.coins || [...counts(after)].some(([id,count])=>count>(previous.get(id)??0))
        || after.skills.some(skill=>skill.experience>(before.skills.find(prior=>prior.name===skill.name)?.experience??0));
}

/** A write-ahead integrity journal. Pending cross-store operations never certify a clean run. */
export class SocietyIntegrityStore {
    private readonly db: Database;
    /** Existing single-use bootstrap permit or committed intervention, never an inferred opening balance. */
    foodMutationOrigin(input: IntegrityMutation): FoodMutationOrigin | null {
        this.verify(); const mutation = mutationKey(input);
        if (mutation.source !== 'engine.offline-save') return null;
        const proofs: FoodMutationOrigin[] = [];
        for (const row of this.db.query('SELECT * FROM integrity_run').all() as RunRow[]) {
            const run = this.run(row);
            const permit = this.db.query('SELECT mutation_digest,consumed FROM integrity_permit WHERE run_id=?1 AND operation_id=?2')
                .get(run.runId, mutation.operationId) as { mutation_digest: string; consumed: number } | null;
            const event = this.db.query('SELECT payload,status FROM integrity_event WHERE run_id=?1 AND event_id=?2')
                .get(run.runId, mutation.operationId) as { payload: string; status: string } | null;
            const origin: FoodMutationOrigin['origin'] | null = permit?.consumed === 1 && permit.mutation_digest === digest(mutation) ? 'bootstrap'
                : event?.status === 'committed' && JSON.parse(event.payload).kind === 'runtime-injection'
                    && digest(JSON.parse(event.payload).mutation) === digest(mutation) ? 'import' : null;
            if (origin) {
                const facts = { origin, runId: run.runId, resultDigest: run.resultDigest, clockId: run.result.simulationClock.clockId,
                    profileDigest: run.result.simulationClock.profileDigest };
                proofs.push({ ...facts, sourceDigest: digest({ ...facts, mutation }) });
            }
        }
        if (proofs.length > 1) throw new Error('Food opening belongs to multiple society runs');
        return proofs[0] ?? null;
    }
    constructor(path: string, readOnly=false) {
        if(!readOnly)mkdirSync(dirname(path), { recursive: true });
        this.db = new Database(path, readOnly?{readonly:true,strict:true}:{create:true,strict:true});
        try {
            this.db.run('PRAGMA busy_timeout=5000');
            const version = (this.db.query('PRAGMA user_version').get() as {user_version:number}).user_version;
            if(readOnly){if(version!==1)throw new Error('Society integrity read-only schema is unsupported');return;}
            this.db.run('PRAGMA journal_mode=WAL');
            if (version > 1) throw new Error('Society integrity schema is newer than supported');
            if (version === 0) this.db.transaction(() => {
                this.db.run(`CREATE TABLE integrity_run (run_id TEXT PRIMARY KEY, definition TEXT NOT NULL,
                    definition_digest TEXT NOT NULL, status TEXT NOT NULL, invalidated INTEGER NOT NULL DEFAULT 0)`);
                this.db.run(`CREATE TABLE integrity_event (sequence INTEGER PRIMARY KEY, run_id TEXT NOT NULL,
                    event_id TEXT NOT NULL, payload TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL,
                    status TEXT NOT NULL, UNIQUE(run_id,event_id))`);
                this.db.run(`CREATE TABLE integrity_head (id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL, hash TEXT NOT NULL)`);
                this.db.run(`INSERT INTO integrity_head VALUES(1,0,'${'0'.repeat(64)}')`);
                this.db.run(`CREATE TABLE integrity_permit (run_id TEXT NOT NULL, operation_id TEXT NOT NULL,
                    mutation_digest TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(run_id,operation_id))`);
                this.db.run('PRAGMA user_version=1');
            }).immediate();
        } catch(error) { this.close(); throw error; }
    }
    close() { (this.db as Database & {clearQueryCache():void}).clearQueryCache(); this.db.close(true); }
    private run(row: RunRow): IntegrityRun {
        if (digest(JSON.parse(row.definition)) !== row.definition_digest) throw new Error('Society run binding is corrupt');
        return {...JSON.parse(row.definition), status: row.status, invalidated: row.invalidated === 1};
    }
    get(runId: string): IntegrityRun | null {
        const row = this.db.query('SELECT * FROM integrity_run WHERE run_id=?1').get(runId) as RunRow | null;
        return row ? this.run(row) : null;
    }
    active(): IntegrityRun[] {
        return (this.db.query("SELECT * FROM integrity_run WHERE status IN ('bootstrapping','observing')").all() as RunRow[]).map(row=>this.run(row));
    }
    verify(): void {
        let hash = '0'.repeat(64), sequence = 0;
        for (const row of this.db.query('SELECT * FROM integrity_event ORDER BY sequence').all() as EventRow[]) {
            if(!this.get(row.run_id))throw new Error('Society integrity run coverage is corrupt');
            if (row.sequence !== ++sequence || row.previous_hash !== hash || row.hash !== digest({sequence,
                runId:row.run_id,eventId:row.event_id,payload:JSON.parse(row.payload),previousHash:hash}))
                throw new Error('Society integrity event chain is corrupt');
            hash = row.hash;
        }
        const head = this.db.query('SELECT * FROM integrity_head WHERE id=1').get() as {sequence:number;hash:string}|null;
        if (!head || head.sequence !== sequence || head.hash !== hash) throw new Error('Society integrity event coverage is corrupt');
        for(const row of this.db.query('SELECT * FROM integrity_event').all() as EventRow[]) {
            const payload=JSON.parse(row.payload);
            if(payload.kind==='runtime-injection' && row.status!=='pending') {
                const resolution=this.db.query('SELECT payload FROM integrity_event WHERE run_id=?1 AND event_id=?2')
                    .get(row.run_id,`resolved:${row.event_id}`) as {payload:string}|null;
                if(!resolution || JSON.parse(resolution.payload).outcome!==row.status)throw new Error('Society intervention resolution is corrupt');
            }
            if(payload.kind==='internal-transfer' && row.status==='committed') {
                const resolution=this.db.query('SELECT payload FROM integrity_event WHERE run_id=?1 AND event_id=?2')
                    .get(row.run_id,`resolved:${row.event_id}`) as {payload:string}|null;
                if(!resolution || digest(JSON.parse(resolution.payload).backing)!==digest(payload.backing))throw new Error('Society internal transfer resolution is corrupt');
            }
            if(['genesis-value','genesis-opening-value','genesis-opening-snapshot'].includes(payload.kind) && row.status==='committed'
                && !this.db.query("SELECT 1 FROM integrity_event WHERE run_id=?1 AND event_id='bootstrap-complete'").get(row.run_id))
                throw new Error('Society bootstrap completion is corrupt');
        }
        for(const row of this.db.query('SELECT * FROM integrity_run').all() as RunRow[]) {
            const run=this.run(row);
            if(run.status==='reset' && !this.db.query("SELECT 1 FROM integrity_event WHERE run_id=?1 AND event_id='reset'").get(run.runId))
                throw new Error('Society reset state is corrupt');
            if(run.status==='observing' && !this.db.query("SELECT 1 FROM integrity_event WHERE run_id=?1 AND event_id='bootstrap-complete'").get(run.runId))
                throw new Error('Society observing state is corrupt');
        }
    }
    private append(runId: string, eventId: string, payload: unknown, status: EventRow['status']) {
        const existing = this.db.query('SELECT * FROM integrity_event WHERE run_id=?1 AND event_id=?2').get(runId,eventId) as EventRow|null;
        if (existing) {
            if (digest(JSON.parse(existing.payload)) !== digest(payload)) throw new Error('Society event id was reused with conflicting content');
            return;
        }
        const prior = this.db.query('SELECT * FROM integrity_head WHERE id=1').get() as {sequence:number;hash:string};
        const sequence = prior.sequence+1, hash = digest({sequence,runId,eventId,payload,previousHash:prior.hash});
        this.db.run('INSERT INTO integrity_event VALUES(?1,?2,?3,?4,?5,?6,?7)',[sequence,runId,eventId,JSON.stringify(payload),prior.hash,hash,status]);
        this.db.run('UPDATE integrity_head SET sequence=?1,hash=?2 WHERE id=1',[sequence,hash]);
    }
    begin(resultInput: WorldGenesisResult, invalidateOnInjection: boolean,
        genesisAppliedAtSimulationTime=resultInput.simulationClock.initialSimulationTime): IntegrityRun {
        const result = validateWorldGenesisResult(resultInput);
        if (!['mature-society','historical-burn-in'].includes(result.profile.profileId) || typeof invalidateOnInjection !== 'boolean')
            throw new Error('Society integrity requires an explicit social profile and invalidation setting');
        if (!result.output || Array.isArray(result.output) || typeof result.output !== 'object' || !Array.isArray(result.output.assets))
            throw new Error('Society bootstrap assets are unavailable');
        const assets = result.output.assets.map(validateGenesisAssetAllocation);
        timestamp(genesisAppliedAtSimulationTime);
        if(genesisAppliedAtSimulationTime<result.simulationClock.initialSimulationTime)throw new Error('Society genesis precedes its clock baseline');
        if (new Set(assets.map(asset=>asset.allocationId)).size !== assets.length) throw new Error('Duplicate society bootstrap allocation');
        const valueIds=assets.filter(asset=>asset.kind==='currency'||asset.kind==='item').map(asset=>asset.allocationId);
        valueIds.push(...assets.filter(asset=>asset.kind==='business' && asset.openingCapitalGp>0).map(asset=>`${asset.allocationId}:capital`));
        if(new Set(valueIds).size!==valueIds.length)throw new Error('Society bootstrap capital allocation conflicts');
        const definition = {runId:result.resultId,resultDigest:result.resultDigest,result,invalidateOnInjection,genesisAppliedAtSimulationTime};
        this.db.transaction(()=>{
            this.verify(); const existing = this.get(result.resultId);
            if (existing) {
                const {status:_,invalidated:__,...prior}=existing;
                if (digest(prior) !== digest(definition)) throw new Error('Society run binding conflicts');
                return existing;
            }
            if (this.active().length) throw new Error('Another society integrity run must be reset before new genesis');
            this.db.run("INSERT INTO integrity_run VALUES(?1,?2,?3,'bootstrapping',0)",[result.resultId,JSON.stringify(definition),digest(definition)]);
            for (const asset of assets) {
                if (asset.kind === 'currency' || asset.kind === 'item') this.append(result.resultId,`genesis:${asset.allocationId}`,
                    {kind:'genesis-value',asset,simulationTime:genesisAppliedAtSimulationTime,resultDigest:result.resultDigest},'pending');
                if (asset.kind === 'business' && asset.openingCapitalGp > 0) this.append(result.resultId,`genesis:${asset.allocationId}:capital`,
                    {kind:'genesis-value',asset:{allocationId:`${asset.allocationId}:capital`,kind:'currency',owner:{kind:'business',id:asset.businessId},
                        amountGp:asset.openingCapitalGp},simulationTime:genesisAppliedAtSimulationTime,resultDigest:result.resultDigest},'pending');
            }
            return this.get(result.resultId)!;
        }).immediate();return this.get(result.resultId)!;
    }
    authorize(runId: string, input: IntegrityMutation) {
        const mutation=mutationKey(input);
        this.db.transaction(()=>{
            this.verify(); const run=this.get(runId);
            if(run?.status!=='bootstrapping') throw new Error('Bootstrap permit requires a bootstrapping run');
            const allocations=(run.result.output as {assets:unknown[]}).assets.map(validateGenesisAssetAllocation);
            const payload=mutation.payload as Record<string,unknown>;
            let matches=false;
            if(mutation.source==='gateway.treasury-genesis')matches=allocations.some(asset=>
                asset.kind==='currency' && payload.allocationId===asset.allocationId && payload.amountGp===asset.amountGp
                    && mutation.actor===`${asset.owner.kind}:${asset.owner.id}`
                || asset.kind==='business' && payload.allocationId===`${asset.allocationId}:capital`
                    && payload.amountGp===asset.openingCapitalGp && mutation.actor===`business:${asset.businessId}`);
            if(mutation.source==='gateway.business-stock-genesis')matches=allocations.some(asset=>asset.kind==='item'
                && asset.container==='business-stock' && payload.allocationId===asset.allocationId
                && payload.itemId===asset.itemId && payload.count===asset.count && mutation.actor===`business:${asset.owner.id}`);
            if(mutation.source==='engine.offline-save') {
                const before=payload.before as Parameters<typeof saveValueSnapshot>[0],after=payload.after as typeof before;
                const playerAssets=allocations.filter(asset=>asset.owner.kind==='player' && mutation.actor===`player:${asset.owner.id}`);
                const expectedCoins=before.coins+playerAssets.reduce((sum,asset)=>sum+(asset.kind==='currency'?asset.amountGp:0),0);
                const itemCounts=(items:Array<{id:number;count:number}>)=>{
                    const values=new Map<number,number>();for(const item of items)values.set(item.id,(values.get(item.id)??0)+item.count);
                    return [...values].sort(([a],[b])=>a-b);
                };
                matches=playerAssets.length>0 && after.coins===expectedCoins && digest(before.skills)===digest(after.skills)
                    && digest(before.position)===digest(after.position);
                for(const container of ['inventory','bank','equipment'] as const) {
                    const additions=playerAssets.filter(asset=>asset.kind==='item' && asset.container===container)
                        .map(asset=>({id:(asset as {itemId:number}).itemId,count:(asset as {count:number}).count}));
                    matches=matches && digest(itemCounts([...before[container],...additions]))===digest(itemCounts(after[container]));
                }
            }
            if(!matches)throw new Error('Bootstrap permit is outside declared genesis allocations');
            const prior=this.db.query('SELECT * FROM integrity_permit WHERE run_id=?1 AND operation_id=?2').get(runId,mutation.operationId) as {mutation_digest:string}|null;
            if(prior && prior.mutation_digest!==digest(mutation))throw new Error('Bootstrap permit conflicts');
            if(!prior)this.db.run('INSERT INTO integrity_permit VALUES(?1,?2,?3,0)',[runId,mutation.operationId,digest(mutation)]);
        }).immediate();
    }
    recordOpening(runId:string,actor:string,values:Array<{key:string;value:unknown}>) {
        this.db.transaction(()=>{
            this.verify(); const run=this.get(runId);
            if(run?.status!=='bootstrapping')throw new Error('Opening values require an active bootstrap');
            if(new Set(values.map(value=>value.key)).size!==values.length)throw new Error('Opening value identifiers conflict');
            this.append(runId,`opening:${actor}:snapshot`,{kind:'genesis-opening-snapshot',actor,
                valueCount:values.length,valuesDigest:digest(values),simulationTime:run.genesisAppliedAtSimulationTime},'pending');
            for(const value of values)this.append(runId,`opening:${actor}:${value.key}`,{kind:'genesis-opening-value',actor,
                value:value.value,historicalOrigin:'unknown',simulationTime:run.genesisAppliedAtSimulationTime},'pending');
        }).immediate();
    }
    recordCoverageGap(runId:string,observedAt:IntegrityStamp) {
        this.db.transaction(()=>{
            this.verify();if(this.get(runId)?.status!=='bootstrapping')throw new Error('Legacy observer binding conflicts');
            this.append(runId,'pre-observer-coverage-gap',{kind:'coverage-gap',reason:'observer-started-after-genesis',observedAt},'pending');
        }).immediate();
    }
    finishBootstrap(runId:string) {
        this.db.transaction(()=>{
            this.verify(); const run=this.get(runId); if(!run || run.status==='reset')throw new Error('Society bootstrap is unavailable');
            if(this.db.query('SELECT 1 FROM integrity_permit WHERE run_id=?1 AND consumed=0').get(runId))throw new Error('Society bootstrap receipts are incomplete');
            this.append(runId,'bootstrap-complete',{kind:'bootstrap-complete',resultDigest:run.resultDigest},'committed');
            this.db.run("UPDATE integrity_event SET status='committed' WHERE run_id=?1 AND (event_id LIKE 'genesis:%' OR event_id LIKE 'opening:%')",[runId]);
            this.db.run("UPDATE integrity_run SET status='observing' WHERE run_id=?1",[runId]);
        }).immediate();
    }
    authorizeTransfer(mutation:IntegrityMutation,backing:unknown) {
        if(mutation.source!=='engine.player-reward')throw new Error('Only native player payments can use transfer backing');
        mutation=mutationKey(mutation);
        this.db.transaction(()=>{
            this.verify();
            for(const run of this.active()) {
                const eventId=`internal-transfer:${mutation.operationId}`;
                this.append(run.runId,eventId,{kind:'internal-transfer',mutation,backing},'pending');
                const prior=this.db.query('SELECT mutation_digest FROM integrity_permit WHERE run_id=?1 AND operation_id=?2')
                    .get(run.runId,mutation.operationId) as {mutation_digest:string}|null;
                if(prior && prior.mutation_digest!==digest(mutation))throw new Error('Internal transfer binding conflicts');
                if(!prior)this.db.run('INSERT INTO integrity_permit VALUES(?1,?2,?3,0)',[run.runId,mutation.operationId,digest(mutation)]);
            }
        }).immediate();
    }
    completeTransfer(mutation:IntegrityMutation,backing:unknown) {
        this.db.transaction(()=>{
            this.verify();
            for(const row of this.db.query('SELECT * FROM integrity_event WHERE event_id=?1')
                .all(`internal-transfer:${mutation.operationId}`) as EventRow[]) {
                const original=JSON.parse(row.payload);
                if(digest(original.mutation)!==digest(mutation) || digest(original.backing)!==digest(backing))throw new Error('Internal transfer completion conflicts');
                const permit=this.db.query('SELECT consumed FROM integrity_permit WHERE run_id=?1 AND operation_id=?2')
                    .get(row.run_id,mutation.operationId) as {consumed:number}|null;
                if(!permit?.consumed)throw new Error('Internal transfer has no native credit evidence');
                this.append(row.run_id,`resolved:${row.event_id}`,{kind:'transfer-resolved',operationId:mutation.operationId,backing},'committed');
                this.db.run("UPDATE integrity_event SET status='committed' WHERE run_id=?1 AND event_id=?2",[row.run_id,row.event_id]);
            }
        }).immediate();
    }
    compensateTransfer(mutation:IntegrityMutation,proof:IntegrityCompensation) {
        if(mutation.source!=='engine.player-reward' || proof.nativeStatus!=='rejected'
            || !Number.isSafeInteger(proof.coinsBefore) || proof.coinsBefore<0 || proof.coinsAfter!==proof.coinsBefore)
            throw new Error('Internal transfer compensation is not proven');
        this.db.transaction(()=>{
            this.verify();
            for(const run of this.active()) {
                const original=this.db.query('SELECT payload FROM integrity_event WHERE run_id=?1 AND event_id=?2')
                    .get(run.runId,`internal-transfer:${mutation.operationId}`) as {payload:string}|null;
                if(!original)continue;
                if(digest(JSON.parse(original.payload).mutation)!==digest(mutation))throw new Error('Internal transfer compensation conflicts');
                const permit=this.db.query('SELECT consumed FROM integrity_permit WHERE run_id=?1 AND operation_id=?2')
                    .get(run.runId,mutation.operationId) as {consumed:number}|null;
                if(!permit?.consumed)continue;
                const head=this.db.query('SELECT sequence FROM integrity_head WHERE id=1').get() as {sequence:number};
                this.append(run.runId,`compensated:${mutation.operationId}:${head.sequence+1}`,
                    {kind:'transfer-attempt-compensated',mutation,proof},'committed');
                this.db.run('UPDATE integrity_permit SET consumed=0 WHERE run_id=?1 AND operation_id=?2',[run.runId,mutation.operationId]);
            }
        }).immediate();
    }
    hasTransferBinding(mutation:IntegrityMutation,backing:unknown):boolean {
        this.verify();
        return (this.db.query('SELECT payload FROM integrity_event WHERE event_id=?1').all(`internal-transfer:${mutation.operationId}`) as {payload:string}[])
            .some(row=>{const payload=JSON.parse(row.payload);return digest(payload.mutation)===digest(mutation) && digest(payload.backing)===digest(backing);});
    }
    reset(runId:string) {
        this.db.transaction(()=>{this.verify();if(!this.get(runId))return;
            this.append(runId,'reset',{kind:'reset'},'committed');
            this.db.run("UPDATE integrity_run SET status='reset' WHERE run_id=?1",[runId]);}).immediate();
    }
    before(input:IntegrityMutation,stamp:IntegrityStamp): string[] {
        const mutation=mutationKey(input); timestamp(stamp.simulationTime); timestamp(stamp.wallTime);
        const affected:string[]=[];
        this.db.transaction(()=>{
            this.verify();
            for(const run of this.active()) {
                if(run.result.simulationClock.clockId!==stamp.clockId || run.result.simulationClock.profileDigest!==stamp.profileDigest
                    || stamp.simulationTime<run.genesisAppliedAtSimulationTime)throw new Error('Society intervention clock binding conflicts');
                const permit=this.db.query('SELECT * FROM integrity_permit WHERE run_id=?1 AND operation_id=?2').get(run.runId,mutation.operationId) as
                    {mutation_digest:string;consumed:number}|null;
                const transfer=this.db.query('SELECT 1 FROM integrity_event WHERE run_id=?1 AND event_id=?2')
                    .get(run.runId,`internal-transfer:${mutation.operationId}`);
                if(permit && (run.status==='bootstrapping' || transfer)) {
                    if(permit.consumed || permit.mutation_digest!==digest(mutation))throw new Error('Bootstrap mutation does not match its single-use permit');
                    this.db.run('UPDATE integrity_permit SET consumed=1 WHERE run_id=?1 AND operation_id=?2',[run.runId,mutation.operationId]);
                    continue;
                }
                this.append(run.runId,mutation.operationId,{kind:'runtime-injection',mutation,stamp},'pending');affected.push(run.runId);
            }
        }).immediate();return affected;
    }
    committed(runIds:string[],operationId:string,changed=true,nativeResult:number|null=null) {
        this.db.transaction(()=>{
            this.verify();
            for(const runId of runIds) {
                const run=this.get(runId)!;
                const outcome=changed?'committed':'no-effect';
                this.append(runId,`resolved:${operationId}`,{kind:'intervention-resolved',operationId,outcome,nativeResult},'committed');
                this.db.run('UPDATE integrity_event SET status=?3 WHERE run_id=?1 AND event_id=?2',[runId,operationId,outcome]);
                if(changed && run.invalidateOnInjection)this.db.run('UPDATE integrity_run SET invalidated=1 WHERE run_id=?1',[runId]);
            }
        }).immediate();
    }
    report(runId:string):ReturnType<SocietyIntegrityStore['reportSnapshot']> {
        return this.db.transaction(()=>this.reportSnapshot(runId))();
    }
    /** Read-only seal of the existing audit and mutable resolution/permit state. No new schema or write semantics. */
    coverageSnapshot(runId:string){let snapshot!:{report:ReturnType<SocietyIntegrityStore['reportSnapshot']>;head:{sequence:number;hash:string};permits:unknown[];activeRunIds:string[];stateDigest:string};
        this.db.transaction(()=>{
        if((this.db.query('SELECT COUNT(*) n FROM integrity_event').get() as {n:number}).n>100000)throw Error('Integrity coverage row budget exceeded');
        const report=this.reportSnapshot(runId),head=this.db.query('SELECT sequence,hash FROM integrity_head WHERE id=1').get() as {sequence:number;hash:string},
            permits=this.db.query('SELECT operation_id,mutation_digest,consumed FROM integrity_permit WHERE run_id=? ORDER BY operation_id').all(runId),
            activeRunIds=this.active().map(r=>r.runId).sort(),
            stateDigest=digest({report,permits,activeRunIds,head});
        snapshot={report,permits,head,activeRunIds,stateDigest};
    }).deferred();return snapshot;}
    private reportSnapshot(runId:string) {
        this.verify(); const run=this.get(runId); if(!run)throw new Error('Society integrity run is unavailable');
        const events=(this.db.query('SELECT * FROM integrity_event WHERE run_id=?1 ORDER BY sequence').all(runId) as EventRow[])
            .map((row):IntegrityEvent=>({sequence:row.sequence,eventId:row.event_id,status:row.status,...JSON.parse(row.payload)}));
        const injections=events.filter(event=>event.kind==='runtime-injection' && event.status==='committed');
        const incomplete=run.status!=='observing' || events.some(event=>event.status==='pending');
        if(run.invalidated!==(run.invalidateOnInjection && injections.length>0))throw new Error('Society invalidation state is corrupt');
        return {run,events,injectionCount:injections.length,cleanRunStatus:injections.length?'contaminated':incomplete?'unverified':'no-detected-injection',
            passesObservedInjectionGate:injections.length===0 && !incomplete,
            eligibleUnderInvalidationPolicy:!run.invalidated && !incomplete, coverage:{sources:SOCIETY_INTEGRITY_SOURCES,
                claim:'instrumented-local-mutation-boundaries',unobservedHistory:'unavailable'}};
    }
}
