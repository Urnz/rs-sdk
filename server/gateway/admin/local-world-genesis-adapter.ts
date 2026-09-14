import { randomUUID } from 'node:crypto';
import { businessGenesisInventoryDigest, validateGenesisAssetAllocation, validateWorldGenesisResult, type GenesisAssetAllocation,
    type WorldGenesisJsonValue, type WorldGenesisResult } from '../../../world-genesis/index.js';
import { listEngineOfflineBackups, requestEngineOfflineEdit, type OfflineSaveDraft,
    type OfflineSaveSummary } from './offline-editor.js';
import { listEngineProperties, requestEnginePropertyGenesisAssignment, requestEnginePropertyReset,
    type AdminPropertyList, type AdminPropertyOwner } from './properties.js';
import type { WorldGenesisAdminAdapter, WorldGenesisAdminPreview } from './world-genesis.js';
import { BusinessManagerStore, type Business, type BusinessGenesisReceipt,
    type BusinessInventoryEntry } from './business-manager.js';
import { InstitutionTreasuryStore, type InstitutionKind, type InstitutionTreasuryAccount,
    type TreasuryGenesisReceipt } from './institution-treasury.js';
import { businessManagerDbPath, institutionTreasuryDbPath } from './paths.js';

export interface LocalGenesisDependencies {
    inspectPlayer(username: string): ReturnType<typeof listEngineOfflineBackups>;
    editPlayer(username: string, draft: OfflineSaveDraft, commandId: string): ReturnType<typeof requestEngineOfflineEdit>;
    listProperties(): Promise<AdminPropertyList>;
    assignProperty(request: Parameters<typeof requestEnginePropertyGenesisAssignment>[0]):
        ReturnType<typeof requestEnginePropertyGenesisAssignment>;
    resetProperty(propertyId: string, expectedVersion: number, commandId: string):
        ReturnType<typeof requestEnginePropertyReset>;
    getBusiness(businessId:string):Business|null;
    getBusinessInventory(businessId:string):BusinessInventoryEntry[];
    createBusiness(allocationId:string,input:{businessId:string;name:string;summary:string;ownerAgentId:string;
        propertyId?:string|null},now:string):BusinessGenesisReceipt;
    resetBusiness(allocationId:string,now:string):BusinessGenesisReceipt|null;
    creditBusinessItem(allocationId:string,businessId:string,itemId:number,count:number,now:string):BusinessInventoryEntry;
    resetBusinessItem(allocationId:string,now:string):BusinessInventoryEntry|null;
    getTreasury(kind:InstitutionKind,id:string):InstitutionTreasuryAccount|null;
    creditTreasury(kind:InstitutionKind,id:string,allocationId:string,amountGp:number,now:string):TreasuryGenesisReceipt;
    resetTreasury(allocationId:string,now:string):TreasuryGenesisReceipt|null;
}

function businessCall<T>(callback:(store:BusinessManagerStore)=>T):T { const store=new BusinessManagerStore(businessManagerDbPath);
    try{return callback(store)}finally{store.close()} }
function treasuryCall<T>(callback:(store:InstitutionTreasuryStore)=>T):T { const store=new InstitutionTreasuryStore(institutionTreasuryDbPath);
    try{return callback(store)}finally{store.close()} }

const defaults: LocalGenesisDependencies = {
    inspectPlayer: listEngineOfflineBackups,
    editPlayer: requestEngineOfflineEdit,
    listProperties: listEngineProperties,
    assignProperty: requestEnginePropertyGenesisAssignment,
    resetProperty: requestEnginePropertyReset,
    getBusiness:id=>businessCall(store=>store.get(id)),
    getBusinessInventory:id=>businessCall(store=>store.listInventory(id)),
    createBusiness:(allocationId,input,now)=>businessCall(store=>store.createGenesis(allocationId,input,now)),
    resetBusiness:(allocationId,now)=>businessCall(store=>store.resetGenesisBusiness(allocationId,now)),
    creditBusinessItem:(allocationId,businessId,itemId,count,now)=>businessCall(store=>
        store.creditGenesisInventory(allocationId,businessId,itemId,count,now)),
    resetBusinessItem:(allocationId,now)=>businessCall(store=>store.resetGenesisInventory(allocationId,now)),
    getTreasury:(kind,id)=>treasuryCall(store=>store.get(kind,id)),
    creditTreasury:(kind,id,allocationId,amountGp,now)=>treasuryCall(store=>
        store.creditGenesis(kind,id,allocationId,amountGp,now)),
    resetTreasury:(allocationId,now)=>treasuryCall(store=>store.resetGenesis(allocationId,now))
};

interface PlayerRollback { username: string; before: OfflineSaveSummary }
interface PropertyRollback { allocationId: string; propertyId: string; owner: AdminPropertyOwner; beforeVersion: number }
interface BusinessRollback { allocationId:string;businessId:string;capitalAllocationId:string|null }
interface LocalRollbackToken { schemaVersion: 1; players: PlayerRollback[]; properties: PropertyRollback[];
    businesses:BusinessRollback[];treasuryAllocationIds:string[];businessStockAllocationIds:string[] }

function assets(resultInput: WorldGenesisResult): GenesisAssetAllocation[] {
    const result = validateWorldGenesisResult(resultInput);
    if (!result.output || typeof result.output !== 'object' || Array.isArray(result.output)
        || !Array.isArray(result.output.assets)) throw new Error('Genesis result output must contain an assets array');
    return result.output.assets.map(validateGenesisAssetAllocation);
}

function playerNames(values: GenesisAssetAllocation[]): string[] {
    return [...new Set(values.filter(asset => (asset.kind === 'currency' || asset.kind === 'item')
        && asset.owner.kind === 'player').map(asset => asset.owner.id))].sort();
}

function add(left: number, right: number, field: string): number {
    const result = left + right;
    if (!Number.isSafeInteger(result) || result > 2_147_483_647) throw new Error(`${field} would overflow`);
    return result;
}

function mergeItems(current: Array<{ id: number; count: number }>, additions: Array<{ itemId: number; count: number }>,
    capacity: number, field: string): Array<{ id: number; count: number }> {
    const counts = new Map<number, number>();
    for (const item of current) counts.set(item.id, add(counts.get(item.id) ?? 0, item.count, field));
    for (const item of additions) counts.set(item.itemId, add(counts.get(item.itemId) ?? 0, item.count, field));
    if (counts.size > capacity) throw new Error(`${field} would exceed its slot capacity`);
    return [...counts].sort(([left], [right]) => left - right).map(([id, count]) => ({ id, count }));
}

function desiredDraft(before: OfflineSaveSummary, allocations: GenesisAssetAllocation[]): OfflineSaveDraft {
    const currency = allocations.filter((asset): asset is Extract<GenesisAssetAllocation, { kind: 'currency' }> =>
        asset.kind === 'currency').reduce((sum, asset) => add(sum, asset.amountGp, 'Player coins'), 0);
    const items = allocations.filter((asset): asset is Extract<GenesisAssetAllocation, { kind: 'item' }> =>
        asset.kind === 'item');
    const equipment = before.equipment.map(item => ({ ...item }));
    for (const item of items.filter(item => item.container === 'equipment')) {
        if (equipment.some(existing => existing.slot === item.slot)) throw new Error('Genesis equipment slot is already occupied');
        equipment.push({ id: item.itemId, count: item.count, slot: item.slot! });
    }
    return { expectedSavedAt: before.savedAt, coins: add(before.coins, currency, 'Player coins'),
        coinPlacement: before.coinPlacement ?? 'bank', skills: before.skills.map(skill => ({ ...skill })),
        inventory: mergeItems(before.inventory, items.filter(item => item.container === 'inventory'), 28, 'Inventory'),
        bank: mergeItems(before.bank, items.filter(item => item.container === 'bank'), 496, 'Bank'),
        equipment: equipment.sort((left, right) => (left.slot ?? -1) - (right.slot ?? -1)),
        position: { ...before.position } };
}

function restoreDraft(before: OfflineSaveSummary, expectedSavedAt: string): OfflineSaveDraft {
    return { expectedSavedAt, coins: before.coins, coinPlacement: before.coinPlacement ?? 'bank',
        skills: before.skills.map(skill => ({ ...skill })), inventory: before.inventory.map(item => ({ ...item })),
        bank: before.bank.map(item => ({ ...item })), equipment: before.equipment.map(item => ({ ...item })),
        position: { ...before.position } };
}

function sameSave(left: OfflineSaveSummary, right: OfflineSaveSummary): boolean {
    const payload = (value: OfflineSaveSummary) => JSON.stringify({ coins: value.coins,
        coinPlacement: value.coinPlacement ?? 'bank', skills: value.skills, inventory: value.inventory,
        bank: value.bank, equipment: value.equipment, position: value.position });
    return payload(left) === payload(right);
}

function rollbackToken(value: WorldGenesisJsonValue): LocalRollbackToken {
    const token = value as unknown as LocalRollbackToken;
    if (!token || token.schemaVersion !== 1 || !Array.isArray(token.players) || !Array.isArray(token.properties)
        || !Array.isArray(token.businesses) || !Array.isArray(token.treasuryAllocationIds)
        || !Array.isArray(token.businessStockAllocationIds)) {
        throw new Error('Local genesis rollback token is invalid');
    }
    return token;
}

export class LocalLostCityWorldGenesisAdapter implements WorldGenesisAdminAdapter {
    constructor(private readonly dependencies: LocalGenesisDependencies = defaults) {}

    private async inspect(result: WorldGenesisResult): Promise<{ preview: WorldGenesisAdminPreview;
        players: PlayerRollback[]; properties: PropertyRollback[]; businesses:BusinessRollback[];
        treasuryAllocationIds:string[];businessStockAllocationIds:string[] }> {
        const allocations = assets(result), warnings: string[] = [], checks: WorldGenesisAdminPreview['checks'] = [];
        const unsupported = allocations.filter(asset => (asset.kind === 'currency'
            && !['player','business','faction'].includes(asset.owner.kind))
            || (asset.kind === 'item' && !((asset.owner.kind === 'player' && asset.container !== 'business-stock')
                || (asset.owner.kind === 'business' && asset.container === 'business-stock')))
            || (asset.kind === 'business' && asset.owner.kind !== 'player'));
        if (unsupported.length) checks.push({ key: 'supported-assets', ok: false,
            message: `Unsupported owner/container combination: ${unsupported.map(item => item.allocationId).join(', ')}` });
        else checks.push({ key: 'supported-assets', ok: true, message: 'All allocations use implemented local adapters.' });

        const businessAssets=allocations.filter((asset):asset is Extract<GenesisAssetAllocation,{kind:'business'}>=>
            asset.kind==='business');
        if(new Set(businessAssets.map(asset=>asset.businessId)).size!==businessAssets.length)
            checks.push({key:'business-identities',ok:false,message:'A business may be created only once per genesis result.'});
        const businesses:BusinessRollback[]=[];
        for(const business of businessAssets){
            const expectedInventory=businessGenesisInventoryDigest(allocations,business.businessId);
            const existing=this.dependencies.getBusiness(business.businessId);
            const ok=!existing&&business.openingInventoryDigest===expectedInventory;
            checks.push({key:`business:${business.businessId}`,ok,message:ok?'Business id and opening inventory digest are available.':
                'Business already exists or opening inventory digest does not match its stock allocations.'});
            const property=allocations.find(asset=>asset.kind==='property'&&asset.owner.kind==='business'
                &&asset.owner.id===business.businessId) as Extract<GenesisAssetAllocation,{kind:'property'}>|undefined;
            businesses.push({allocationId:business.allocationId,businessId:business.businessId,
                capitalAllocationId:business.openingCapitalGp>0?`${business.allocationId}:capital`:null});
            if(property&&property.owner.id!==business.businessId)throw new Error('Genesis business property binding is invalid');
        }

        const createdBusinessIds=new Set(businessAssets.map(asset=>asset.businessId));
        const businessTargetIds=new Set(allocations.filter(asset=>(asset.kind==='currency'||asset.kind==='item')
            &&asset.owner.kind==='business').map(asset=>asset.owner.id));
        for(const businessId of businessTargetIds){
            const existing=this.dependencies.getBusiness(businessId),created=createdBusinessIds.has(businessId);
            checks.push({key:`business-target:${businessId}`,ok:created||!!existing,
                message:created||existing?'Business asset target is available.':'Business asset target does not exist.'});
            if(!created&&existing){
                const current=new Map(this.dependencies.getBusinessInventory(businessId)
                    .map(item=>[item.itemId,item.count] as const));
                try{
                    for(const allocation of allocations)if(allocation.kind==='item'&&allocation.container==='business-stock'
                        &&allocation.owner.kind==='business'&&allocation.owner.id===businessId){
                        current.set(allocation.itemId,add(current.get(allocation.itemId)??0,allocation.count,
                            `Business inventory ${businessId}`));
                    }
                }catch(error){checks.push({key:`business-capacity:${businessId}`,ok:false,
                    message:error instanceof Error?error.message:String(error)});}
            }
        }

        const treasuryAdditions=new Map<string,{kind:'business'|'faction';id:string;amountGp:number}>();
        const addTreasury=(kind:'business'|'faction',id:string,amountGp:number)=>{
            const key=`${kind}:${id}`,current=treasuryAdditions.get(key);
            treasuryAdditions.set(key,{kind,id,amountGp:add(current?.amountGp??0,amountGp,`Treasury ${key}`)});
        };
        try{
            for(const business of businessAssets)if(business.openingCapitalGp>0)
                addTreasury('business',business.businessId,business.openingCapitalGp);
            for(const allocation of allocations)if(allocation.kind==='currency'
                &&(allocation.owner.kind==='business'||allocation.owner.kind==='faction'))
                addTreasury(allocation.owner.kind,allocation.owner.id,allocation.amountGp);
            for(const addition of treasuryAdditions.values()){
                const account=this.dependencies.getTreasury(addition.kind,addition.id);
                add(account?.balanceGp??0,addition.amountGp,`Treasury ${addition.kind}:${addition.id}`);
            }
        }catch(error){checks.push({key:'treasury-capacity',ok:false,
            message:error instanceof Error?error.message:String(error)});}

        const players: PlayerRollback[] = [];
        for (const username of playerNames(allocations)) {
            const inspection = await this.dependencies.inspectPlayer(username);
            const ok = inspection.readiness.editable && !!inspection.state;
            checks.push({ key: `player:${username}`, ok,
                message: ok ? 'Canonical save is offline and editable.' : 'Canonical save must exist and be exclusively offline.' });
            if (inspection.state) {
                const playerAssets = allocations.filter(asset => asset.owner.kind === 'player' && asset.owner.id === username
                    && (asset.kind === 'currency' || asset.kind === 'item'));
                try { desiredDraft(inspection.state, playerAssets); }
                catch (error) { checks.push({ key: `player-capacity:${username}`, ok: false,
                    message: error instanceof Error ? error.message : String(error) }); }
                players.push({ username, before: inspection.state });
            }
        }

        const propertyList = allocations.some(asset => asset.kind === 'property')
            ? await this.dependencies.listProperties() : { enabled: true, properties: [], pendingPurchases: [] };
        const properties: PropertyRollback[] = [];
        for (const allocation of allocations.filter((asset): asset is Extract<GenesisAssetAllocation, { kind: 'property' }> =>
            asset.kind === 'property')) {
            const property = propertyList.properties.find(item => item.propertyId === allocation.propertyId);
            const ownerSupported = allocation.owner.kind !== 'world';
            const ok = propertyList.enabled && ownerSupported && property?.state.status === 'available'
                && property.state.owner === null;
            checks.push({ key: `property:${allocation.propertyId}`, ok,
                message: ok ? 'Property is available for genesis assignment.' : 'Property is missing, disabled, owned or has an unsupported owner.' });
            if (property && ownerSupported) properties.push({ allocationId: allocation.allocationId,
                propertyId: allocation.propertyId, owner: allocation.owner as AdminPropertyOwner,
                beforeVersion: property.state.version });
        }
        if (allocations.length === 0) warnings.push('This genesis result contains no asset mutations.');
        const treasuryAllocationIds=allocations.filter(asset=>asset.kind==='currency'
            && (asset.owner.kind==='business'||asset.owner.kind==='faction')).map(asset=>asset.allocationId);
        const businessStockAllocationIds=allocations.filter(asset=>asset.kind==='item'
            && asset.owner.kind==='business'&&asset.container==='business-stock').map(asset=>asset.allocationId);
        return { preview: { ok: checks.every(check => check.ok), warnings, checks }, players, properties,
            businesses,treasuryAllocationIds,businessStockAllocationIds };
    }

    async preview(result: WorldGenesisResult): Promise<WorldGenesisAdminPreview> {
        return (await this.inspect(result)).preview;
    }

    async prepare(result: WorldGenesisResult): Promise<{ createdAtSimulationTime: string;
        rollbackToken: WorldGenesisJsonValue }> {
        const inspected = await this.inspect(result);
        if (!inspected.preview.ok) throw new Error(`Genesis preflight failed: ${inspected.preview.checks
            .filter(check => !check.ok).map(check => check.message).join('; ')}`);
        return { createdAtSimulationTime: result.simulationClock.initialSimulationTime,
            rollbackToken: { schemaVersion: 1, players: inspected.players as unknown as WorldGenesisJsonValue,
                properties: inspected.properties as unknown as WorldGenesisJsonValue,
                businesses:inspected.businesses as unknown as WorldGenesisJsonValue,
                treasuryAllocationIds:inspected.treasuryAllocationIds,
                businessStockAllocationIds:inspected.businessStockAllocationIds } };
    }

    async apply(result: WorldGenesisResult, tokenValue: WorldGenesisJsonValue): Promise<WorldGenesisJsonValue> {
        const allocations = assets(result), token = rollbackToken(tokenValue);
        const now=result.simulationClock.initialSimulationTime;
        const businessReceipts:WorldGenesisJsonValue[]=[];
        for(const entry of token.businesses){
            const allocation=allocations.find(asset=>asset.kind==='business'&&asset.allocationId===entry.allocationId) as
                Extract<GenesisAssetAllocation,{kind:'business'}>|undefined;
            if(!allocation)throw new Error(`Genesis business allocation disappeared: ${entry.allocationId}`);
            const property=allocations.find(asset=>asset.kind==='property'&&asset.owner.kind==='business'
                &&asset.owner.id===allocation.businessId) as Extract<GenesisAssetAllocation,{kind:'property'}>|undefined;
            businessReceipts.push(this.dependencies.createBusiness(allocation.allocationId,{businessId:allocation.businessId,
                name:allocation.businessId,summary:`World genesis business ${allocation.businessId}.`,
                ownerAgentId:allocation.owner.id,propertyId:property?.propertyId??null},now) as unknown as WorldGenesisJsonValue);
        }
        const treasuryReceipts:WorldGenesisJsonValue[]=[];
        for(const entry of token.businesses){
            const allocation=allocations.find(asset=>asset.kind==='business'&&asset.allocationId===entry.allocationId) as
                Extract<GenesisAssetAllocation,{kind:'business'}>|undefined;
            if(allocation&&entry.capitalAllocationId)treasuryReceipts.push(this.dependencies.creditTreasury('business',
                allocation.businessId,entry.capitalAllocationId,allocation.openingCapitalGp,now) as unknown as WorldGenesisJsonValue);
        }
        for(const allocationId of token.treasuryAllocationIds){
            const allocation=allocations.find(asset=>asset.kind==='currency'&&asset.allocationId===allocationId) as
                Extract<GenesisAssetAllocation,{kind:'currency'}>|undefined;
            if(!allocation||!(allocation.owner.kind==='business'||allocation.owner.kind==='faction'))
                throw new Error(`Genesis treasury allocation disappeared: ${allocationId}`);
            treasuryReceipts.push(this.dependencies.creditTreasury(allocation.owner.kind,allocation.owner.id,
                allocation.allocationId,allocation.amountGp,now) as unknown as WorldGenesisJsonValue);
        }
        const stockReceipts:WorldGenesisJsonValue[]=[];
        for(const allocationId of token.businessStockAllocationIds){
            const allocation=allocations.find(asset=>asset.kind==='item'&&asset.allocationId===allocationId) as
                Extract<GenesisAssetAllocation,{kind:'item'}>|undefined;
            if(!allocation||allocation.owner.kind!=='business'||allocation.container!=='business-stock')
                throw new Error(`Genesis business-stock allocation disappeared: ${allocationId}`);
            stockReceipts.push(this.dependencies.creditBusinessItem(allocation.allocationId,allocation.owner.id,
                allocation.itemId,allocation.count,now) as unknown as WorldGenesisJsonValue);
        }
        const playerReceipts: WorldGenesisJsonValue[] = [];
        for (const player of token.players) {
            const playerAssets = allocations.filter(asset => asset.owner.kind === 'player' && asset.owner.id === player.username
                && (asset.kind === 'currency' || asset.kind === 'item'));
            const draft = desiredDraft(player.before, playerAssets);
            const commandId = randomUUID(), response = await this.dependencies.editPlayer(player.username,
                draft, commandId);
            const expected = response.after ? { ...draft, savedAt: response.after.savedAt,
                position: draft.position!, equipment: draft.equipment! } : null;
            if (!response.after || !response.backupId || !expected || !sameSave(response.after, expected)) {
                throw new Error(`Player genesis edit was not verified: ${player.username}`);
            }
            playerReceipts.push({ username: player.username, commandId, backupId: response.backupId,
                afterSavedAt: response.after.savedAt });
        }
        const propertyReceipts: WorldGenesisJsonValue[] = [];
        for (const property of token.properties) {
            const response = await this.dependencies.assignProperty({ commandId: randomUUID(),
                allocationId: property.allocationId, propertyId: property.propertyId,
                expectedVersion: property.beforeVersion, owner: property.owner });
            propertyReceipts.push(response.assignment as unknown as WorldGenesisJsonValue);
        }
        return { schemaVersion: 1, players: playerReceipts, properties: propertyReceipts,
            businesses:businessReceipts,treasuries:treasuryReceipts,businessStock:stockReceipts };
    }

    async reset(_result: WorldGenesisResult, tokenValue: WorldGenesisJsonValue,
        _applyReceipt: WorldGenesisJsonValue | null): Promise<WorldGenesisJsonValue> {
        const token = rollbackToken(tokenValue), propertyReceipts: WorldGenesisJsonValue[] = [];
        const currentProperties = token.properties.length ? await this.dependencies.listProperties() : null;
        for (const property of [...token.properties].reverse()) {
            const current = currentProperties?.properties.find(item => item.propertyId === property.propertyId);
            if (!current) throw new Error(`Genesis property disappeared before reset: ${property.propertyId}`);
            if (current.state.status === 'available' && current.state.owner === null) continue;
            if (current.state.status !== 'owned' || current.state.version !== property.beforeVersion + 1
                || current.state.owner?.kind !== property.owner.kind || current.state.owner.id !== property.owner.id) {
                throw new Error(`Genesis property changed before reset: ${property.propertyId}`);
            }
            const response = await this.dependencies.resetProperty(property.propertyId, current.state.version, randomUUID());
            propertyReceipts.push({ propertyId: property.propertyId, version: response.property.state.version });
        }
        const stockReceipts:WorldGenesisJsonValue[]=[];
        for(const allocationId of [...token.businessStockAllocationIds].reverse())
            stockReceipts.push(this.dependencies.resetBusinessItem(allocationId, _result.simulationClock.initialSimulationTime) as unknown as WorldGenesisJsonValue);
        const treasuryReceipts:WorldGenesisJsonValue[]=[];
        for(const allocationId of [...token.treasuryAllocationIds].reverse())
            treasuryReceipts.push(this.dependencies.resetTreasury(allocationId,_result.simulationClock.initialSimulationTime) as unknown as WorldGenesisJsonValue);
        for(const business of [...token.businesses].reverse())if(business.capitalAllocationId)
            treasuryReceipts.push(this.dependencies.resetTreasury(business.capitalAllocationId,
                _result.simulationClock.initialSimulationTime) as unknown as WorldGenesisJsonValue);
        const businessReceipts:WorldGenesisJsonValue[]=[];
        for(const business of [...token.businesses].reverse()){
            const treasury=this.dependencies.getTreasury('business',business.businessId);
            if(treasury&&(treasury.balanceGp!==0||treasury.reservedGp!==0))
                throw new Error(`Genesis business treasury changed before reset: ${business.businessId}`);
            businessReceipts.push(this.dependencies.resetBusiness(business.allocationId,
                _result.simulationClock.initialSimulationTime) as unknown as WorldGenesisJsonValue);
        }
        const playerReceipts: WorldGenesisJsonValue[] = [];
        for (const player of [...token.players].reverse()) {
            const inspection = await this.dependencies.inspectPlayer(player.username);
            if (!inspection.readiness.editable || !inspection.state) {
                throw new Error(`Player is not offline/editable for genesis reset: ${player.username}`);
            }
            if (sameSave(inspection.state, player.before)) continue;
            const commandId = randomUUID(), response = await this.dependencies.editPlayer(player.username,
                restoreDraft(player.before, inspection.state.savedAt), commandId);
            if (!response.after || !sameSave(response.after, player.before)) {
                throw new Error(`Player genesis reset was not verified: ${player.username}`);
            }
            playerReceipts.push({ username: player.username, commandId, restoredSavedAt: response.after.savedAt });
        }
        return { schemaVersion: 1, players: playerReceipts, properties: propertyReceipts,
            businesses:businessReceipts,treasuries:treasuryReceipts,businessStock:stockReceipts };
    }
}
