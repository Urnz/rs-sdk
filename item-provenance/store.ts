import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { ThievingOutcomeReceipt } from '../thieving-procedures/types.js';
import { itemProvenancePolicyDigest, resolveItemProvenanceRule } from './policy.js';
import type { ItemParty, ItemProvenanceAsset, ItemProvenanceEvent, ItemProvenanceEventKind,
    ItemProvenanceEvidence, ItemProvenancePolicyCatalog, ItemProvenanceVerifier, ItemRestitutionClaim,
    ItemTheftVerifier, ItemTransformationRecord, ItemTransformationVerifier, RecordItemTheft,
    RegisterProvenanceAsset, TransformProvenanceAssets, TransferItemCustody, TransferItemTitle } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, DIGEST = /^[0-9a-f]{64}$/, ZERO = '0'.repeat(64);
type AssetRow = { asset_id: string; tier: 'provenance-lot' | 'identified-asset'; state_mode: 'batch' | 'instance';
    item_id: number; quantity: number; title_kind: ItemParty['kind']; title_id: string; holder_kind: ItemParty['kind'];
    holder_id: string; provenance_root_digest: string; theft_history_count: number; created_at: string;
    updated_at: string; revision: number; lifecycle_status: 'active'|'consumed';
    consumed_by_transformation_id: string|null };
type EventRow = { event_id: string; evidence_id: string; kind: ItemProvenanceEventKind; asset_id: string | null;
    item_id: number; quantity: number; title_before_json: string | null; title_after_json: string;
    holder_before_json: string | null; holder_after_json: string; source_domain: ItemProvenanceEvent['sourceDomain'];
    source_record_id: string; source_state_version: number; source_evidence_digest: string; occurred_at: string;
    request_digest: string; event_digest: string; recorded_at: string };
type ClaimRow = { claim_id: string; event_id: string; item_id: number; quantity: number;
    title_kind: ItemParty['kind']; title_id: string; liable_actor_agent_id: string; unit_value_coins: number;
    amount_coins: number; status: 'open'; created_at: string };
type ClaimAuditRow = { claim_id: string; claim_digest: string; origin: 'v2-write' | 'legacy-v1-snapshot';
    recorded_at: string; previous_hash: string; entry_hash: string };
type TransformationRow = { transformation_id:string;business_id:string;input_asset_ids_json:string;
    output_asset_ids_json:string;source_record_id:string;evidence_json:string;request_json:string;request_digest:string;
    transformation_digest:string;recorded_at:string };
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function id(value: string, field: string): string { if (typeof value !== 'string' || !ID.test(value)) {
    throw new Error(`${field} is invalid`); } return value; }
function timestamp(value: string, field: string): string { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) throw new Error(`${field} is invalid`); return value; }
function integer(value: number, field: string, minimum = 1): number { if (!Number.isSafeInteger(value) || value < minimum
    || value > 2_147_483_647) throw new Error(`${field} is invalid`); return value; }
function party(value: ItemParty, field: string): ItemParty { if (!value || typeof value !== 'object'
    || Object.keys(value).sort().join(',') !== 'id,kind' || !['agent', 'business', 'faction'].includes(value.kind)) {
    throw new Error(`${field} is invalid`); } return { kind: value.kind, id: id(value.id, `${field}.id`) }; }
function same(left: ItemParty, right: ItemParty): boolean { return left.kind === right.kind && left.id === right.id; }
function asset(row: AssetRow): ItemProvenanceAsset { return { assetId: row.asset_id, tier: row.tier,
    stateMode: row.state_mode, itemId: row.item_id, quantity: row.quantity,
    titleOwner: { kind: row.title_kind, id: row.title_id }, holder: { kind: row.holder_kind, id: row.holder_id },
    provenanceRootDigest: row.provenance_root_digest, theftHistoryCount: row.theft_history_count,
    lifecycleStatus: row.lifecycle_status, consumedByTransformationId: row.consumed_by_transformation_id,
    createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision }; }
function transformation(row:TransformationRow):ItemTransformationRecord{return{transformationId:row.transformation_id,
    businessId:row.business_id,inputAssetIds:JSON.parse(row.input_asset_ids_json) as string[],
    outputAssetIds:JSON.parse(row.output_asset_ids_json) as string[],
    evidence:JSON.parse(row.evidence_json),transformationDigest:row.transformation_digest,recordedAt:row.recorded_at}}
function event(row: EventRow): ItemProvenanceEvent { return { eventId: row.event_id, evidenceId: row.evidence_id,
    kind: row.kind, assetId: row.asset_id, itemId: row.item_id, quantity: row.quantity,
    titleBefore: row.title_before_json === null ? null : JSON.parse(row.title_before_json) as ItemParty,
    titleAfter: JSON.parse(row.title_after_json) as ItemParty,
    holderBefore: row.holder_before_json === null ? null : JSON.parse(row.holder_before_json) as ItemParty,
    holderAfter: JSON.parse(row.holder_after_json) as ItemParty, sourceDomain: row.source_domain,
    sourceRecordId: row.source_record_id, sourceStateVersion: row.source_state_version,
    sourceEvidenceDigest: row.source_evidence_digest, occurredAt: row.occurred_at,
    eventDigest: row.event_digest, recordedAt: row.recorded_at }; }
function claim(row: ClaimRow): ItemRestitutionClaim { return { claimId: row.claim_id, eventId: row.event_id,
    itemId: row.item_id, quantity: row.quantity, titleOwner: { kind: row.title_kind, id: row.title_id },
    liableActorAgentId: row.liable_actor_agent_id, unitValueCoins: row.unit_value_coins,
    amountCoins: row.amount_coins, status: row.status, createdAt: row.created_at }; }

export class ItemProvenanceStore {
    private readonly database: Database;
    constructor(path: string, private readonly policy: ItemProvenancePolicyCatalog) {
        const { digest, ...definition } = policy;
        if (digest !== itemProvenancePolicyDigest(definition)) throw new Error('Item provenance policy digest mismatch');
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        try { this.database.run('PRAGMA foreign_keys = ON'); this.migrate(); }
        catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    getAsset(assetIdInput: string): ItemProvenanceAsset | null { const row = this.database.query(
        'SELECT * FROM item_provenance_asset WHERE asset_id=?1').get(id(assetIdInput, 'assetId')) as AssetRow | null;
        return row ? asset(row) : null; }
    getEvent(eventIdInput: string): ItemProvenanceEvent | null { const row = this.database.query(
        'SELECT * FROM item_provenance_event WHERE event_id=?1').get(id(eventIdInput, 'eventId')) as EventRow | null;
        return row ? event(row) : null; }
    getClaim(claimIdInput: string): ItemRestitutionClaim | null { const claimId = id(claimIdInput, 'claimId');
        if (!this.verifyAuditChain()) throw new Error('Item provenance claim audit is invalid');
        const row = this.database.query('SELECT * FROM item_restitution_claim WHERE claim_id=?1')
            .get(claimId) as ClaimRow | null;
        if (!row) return null;
        const audit = this.database.query('SELECT origin FROM item_restitution_claim_audit WHERE claim_id=?1')
            .get(claimId) as Pick<ClaimAuditRow, 'origin'> | null;
        if (audit?.origin !== 'v2-write') throw new Error('Legacy restitution claim is not historically authenticated');
        return claim(row); }
    listEvents(assetIdInput: string): ItemProvenanceEvent[] { return (this.database.query(
        'SELECT * FROM item_provenance_event WHERE asset_id=?1 ORDER BY occurred_at,event_id')
        .all(id(assetIdInput, 'assetId')) as EventRow[]).map(event); }
    getTransformation(transformationIdInput:string):ItemTransformationRecord|null{
        if(!this.verifyTransformationAuditChain())throw new Error('Item transformation audit is invalid');
        const row=this.database.query('SELECT * FROM item_transformation WHERE transformation_id=?1')
            .get(id(transformationIdInput,'transformationId')) as TransformationRow|null;return row?transformation(row):null}
    /** Historical transitive ancestry. Consumed assets remain readable and cannot be detached from descendants. */
    listAncestorAssetIds(assetIdInput:string):string[]{const assetId=id(assetIdInput,'assetId');
        if(!this.verifyTransformationAuditChain())throw new Error('Item transformation audit is invalid');
        return(this.database.query(`WITH RECURSIVE ancestry(asset_id) AS(
            SELECT input_asset_id FROM item_transformation_lineage WHERE output_asset_id=?1
            UNION SELECT l.input_asset_id FROM item_transformation_lineage l JOIN ancestry a ON l.output_asset_id=a.asset_id)
            SELECT asset_id FROM ancestry ORDER BY asset_id`).all(assetId) as Array<{asset_id:string}>).map(row=>row.asset_id)}
    /**
     * Exact crafting transition for a shared Business/provenance SQLite database. Aggregate stock and
     * provenance are changed in one IMMEDIATE transaction; any failure rolls both back.
     */
    transform(input:TransformProvenanceAssets,verify?:ItemTransformationVerifier,
        recordedAtInput=new Date().toISOString()):ItemTransformationRecord{
        const transformationId=id(input.transformationId,'transformationId'),businessId=id(input.businessId,'businessId'),
            recordedAt=timestamp(recordedAtInput,'recordedAt');
        if(!Array.isArray(input.inputs)||input.inputs.length<1||input.inputs.length>100
            ||!Array.isArray(input.outputs)||input.outputs.length<1||input.outputs.length>100)
            throw new Error('Item transformation assets are invalid');
        const inputs=input.inputs.map((value,index)=>({assetId:id(value.assetId,`inputs[${index}].assetId`),
            expectedRevision:integer(value.expectedRevision,`inputs[${index}].expectedRevision`),
            storageId:value.storageId===null?null:id(value.storageId,`inputs[${index}].storageId`)}));
        const outputs=input.outputs.map((value,index)=>({assetId:id(value.assetId,`outputs[${index}].assetId`),
            itemId:integer(value.itemId,`outputs[${index}].itemId`,0),quantity:integer(value.quantity,`outputs[${index}].quantity`),
            storageId:value.storageId===null?null:id(value.storageId,`outputs[${index}].storageId`)}));
        if(new Set(inputs.map(value=>value.assetId)).size!==inputs.length
            ||new Set(outputs.map(value=>value.assetId)).size!==outputs.length
            ||outputs.some(value=>inputs.some(source=>source.assetId===value.assetId)))
            throw new Error('Item transformation asset ids must be distinct');
        const evidence={sourceRecordId:id(input.evidence.sourceRecordId,'sourceRecordId'),
            recipeId:id(input.evidence.recipeId,'recipeId'),recipeVersion:id(input.evidence.recipeVersion,'recipeVersion'),
            recipeCatalogDigest:input.evidence.recipeCatalogDigest,sourceEvidenceDigest:input.evidence.sourceEvidenceDigest,
            occurredAt:timestamp(input.evidence.occurredAt,'occurredAt')};
        if(!DIGEST.test(evidence.recipeCatalogDigest)||!DIGEST.test(evidence.sourceEvidenceDigest))
            throw new Error('Item transformation evidence is invalid');
        const normalized={transformationId,businessId,inputs,outputs,evidence};
        if(!verify?.(Object.freeze(structuredClone(normalized))))throw new Error('Item transformation evidence is not trusted');
        if(!this.verifyAuditChain())throw new Error('Item provenance audit is invalid');
        const requestDigest=hash(normalized),existing=this.database.query(
            'SELECT * FROM item_transformation WHERE transformation_id=?1').get(transformationId) as TransformationRow|null;
        if(existing){if(existing.request_digest!==requestDigest)throw new Error('Item transformation id was reused');return transformation(existing)}
        if(!this.database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_inventory'").get()
            ||!this.database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_storage_item'").get())
            throw new Error('Atomic transformation requires the shared Business inventory database');
        const sourceAssets=inputs.map(value=>{const current=this.getAsset(value.assetId);
            if(!current||current.revision!==value.expectedRevision||current.lifecycleStatus!=='active'
                ||current.holder.kind!=='business'||current.holder.id!==businessId)
                throw new Error('Transformation input asset is unavailable or changed');return current});
        const title=sourceAssets[0]!.titleOwner;
        if(sourceAssets.some(value=>!same(value.titleOwner,title)))
            throw new Error('Transformation cannot collapse distinct title claims');
        const theftHistoryCount=sourceAssets.reduce((sum,value)=>sum+value.theftHistoryCount,0);
        for(const value of outputs){if(this.getAsset(value.assetId))throw new Error('Transformation output asset id was reused');
            const rule=resolveItemProvenanceRule(this.policy,value.itemId);
            if(rule.tier==='value-restitution')throw new Error('Transformation output requires tracked provenance policy');
            if(rule.tier==='identified-asset'&&value.quantity!==1)throw new Error('Identified transformation outputs require quantity one')}
        const transformationDigest=hash({transformationId,businessId,inputAssetIds:inputs.map(value=>value.assetId),
            outputAssetIds:outputs.map(value=>value.assetId),evidence}),rootDigest=hash({kind:'transformation',transformationDigest,
                parents:sourceAssets.map(value=>({assetId:value.assetId,provenanceRootDigest:value.provenanceRootDigest})).sort((a,b)=>a.assetId.localeCompare(b.assetId))});
        const transaction=this.database.transaction(()=>{
            for(const [index,value] of inputs.entries())this.debitBusinessStock(businessId,value.storageId,
                sourceAssets[index]!.itemId,sourceAssets[index]!.quantity,evidence.occurredAt);
            for(const value of outputs)this.creditBusinessStock(businessId,value.storageId,value.itemId,value.quantity,evidence.occurredAt);
            for(const value of sourceAssets){const changed=this.database.run(`UPDATE item_provenance_asset SET lifecycle_status='consumed',
                consumed_by_transformation_id=?2,updated_at=?3,revision=revision+1 WHERE asset_id=?1 AND revision=?4 AND lifecycle_status='active'`,
            [value.assetId,transformationId,evidence.occurredAt,value.revision]);if(changed.changes!==1)
                throw new Error('Transformation input asset changed before commit')}
            for(const value of outputs){const rule=resolveItemProvenanceRule(this.policy,value.itemId);
                this.database.run(`INSERT INTO item_provenance_asset(asset_id,tier,state_mode,item_id,quantity,title_kind,title_id,
                    holder_kind,holder_id,provenance_root_digest,theft_history_count,created_at,updated_at,revision,
                    lifecycle_status,consumed_by_transformation_id) VALUES(?1,?2,?3,?4,?5,?6,?7,'business',?8,?9,?10,?11,?11,1,'active',NULL)`,
                [value.assetId,rule.tier,rule.tier==='identified-asset'?'instance':'batch',value.itemId,value.quantity,
                    title.kind,title.id,businessId,rootDigest,theftHistoryCount,evidence.occurredAt])}
            this.database.run(`INSERT INTO item_transformation VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
                [transformationId,businessId,JSON.stringify(inputs.map(value=>value.assetId)),JSON.stringify(outputs.map(value=>value.assetId)),
                    evidence.sourceRecordId,JSON.stringify(evidence),JSON.stringify(normalized),requestDigest,transformationDigest,recordedAt]);
            for(const output of outputs)for(const source of sourceAssets)this.database.run(
                'INSERT INTO item_transformation_lineage VALUES(?1,?2,?3)',[transformationId,output.assetId,source.assetId]);
            const previous=(this.database.query('SELECT entry_hash FROM item_transformation_audit ORDER BY sequence DESC LIMIT 1')
                .get() as{entry_hash:string}|null)?.entry_hash??ZERO,payload={transformationId,transformationDigest,recordedAt};
            this.database.run(`INSERT INTO item_transformation_audit(transformation_id,transformation_digest,recorded_at,previous_hash,entry_hash)
                VALUES(?1,?2,?3,?4,?5)`,[transformationId,transformationDigest,recordedAt,previous,hash({previousHash:previous,payload})]);
        });transaction.immediate();return this.getTransformation(transformationId)!}
    register(input: RegisterProvenanceAsset, verify?: ItemProvenanceVerifier,
        recordedAtInput = new Date().toISOString()): ItemProvenanceAsset {
        const eventId = id(input.eventId, 'eventId'), assetId = id(input.assetId, 'assetId');
        const itemId = integer(input.itemId, 'itemId', 0), quantity = integer(input.quantity, 'quantity');
        const titleOwner = party(input.titleOwner, 'titleOwner'), holder = party(input.holder, 'holder');
        const evidence = this.evidence(input.evidence), recordedAt = timestamp(recordedAtInput, 'recordedAt');
        if (!verify?.(evidence)) throw new Error('Item provenance evidence is not trusted');
        const rule = resolveItemProvenanceRule(this.policy, itemId);
        if (rule.tier === 'value-restitution') throw new Error('Value-restitution items cannot be registered as assets');
        if (rule.tier === 'identified-asset' && quantity !== 1) throw new Error('Identified assets require quantity one');
        const requestDigest = hash({ kind: 'registered', assetId, itemId, quantity, titleOwner, holder, evidence });
        const replay = this.replay(eventId, requestDigest); if (replay) return this.getAsset(assetId)!;
        if (this.getAsset(assetId)) throw new Error('Item provenance asset id was reused');
        const stateMode = rule.tier === 'identified-asset' ? 'instance' : 'batch';
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO item_provenance_asset(asset_id,tier,state_mode,item_id,quantity,title_kind,title_id,
                holder_kind,holder_id,provenance_root_digest,theft_history_count,created_at,updated_at,revision,
                lifecycle_status,consumed_by_transformation_id)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,0,?11,?11,1,'active',NULL)`,
            [assetId, rule.tier, stateMode, itemId, quantity, titleOwner.kind, titleOwner.id, holder.kind, holder.id,
                evidence.sourceEvidenceDigest, evidence.occurredAt]);
            this.insertEvent({ eventId, evidenceId: evidence.evidenceId, kind: 'registered', assetId, itemId, quantity,
                titleBefore: null, titleAfter: titleOwner, holderBefore: null, holderAfter: holder,
                sourceDomain: evidence.sourceDomain, sourceRecordId: evidence.sourceRecordId,
                sourceStateVersion: evidence.sourceStateVersion, sourceEvidenceDigest: evidence.sourceEvidenceDigest,
                occurredAt: evidence.occurredAt }, requestDigest, recordedAt);
        }); transaction.immediate(); return this.getAsset(assetId)!;
    }
    transferTitle(input: TransferItemTitle, verify?: ItemProvenanceVerifier,
        recordedAtInput = new Date().toISOString()): ItemProvenanceAsset {
        return this.transfer('title-transferred', input, verify, recordedAtInput);
    }
    transferCustody(input: TransferItemCustody, verify?: ItemProvenanceVerifier,
        recordedAtInput = new Date().toISOString()): ItemProvenanceAsset {
        return this.transfer('custody-transferred', input, verify, recordedAtInput);
    }
    recordTheft(input: RecordItemTheft, receipt: ThievingOutcomeReceipt, verify?: ItemTheftVerifier,
        recordedAtInput = new Date().toISOString()): ItemProvenanceEvent {
        const eventId = id(input.eventId, 'eventId'), itemId = integer(input.itemId, 'itemId', 0);
        const quantity = integer(input.quantity, 'quantity'), titleOwner = party(input.titleOwner, 'titleOwner');
        const previousHolder = party(input.previousHolder, 'previousHolder'), thief = id(input.thiefAgentId, 'thiefAgentId');
        const recordedAt = timestamp(recordedAtInput, 'recordedAt'), rule = resolveItemProvenanceRule(this.policy, itemId);
        if (!verify?.(receipt, input) || receipt.result !== 'succeeded' || receipt.effect !== 'item-transfer'
            || receipt.actorAgentId !== thief || !receipt.transferredItems.some(item => item.itemId === itemId
                && item.quantity === quantity)) throw new Error('Item theft requires trusted exact Thieving evidence');
        if ((titleOwner.kind === 'agent' && titleOwner.id === thief)
            || (previousHolder.kind === 'agent' && previousHolder.id === thief)) throw new Error('Self-owned transfer is not theft');
        const sourceEvidenceDigest = receipt.receiptDigest, evidenceId = `theft-${hash({ receiptId: receipt.receiptId,
            itemId }).slice(0, 32)}`, holderAfter: ItemParty = { kind: 'agent', id: thief };
        const requestDigest = hash({ kind: 'stolen', input, receiptId: receipt.receiptId, sourceEvidenceDigest });
        const replay = this.replay(eventId, requestDigest); if (replay) return replay;
        let assetState: ItemProvenanceAsset | null = null, claimId: string | null = null, amountCoins: number | null = null;
        if (rule.tier === 'value-restitution') {
            if (input.assetId !== null || input.expectedRevision !== null || input.claimId === null
                || input.unitValueCoins === null) throw new Error('Fungible theft requires a value claim without asset identity');
            claimId = id(input.claimId, 'claimId'); const unit = integer(input.unitValueCoins, 'unitValueCoins');
            amountCoins = quantity * unit; if (!Number.isSafeInteger(amountCoins) || amountCoins > 2_147_483_647) {
                throw new Error('Restitution amount is invalid');
            }
        } else {
            if (input.assetId === null || input.expectedRevision === null || input.claimId !== null
                || input.unitValueCoins !== null) throw new Error('Tracked theft requires an asset without synthetic value');
            assetState = this.getAsset(input.assetId); if (!assetState || assetState.lifecycleStatus!=='active'||assetState.itemId !== itemId
                || assetState.quantity !== quantity || assetState.revision !== input.expectedRevision
                || !same(assetState.titleOwner, titleOwner) || !same(assetState.holder, previousHolder)) {
                throw new Error('Tracked item ownership or custody snapshot does not match');
            }
        }
        const eventValue = { eventId, evidenceId, kind: 'stolen' as const, assetId: assetState?.assetId ?? null,
            itemId, quantity, titleBefore: titleOwner, titleAfter: titleOwner, holderBefore: previousHolder,
            holderAfter, sourceDomain: 'thieving-procedures' as const, sourceRecordId: receipt.receiptId,
            sourceStateVersion: 1, sourceEvidenceDigest, occurredAt: receipt.occurredAt };
        const transaction = this.database.transaction(() => {
            if (assetState) { const changed = this.database.run(`UPDATE item_provenance_asset SET holder_kind='agent',
                holder_id=?3,theft_history_count=theft_history_count+1,updated_at=?4,revision=revision+1
                WHERE asset_id=?1 AND revision=?2`, [assetState.assetId, assetState.revision, thief, receipt.occurredAt]);
                if (changed.changes !== 1) throw new Error('Item provenance asset changed before theft'); }
            this.insertEvent(eventValue, requestDigest, recordedAt);
            if (claimId !== null && amountCoins !== null) {
                this.database.run(`INSERT INTO item_restitution_claim VALUES(
                    ?1,?2,?3,?4,?5,?6,?7,?8,?9,'open',?10)`, [claimId, eventId, itemId, quantity, titleOwner.kind,
                    titleOwner.id, thief, input.unitValueCoins, amountCoins, receipt.occurredAt]);
                this.insertClaimAudit(claimId, 'v2-write', recordedAt);
            }
        }); transaction.immediate(); return this.getEvent(eventId)!;
    }
    verifyAuditChain(): boolean {
        return this.verifyEventAuditChain()&&this.verifyClaimAuditChain()&&this.verifyTransformationAuditChain();
    }
    private verifyClaimAuditChain():boolean{try{
        const rows = this.database.query('SELECT * FROM item_restitution_claim_audit ORDER BY sequence')
            .all() as ClaimAuditRow[];
        const count = this.database.query('SELECT COUNT(*) AS claims FROM item_restitution_claim').get() as { claims: number };
        if (rows.length !== count.claims) return false;
        let previous = ZERO;
        for (const row of rows) {
            const source = this.database.query('SELECT * FROM item_restitution_claim WHERE claim_id=?1')
                .get(row.claim_id) as ClaimRow | null;
            if (!source || !['v2-write', 'legacy-v1-snapshot'].includes(row.origin)) return false;
            const value = claim(source), theft = this.getEvent(value.eventId);
            if (!theft || theft.kind !== 'stolen' || theft.assetId !== null || theft.itemId !== value.itemId
                || theft.quantity !== value.quantity || !same(theft.titleAfter, value.titleOwner)
                || theft.holderAfter.kind !== 'agent' || theft.holderAfter.id !== value.liableActorAgentId
                || !Number.isSafeInteger(value.amountCoins) || value.amountCoins !== value.quantity * value.unitValueCoins
                || row.claim_digest !== hash(value) || row.previous_hash !== previous
                || row.entry_hash !== hash({ previousHash: previous, claimId: row.claim_id,
                    claimDigest: row.claim_digest, origin: row.origin, recordedAt: row.recorded_at })) return false;
            previous = row.entry_hash;
        }
        return true;}catch{return false}}
    private verifyTransformationAuditChain():boolean{try{const rows=this.database.query(
            'SELECT * FROM item_transformation ORDER BY rowid').all() as TransformationRow[],audits=this.database.query(
            'SELECT * FROM item_transformation_audit ORDER BY sequence').all() as Array<{transformation_id:string;
                transformation_digest:string;recorded_at:string;previous_hash:string;entry_hash:string}>;
        if(rows.length!==audits.length)return false;const byId=new Map(rows.map(row=>[row.transformation_id,row]));let previous=ZERO;
        for(const audit of audits){const row=byId.get(audit.transformation_id);if(!row)return false;
            const request=JSON.parse(row.request_json) as TransformProvenanceAssets,record=transformation(row);
            if(hash(request)!==row.request_digest||request.transformationId!==row.transformation_id
                ||request.businessId!==row.business_id||JSON.stringify(request.inputs.map(value=>value.assetId))!==row.input_asset_ids_json
                ||JSON.stringify(request.outputs.map(value=>value.assetId))!==row.output_asset_ids_json
                ||request.evidence.sourceRecordId!==row.source_record_id
                ||JSON.stringify(request.evidence)!==row.evidence_json
                ||hash({transformationId:record.transformationId,businessId:record.businessId,
                    inputAssetIds:record.inputAssetIds,outputAssetIds:record.outputAssetIds,evidence:record.evidence})!==row.transformation_digest
                ||audit.transformation_digest!==row.transformation_digest||audit.recorded_at!==row.recorded_at
                ||audit.previous_hash!==previous)return false;
            const payload={transformationId:row.transformation_id,transformationDigest:row.transformation_digest,
                recordedAt:row.recorded_at};if(audit.entry_hash!==hash({previousHash:previous,payload}))return false;
            const lineage=this.database.query(`SELECT output_asset_id,input_asset_id FROM item_transformation_lineage
                WHERE transformation_id=?1 ORDER BY output_asset_id,input_asset_id`).all(row.transformation_id) as
                Array<{output_asset_id:string;input_asset_id:string}>;
            const expected=record.outputAssetIds.flatMap(outputAssetId=>record.inputAssetIds.map(inputAssetId=>
                ({output_asset_id:outputAssetId,input_asset_id:inputAssetId}))).sort((a,b)=>a.output_asset_id.localeCompare(b.output_asset_id)
                    ||a.input_asset_id.localeCompare(b.input_asset_id));
            if(JSON.stringify(lineage)!==JSON.stringify(expected))return false;
            const inputAssets=record.inputAssetIds.map(assetId=>this.getAsset(assetId));
            if(inputAssets.some(value=>!value||value.lifecycleStatus!=='consumed'
                ||value.consumedByTransformationId!==record.transformationId))return false;
            const parents=inputAssets.map(value=>({assetId:value!.assetId,provenanceRootDigest:value!.provenanceRootDigest}))
                .sort((a,b)=>a.assetId.localeCompare(b.assetId)),rootDigest=hash({kind:'transformation',
                    transformationDigest:record.transformationDigest,parents});
            if(record.outputAssetIds.some(assetId=>{const output=this.getAsset(assetId);
                return!output||output.provenanceRootDigest!==rootDigest}))return false;
            previous=audit.entry_hash}return true}catch{return false}}
    private verifyEventAuditChain(): boolean { const rows = this.database.query('SELECT * FROM item_provenance_audit ORDER BY sequence')
        .all() as Array<{ event_id: string; event_digest: string; recorded_at: string; previous_hash: string; entry_hash: string }>;
        const count = this.database.query('SELECT COUNT(*) AS events FROM item_provenance_event').get() as { events: number };
        if (rows.length !== count.events) return false;
        let previous = ZERO; for (const row of rows) { const source = this.getEvent(row.event_id); if (!source) return false;
            const { eventDigest, recordedAt, ...facts } = source, payload = { eventId: source.eventId, eventDigest, recordedAt };
            if (eventDigest !== row.event_digest || hash(facts) !== eventDigest || row.previous_hash !== previous
                || hash({ previousHash: previous, payload }) !== row.entry_hash) return false; previous = row.entry_hash; }
        return true; }
    private insertClaimAudit(claimId: string, origin: ClaimAuditRow['origin'], recordedAt: string): void {
        const row = this.database.query('SELECT * FROM item_restitution_claim WHERE claim_id=?1')
            .get(claimId) as ClaimRow | null;
        if (!row) throw new Error('Restitution claim is missing before audit');
        const claimDigest = hash(claim(row));
        const previousHash = (this.database.query(`SELECT entry_hash FROM item_restitution_claim_audit
            ORDER BY sequence DESC LIMIT 1`).get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
        this.database.run(`INSERT INTO item_restitution_claim_audit
            (claim_id,claim_digest,origin,recorded_at,previous_hash,entry_hash) VALUES(?1,?2,?3,?4,?5,?6)`,
        [claimId, claimDigest, origin, recordedAt, previousHash,
            hash({ previousHash, claimId, claimDigest, origin, recordedAt })]);
    }
    private transfer(kind: 'title-transferred' | 'custody-transferred', input: TransferItemTitle | TransferItemCustody,
        verify?: ItemProvenanceVerifier, recordedAtInput = new Date().toISOString()): ItemProvenanceAsset {
        const eventId = id(input.eventId, 'eventId'), assetId = id(input.assetId, 'assetId');
        const from = party(input.from, 'from'), to = party(input.to, 'to'), evidence = this.evidence(input.evidence);
        const recordedAt = timestamp(recordedAtInput, 'recordedAt'); integer(input.expectedRevision, 'expectedRevision');
        if (same(from, to)) throw new Error('Item transfer requires distinct parties');
        if (!verify?.(evidence)) throw new Error('Item provenance evidence is not trusted');
        const requestDigest = hash({ kind, assetId, expectedRevision: input.expectedRevision, from, to, evidence });
        const replay = this.replay(eventId, requestDigest); if (replay) return this.getAsset(assetId)!;
        const current = this.getAsset(assetId); if (!current || current.lifecycleStatus!=='active'||current.revision !== input.expectedRevision) {
            throw new Error('Item provenance asset changed before transfer');
        }
        const title = kind === 'title-transferred' ? from : current.titleOwner;
        const holder = kind === 'custody-transferred' ? from : current.holder;
        if (!same(kind === 'title-transferred' ? current.titleOwner : current.holder, from)) {
            throw new Error('Item transfer source does not match current state');
        }
        if (Date.parse(evidence.occurredAt) < Date.parse(current.updatedAt)) throw new Error('Item transfer precedes current state');
        const titleAfter = kind === 'title-transferred' ? to : title;
        const holderAfter = kind === 'custody-transferred' ? to : holder;
        const eventValue = { eventId, evidenceId: evidence.evidenceId, kind, assetId, itemId: current.itemId,
            quantity: current.quantity, titleBefore: title, titleAfter, holderBefore: holder, holderAfter,
            sourceDomain: evidence.sourceDomain, sourceRecordId: evidence.sourceRecordId,
            sourceStateVersion: evidence.sourceStateVersion, sourceEvidenceDigest: evidence.sourceEvidenceDigest,
            occurredAt: evidence.occurredAt };
        const transaction = this.database.transaction(() => { const changed = kind === 'title-transferred'
            ? this.database.run(`UPDATE item_provenance_asset SET title_kind=?3,title_id=?4,updated_at=?5,revision=revision+1
                WHERE asset_id=?1 AND revision=?2`, [assetId, current.revision, to.kind, to.id, evidence.occurredAt])
            : this.database.run(`UPDATE item_provenance_asset SET holder_kind=?3,holder_id=?4,updated_at=?5,revision=revision+1
                WHERE asset_id=?1 AND revision=?2`, [assetId, current.revision, to.kind, to.id, evidence.occurredAt]);
            if (changed.changes !== 1) throw new Error('Item provenance asset changed before transfer');
            this.insertEvent(eventValue, requestDigest, recordedAt); });
        transaction.immediate(); return this.getAsset(assetId)!;
    }
    private debitBusinessStock(businessId:string,storageId:string|null,itemId:number,quantity:number,at:string):void{
        const changed=storageId===null?this.database.run(`UPDATE business_inventory SET count=count-?3,revision=revision+1,updated_at=?4
            WHERE business_id=?1 AND item_id=?2 AND count>=?3`,[businessId,itemId,quantity,at]):this.database.run(
            `UPDATE business_storage_item SET count=count-?4,revision=revision+1,updated_at=?5
                WHERE business_id=?1 AND storage_id=?2 AND item_id=?3 AND count>=?4`,[businessId,storageId,itemId,quantity,at]);
        if(changed.changes!==1)throw new Error('Transformation input stock is insufficient')}
    private creditBusinessStock(businessId:string,storageId:string|null,itemId:number,quantity:number,at:string):void{
        if(storageId===null)this.database.run(`INSERT INTO business_inventory VALUES(?1,?2,?3,1,?4)
            ON CONFLICT(business_id,item_id) DO UPDATE SET count=count+excluded.count,revision=revision+1,updated_at=excluded.updated_at`,
        [businessId,itemId,quantity,at]);else{const storage=this.database.query(
            'SELECT 1 ok FROM business_storage WHERE business_id=?1 AND storage_id=?2').get(businessId,storageId);
            if(!storage)throw new Error('Transformation output storage does not exist');this.database.run(
            `INSERT INTO business_storage_item VALUES(?1,?2,?3,?4,1,?5)
                ON CONFLICT(storage_id,item_id) DO UPDATE SET count=count+excluded.count,revision=revision+1,updated_at=excluded.updated_at`,
            [businessId,storageId,itemId,quantity,at])}}
    private evidence(value: ItemProvenanceEvidence): ItemProvenanceEvidence {
        if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== ['evidenceId', 'occurredAt',
            'sourceDomain', 'sourceEvidenceDigest', 'sourceRecordId', 'sourceStateVersion'].sort().join(',')
            || !['item-lifecycle', 'business-assets', 'trade'].includes(value.sourceDomain)
            || !DIGEST.test(value.sourceEvidenceDigest)) throw new Error('Item provenance evidence is invalid');
        return { evidenceId: id(value.evidenceId, 'evidenceId'), sourceDomain: value.sourceDomain,
            sourceRecordId: id(value.sourceRecordId, 'sourceRecordId'),
            sourceStateVersion: integer(value.sourceStateVersion, 'sourceStateVersion'),
            sourceEvidenceDigest: value.sourceEvidenceDigest, occurredAt: timestamp(value.occurredAt, 'occurredAt') };
    }
    private replay(eventId: string, requestDigest: string): ItemProvenanceEvent | null {
        const row = this.database.query('SELECT * FROM item_provenance_event WHERE event_id=?1').get(eventId) as EventRow | null;
        if (!row) return null; if (row.request_digest !== requestDigest) throw new Error('Item provenance event id was reused');
        return event(row);
    }
    private insertEvent(value: Omit<ItemProvenanceEvent, 'eventDigest' | 'recordedAt'>,
        requestDigest: string, recordedAt: string): void {
        if (this.database.query('SELECT 1 FROM item_provenance_event WHERE evidence_id=?1').get(value.evidenceId)) {
            throw new Error('Item provenance evidence was already consumed');
        }
        const eventDigest = hash(value);
        this.database.run(`INSERT INTO item_provenance_event VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,
            ?13,?14,?15,?16,?17,?18)`, [value.eventId, value.evidenceId, value.kind, value.assetId, value.itemId,
            value.quantity, value.titleBefore === null ? null : JSON.stringify(value.titleBefore), JSON.stringify(value.titleAfter),
            value.holderBefore === null ? null : JSON.stringify(value.holderBefore), JSON.stringify(value.holderAfter),
            value.sourceDomain, value.sourceRecordId, value.sourceStateVersion, value.sourceEvidenceDigest,
            value.occurredAt, requestDigest, eventDigest, recordedAt]);
        const previous = (this.database.query('SELECT entry_hash FROM item_provenance_audit ORDER BY sequence DESC LIMIT 1')
            .get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
        const payload = { eventId: value.eventId, eventDigest, recordedAt };
        this.database.run(`INSERT INTO item_provenance_audit(event_id,event_digest,recorded_at,previous_hash,entry_hash)
            VALUES(?1,?2,?3,?4,?5)`, [value.eventId, eventDigest, recordedAt, previous,
            hash({ previousHash: previous, payload })]);
    }
    private migrate(): void { let version = Number((this.database.query('PRAGMA user_version').get() as
        { user_version: number }).user_version);
        if (version > 3) throw new Error(`Item provenance schema ${version} is newer than supported version 3`);
        if (version === 0) { const transaction = this.database.transaction(() => {
            this.database.run(`CREATE TABLE item_provenance_asset(asset_id TEXT PRIMARY KEY,tier TEXT NOT NULL,
                state_mode TEXT NOT NULL,item_id INTEGER NOT NULL,quantity INTEGER NOT NULL,title_kind TEXT NOT NULL,
                title_id TEXT NOT NULL,holder_kind TEXT NOT NULL,holder_id TEXT NOT NULL,provenance_root_digest TEXT NOT NULL,
                theft_history_count INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL)`);
            this.database.run(`CREATE TABLE item_provenance_event(event_id TEXT PRIMARY KEY,evidence_id TEXT NOT NULL UNIQUE,
                kind TEXT NOT NULL,asset_id TEXT REFERENCES item_provenance_asset(asset_id),item_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,title_before_json TEXT,title_after_json TEXT NOT NULL,holder_before_json TEXT,
                holder_after_json TEXT NOT NULL,source_domain TEXT NOT NULL,source_record_id TEXT NOT NULL,
                source_state_version INTEGER NOT NULL,source_evidence_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,
                request_digest TEXT NOT NULL,event_digest TEXT NOT NULL,recorded_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE item_restitution_claim(claim_id TEXT PRIMARY KEY,event_id TEXT NOT NULL UNIQUE
                REFERENCES item_provenance_event(event_id),item_id INTEGER NOT NULL,quantity INTEGER NOT NULL,
                title_kind TEXT NOT NULL,title_id TEXT NOT NULL,liable_actor_agent_id TEXT NOT NULL,
                unit_value_coins INTEGER NOT NULL,amount_coins INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE item_provenance_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE REFERENCES item_provenance_event(event_id),event_digest TEXT NOT NULL,
                recorded_at TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        }); transaction.immediate(); version=1; }
        if(version===1){if (!this.verifyEventAuditChain()) throw new Error('Cannot migrate invalid item provenance event audit');
        const migration = this.database.transaction(() => {
            this.database.run(`CREATE TABLE item_restitution_claim_audit(
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,claim_id TEXT NOT NULL UNIQUE
                    REFERENCES item_restitution_claim(claim_id),claim_digest TEXT NOT NULL,
                origin TEXT NOT NULL CHECK (origin IN ('v2-write','legacy-v1-snapshot')),
                recorded_at TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
            const legacy = this.database.query('SELECT claim_id FROM item_restitution_claim ORDER BY claim_id')
                .all() as Array<{ claim_id: string }>;
            const recordedAt = new Date().toISOString();
            for (const row of legacy) this.insertClaimAudit(row.claim_id, 'legacy-v1-snapshot', recordedAt);
            this.database.run('PRAGMA user_version = 2');
            if (!this.verifyEventAuditChain()||!this.verifyClaimAuditChain())
                throw new Error('Item provenance claim migration verification failed');
        });
        migration.immediate();version=2;}
        if(version===2){if(!this.verifyEventAuditChain()||!this.verifyClaimAuditChain())
            throw new Error('Cannot migrate invalid item provenance audit');
            const migration=this.database.transaction(()=>{
                const columns=new Set((this.database.query('PRAGMA table_info(item_provenance_asset)').all() as
                    Array<{name:string}>).map(value=>value.name));
                if(!columns.has('lifecycle_status'))this.database.run("ALTER TABLE item_provenance_asset ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN('active','consumed'))");
                if(!columns.has('consumed_by_transformation_id'))this.database.run('ALTER TABLE item_provenance_asset ADD COLUMN consumed_by_transformation_id TEXT');
                this.database.run(`CREATE TABLE IF NOT EXISTS item_transformation(transformation_id TEXT PRIMARY KEY,business_id TEXT NOT NULL,
                    input_asset_ids_json TEXT NOT NULL,output_asset_ids_json TEXT NOT NULL,source_record_id TEXT NOT NULL UNIQUE,evidence_json TEXT NOT NULL,
                    request_json TEXT NOT NULL,request_digest TEXT NOT NULL,transformation_digest TEXT NOT NULL UNIQUE,recorded_at TEXT NOT NULL)`);
                this.database.run(`CREATE TABLE IF NOT EXISTS item_transformation_lineage(transformation_id TEXT NOT NULL
                    REFERENCES item_transformation(transformation_id),output_asset_id TEXT NOT NULL REFERENCES item_provenance_asset(asset_id),
                    input_asset_id TEXT NOT NULL REFERENCES item_provenance_asset(asset_id),
                    PRIMARY KEY(transformation_id,output_asset_id,input_asset_id))`);
                this.database.run(`CREATE TABLE IF NOT EXISTS item_transformation_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    transformation_id TEXT NOT NULL UNIQUE REFERENCES item_transformation(transformation_id),
                    transformation_digest TEXT NOT NULL,recorded_at TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
                this.database.run('PRAGMA user_version = 3');
                if(!this.verifyTransformationAuditChain())throw new Error('Item transformation migration verification failed')});
            migration.immediate();
        }
    }
}
