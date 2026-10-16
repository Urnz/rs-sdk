import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentStateStore } from '../../agent-state/store.js';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { loadPopulationAgePolicy, loadPopulationMortalityPolicy, createPopulationDeathEvidence } from '../../population-lifecycle/index.js';
import { PlayerHealthEvidenceStore } from '../../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { PropertyStore } from '../../server/engine/src/mods/PropertyStore.js';
import { loadPropertyCatalog } from '../../server/engine/src/mods/Properties.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { EconomicContractStore } from '../../server/gateway/admin/economic-contracts.js';
import { InstitutionTreasuryStore } from '../../server/gateway/admin/institution-treasury.js';
import { BankingLoanStore } from '../../server/gateway/admin/banking-loans.js';
import { BankingLedgerStore } from '../../server/gateway/admin/banking-ledger.js';
import { BankingCollateralStore } from '../../server/gateway/admin/banking-collateral.js';
import { InstitutionSettlementOrchestrator } from '../../server/gateway/admin/institution-settlement-orchestrator.js';
import { GovernanceStore } from '../../server/gateway/admin/governance.js';
import { listAdminAgents } from '../../server/gateway/admin/agent-state.js';
import { readDemographicInheritance } from '../../server/gateway/admin/population-demographics.js';
import { loadEstatePolicy, runPopulationEstateCycle, PopulationEstateStore, VerifiedEstateDeath, EstateSource,
    inspectEstateContext, type EstateRuntimeOptions, validateInheritancePolicy, previewAdminInheritance, executeAdminInheritance } from '../index.js';

const wall = '2026-10-13T10:00:00.000Z', initial = '2001-01-01T00:00:00.000Z';
const config = join(import.meta.dir,'../../config'), age = loadPopulationAgePolicy(join(config,'population-age-policy.json')),
    mortality = loadPopulationMortalityPolicy(join(config,'population-mortality-policy.json')), policy = loadEstatePolicy(join(config,'population-estate-policy.json'));
const directories: string[] = [], closers: Array<() => void> = [];
// These engine modules use package-local # aliases; their own engine typecheck covers them.
const escrowModulePath = join(import.meta.dir,'../../server/engine/src/mods/PlayerInventoryEscrowStore.ts');
const marketModulePath = join(import.meta.dir,'../../server/engine/src/engine/market/MarketStore.ts');
const { PlayerInventoryEscrowStore } = await import(escrowModulePath) as {
    PlayerInventoryEscrowStore: new (market: { db: Database }) => { close(): void;
        mutateWithCheckpoint(command: { operation: 'hold' | 'release'; escrowId: string; username: string; assets?: {gp:number;items:Array<{id:number;count:number}>} },
            wallet: {count(id:number):number;remove(id:number,count:number):number;add(id:number,count:number):number},
            account: {owner:string;save():Uint8Array;rollback():void},now:string): {status:string} }
};
const { MarketStore } = await import(marketModulePath) as { MarketStore: new (path: string) => { db: Database } };
afterEach(() => { for (const close of closers.splice(0).reverse()) close();
    for (const directory of directories.splice(0)) rmSync(directory,{ recursive: true, force: true }); });
function closeDb(db: Database) { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); }
function read(path: string, sql: string): Record<string,unknown>[] { const db = new Database(path,{readonly:true});
    try { return db.query(sql).all() as Record<string,unknown>[]; } finally { closeDb(db); } }
function write(path: string, sql: string) { const db = new Database(path); try { db.run(sql); } finally { closeDb(db); } }
function fixture(terminal = true, personalSecond = false, clearClaims = false) {
    const root = mkdtempSync(join(tmpdir(),'estate-mvp-')); directories.push(root);
    const sources = { agents: join(root,'agents.sqlite'), business: join(root,'businesses.sqlite'), contracts: join(root,'contracts.sqlite'),
        treasury: join(root,'treasury.sqlite'), banking: join(root,'banking.sqlite'), property: join(root,'properties.sqlite'),
        governance: join(root,'governance.sqlite'), escrow: join(root,'escrow.sqlite') };
    const options: EstateRuntimeOptions = { statePath: join(root,'estates.sqlite'),engineDeathPath: join(root,'engine.sqlite'),policy,sources };
    const clock = new SimulationClockStore(join(root,'clock.sqlite')); closers.push(() => clock.close());
    const clockState = clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'estate-test', version: '1.0.0', seed: 'estate-test',
        rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } }, wallTime: wall, simulationTime: initial });
    const agents = new AgentStateStore(sources.agents,{store:clock,clockId:'world'}); closers.push(() => agents.close());
    for (const id of ['alice','bob']) agents.createIdentity({agentId:id,playerUsername:id,displayName:id,background:'Estate test',personalityTraits:['careful']},wall);
    for (const subjectId of ['forge','other-company']) agents.createIdentity({agentId:`${subjectId}-mind`,displayName:subjectId,background:'Institution',personalityTraits:['prudent'],
        controlProfile:{role:'institution',subjectKind:'business',subjectId,decisionIntervalMs:60000,maxDecisionsPerDay:20,dailyLlmBudgetMicros:100000,dailyOperationalBudgetGp:10000}},wall);
    agents.setCharacterBirth('alice',1,initial,'born',wall);
    agents.bindPopulationMember({agentId:'alice',playerUsername:'alice',worldProfile:{profileId:'mature-society',version:'1.0.0',digest:'a'.repeat(64)},
        lifecyclePolicy:{...age.lifecyclePolicy,kind:'finite'},simulationClock:{clockId:'world',profileDigest:clockState.profileDigest},
        joinedAtSimulationTime:initial,sourceResultId:'genesis-'+ 'b'.repeat(24),sourceResultDigest:'c'.repeat(64)},wall);
    agents.setEconomicActorLink('alice',null,{actorKind:'business',actorId:'forge',role:'owner'},wall);
    agents.setEconomicActorLink('alice',null,{actorKind:'faction',actorId:'guild',role:'manager'},wall);
    agents.setRelationship('alice',null,{actorKey:'bob',displayName:'Bob',agentOwesGp:70,actorOwesGp:20},wall);
    agents.createCommitment('alice',{commitmentId:'alice-debt',actorKey:'bob',direction:'owed-by-agent',description:'Explicit debt',valueGp:35},wall);
    const businesses = new BusinessManagerStore(sources.business);
    businesses.create({businessId:'forge',name:'Forge',summary:'Estate owned',ownerAgentId:'alice'},wall);
    businesses.create({businessId:'other-company',name:'Other',summary:'Independent company',ownerAgentId:'bob'},wall);
    businesses.hire('other-company',{workerAgentId:'alice',role:'manager',title:'Manager',wageGp:25},wall); businesses.close();
    const treasury = new InstitutionTreasuryStore(sources.treasury);
    for (const id of ['forge','other-company','bank-main']) { treasury.ensure('business',id,wall); treasury.setBalance('business',id,1,10000,wall); }
    treasury.reserve('business','other-company','contract-estate-reserve',100,wall);
    treasury.bindSettlement('contract-estate-reserve','10000000-0000-4000-8000-000000000003',wall); treasury.close();
    const contracts = new EconomicContractStore(sources.contracts);
    const offer = contracts.create({creatorAgentId:'other-company-mind',counterpartyAgentId:'alice',kind:'work',title:'Work',summary:'Verified job',
        creatorProvides:{gp:100,items:[],service:null},counterpartyProvides:{gp:0,items:[],service:'Service',skill:{id:'test.service',version:'1.0.0'}},
        expiresAt:'2026-10-14T10:00:00.000Z'},wall);
    const contract = contracts.accept(offer.offerId,'alice',1,wall,'10000000-0000-4000-8000-000000000004',[
        {settlementId:'10000000-0000-4000-8000-000000000003',party:'a',payerAgentId:'other-company-mind',payerKind:'business',payerActorId:'other-company',
            payeeAgentId:'alice',payeeUsername:'alice',payeeKind:null,payeeActorId:null,amountGp:100,reservationId:'contract-estate-reserve'}]).contract;
    contracts.close();
    const loans = new BankingLoanStore(sources.banking);
    loans.create({loanId:'loan-1',bankId:'bank-main',bankTreasuryActorId:'bank-main',borrowerKind:'business',borrowerActorId:'forge',principalGp:200,
        annualInterestBps:1000,termDays:30},wall);
    loans.disburse('loan-1',{domain:'banking',eventId:'loan-1-completion',eventKind:'loan-disbursed',sourceRef:'loan-1-source',payerKind:'business',payerActorId:'bank-main',
        payeeKind:'business',payeeActorId:'forge',amountGp:200,settlementId:'10000000-0000-4000-8000-000000000005',reservationId:'loan-1-reservation',
        status:'committed',eventDigest:'d'.repeat(64),verifiedAt:wall,createdAt:wall,updatedAt:wall}); loans.close();
    const banking = new BankingLedgerStore(sources.banking); banking.close();
    const collateral = new BankingCollateralStore(sources.banking); collateral.close();
    const settlements = new InstitutionSettlementOrchestrator(sources.banking,sources.treasury); settlements.close();
    const loadedCatalog = loadPropertyCatalog(join(config,'properties.json')), catalog = { ...loadedCatalog, properties: loadedCatalog.properties.slice(0,2) },
        properties = new PropertyStore(catalog,sources.property,wall);
    properties.assignGenesis('estate-personal-property',catalog.properties[0]!.propertyId,1,{kind:'player',id:'alice'},wall);
    properties.assignGenesis('estate-company-property',catalog.properties[1]!.propertyId,1,personalSecond ? {kind:'player',id:'alice'} : {kind:'business',id:'forge'},wall); properties.close();
    const governance = new GovernanceStore(sources.governance); governance.close();
    const market = new MarketStore(sources.escrow), escrowDb = market.db;
    const escrow = new PlayerInventoryEscrowStore(market);
    const marker = {schema_version:1,legacy_baseline_count:0,created_at:wall};
    escrowDb.run('CREATE TABLE player_escrow_authority(schema_version INTEGER,legacy_baseline_count INTEGER,created_at TEXT,digest TEXT)');
    escrowDb.run('INSERT INTO player_escrow_authority VALUES(1,0,?1,?2)',[wall,createHash('sha256').update(JSON.stringify(marker)).digest('hex')]);
    escrow.close(); closeDb(escrowDb);
    const engine = new PlayerHealthEvidenceStore(options.engineDeathPath); closers.push(() => engine.close());
    if (clearClaims) {
        write(sources.agents,"UPDATE agent_relationship SET agent_owes_gp=0,actor_owes_gp=0");
        write(sources.agents,"UPDATE agent_commitment SET status='cancelled'");
        write(sources.contracts,"UPDATE economic_contract SET resolution='cancelled'");
        write(sources.contracts,`UPDATE economic_contract_settlement SET released_at='${wall}'`);
        const treasury = new InstitutionTreasuryStore(sources.treasury); treasury.release('contract-estate-reserve',wall); treasury.close();
    }
    if (terminal) {
        const death = createPopulationDeathEvidence(agents.getPopulationMember('alice')!,clock.observe('world',wall,42),age,mortality,
            {damageEventId:'10000000-0000-4000-8000-000000000006',sessionId:'session-1',engineTick:42});
        engine.record({username:'alice',sessionId:'session-1',engineTick:42,occurredAt:wall,hpBefore:10,hpAfter:0,maxHp:10,damageType:1},death.cause.kind === 'engine-hp-zero' ? death.cause.damageEventId : '',death);
        const reader = new PlayerHealthEvidenceStore(options.engineDeathPath,true);
        agents.consumePopulationDeath(reader,death.eventId,age,mortality); reader.close();
    }
    return {root,options,agents,clock,engine,contractId:contract.contractId,propertyId:catalog.properties[0]!.propertyId,catalog,
        run: (after?: (domain: string) => void) => runPopulationEstateCycle(options,wall,after)};
}

describe('finite population estate custody', () => {
    test('all real domains enter custody without paying, forgiving or assigning an heir', () => {
        const local = fixture(), result = local.run(), current = result.cases[0]!;
        expect(result.authorityErrors).toEqual([]); expect(current).toMatchObject({status:'custody-ready',blockers:[]});
        expect(Object.keys(current.receipts)).toHaveLength(8);
        expect(local.agents.listEconomicActorLinks('alice').map(link=>link.role)).toEqual(['self']);
        expect(local.agents.getRelationship('alice','bob')).toMatchObject({agentOwesGp:70,actorOwesGp:20});
        expect(local.agents.getCommitment('alice-debt')!.status).toBe('open');
        const business = new BusinessManagerStore(local.options.sources.business);
        expect(business.get('forge')!.status).toBe('dormant'); expect(business.get('other-company')!.status).toBe('active');
        expect(business.get('other-company')!.employments[0]!.status).toBe('ended'); business.close();
        const contracts = new EconomicContractStore(local.options.sources.contracts);
        expect(contracts.getContract(local.contractId)!.status).toBe('estate-held'); expect(contracts.listReadySettlements(local.contractId)).toEqual([]); contracts.close();
        expect(read(local.options.sources.treasury,"SELECT balance_gp,reserved_gp FROM institution_treasury WHERE actor_id='other-company'")[0]).toEqual({balance_gp:10000,reserved_gp:100});
        expect(read(local.options.sources.banking,"SELECT principal_outstanding_gp,status FROM bank_loan WHERE loan_id='loan-1'")[0]).toEqual({principal_outstanding_gp:200,status:'active'});
        expect(read(local.options.sources.property,"SELECT status,owner_kind,owner_id FROM property_state WHERE owner_id='alice'")[0]).toEqual({status:'locked',owner_kind:'player',owner_id:'alice'});
        expect(read(local.options.sources.agents,'SELECT COUNT(*) AS count FROM population_estate_write_permit')[0]).toEqual({count:0});
    });
    test('exact replay and restart preserve receipts, source revisions and one estate', () => {
        const local = fixture(), first = local.run().cases;
        expect(runPopulationEstateCycle(local.options,'2026-10-13T11:00:00.000Z').cases).toEqual(first);
        const reopened = new PopulationEstateStore(local.options.statePath); expect(reopened.list()).toEqual(first); reopened.close();
        expect(read(local.options.sources.property,"SELECT version FROM property_state WHERE owner_id='alice'")[0]!.version).toBe(3);
    });
    test('missing source blocks completion while persisted barriers protect every reachable domain; restoration resumes', () => {
        const local = fixture(), saved = join(local.root,'banking-backup.sqlite'); renameSync(local.options.sources.banking,saved);
        const blocked = local.run().cases[0]!; expect(blocked.status).toBe('blocked'); expect(blocked.receipts.banking).toBeUndefined();
        expect(blocked.blockers.join(' ')).toContain('banking');
        expect(() => write(local.options.sources.property,"UPDATE property_state SET owner_id='bob' WHERE owner_id='alice'")).toThrow('custody');
        renameSync(saved,local.options.sources.banking); expect(local.run().cases[0]!.status).toBe('custody-ready');
    });
    test('a crash after a source commit reuses that receipt and does not repeat its economic effects', () => {
        const local = fixture(); let thrown = false;
        const blocked = local.run(domain => { if (domain === 'agents' && !thrown) { thrown = true; throw new Error('simulated coordinator crash'); } }).cases[0]!;
        expect(blocked.status).toBe('blocked'); expect(blocked.receipts.agents).toBeUndefined();
        const before = read(local.options.sources.business,'SELECT business_id,revision FROM business ORDER BY business_id');
        expect(local.run().cases[0]!.status).toBe('custody-ready'); expect(read(local.options.sources.business,'SELECT business_id,revision FROM business ORDER BY business_id')).toEqual(before);
    });
    test('source failure rolls back its permit, mutations and receipt while its prior custody barrier remains', () => {
        const local = fixture();
        write(local.options.sources.property,"CREATE TRIGGER reject_estate BEFORE UPDATE ON property_state WHEN NEW.owner_id='alice' BEGIN SELECT RAISE(ABORT,'simulated property failure'); END");
        const blocked = local.run().cases[0]!; expect(blocked.status).toBe('blocked'); expect(blocked.receipts.property).toBeUndefined();
        expect(read(local.options.sources.property,"SELECT status FROM property_state WHERE owner_id='alice'")[0]!.status).toBe('owned');
        expect(read(local.options.sources.property,'SELECT COUNT(*) AS count FROM population_estate_write_permit')[0]!.count).toBe(0);
        write(local.options.sources.property,'DROP TRIGGER reject_estate'); expect(local.run().cases[0]!.status).toBe('custody-ready');
    });
    test('ordinary APIs cannot restore roles, spend reserved funds, erase debt, reopen business or transfer property', () => {
        const local = fixture(); local.run();
        expect(() => local.agents.setEconomicActorLink('alice',null,{actorKind:'faction',actorId:'new-guild',role:'manager'},wall)).toThrow('custody');
        expect(() => local.agents.setEconomicActorLink('bob',null,{actorKind:'business',actorId:'forge',role:'owner'},wall)).toThrow('custody');
        expect(() => write(local.options.sources.business,"UPDATE business SET owner_agent_id='alice' WHERE business_id='other-company'")).toThrow('custody');
        expect(() => local.agents.setCommitmentStatus('alice-debt',1,'fulfilled',wall)).toThrow('custody');
        const treasury = new InstitutionTreasuryStore(local.options.sources.treasury);
        expect(() => treasury.release('contract-estate-reserve',wall)).toThrow('custody');
        expect(treasury.get('business','other-company')!.reservedGp).toBe(100); treasury.close();
        const loans = new BankingLoanStore(local.options.sources.banking);
        expect(() => loans.accrue('loan-1','2026-10-15T10:00:00.000Z')).toThrow('custody'); expect(loans.get('loan-1')!.principalOutstandingGp).toBe(200); loans.close();
        const properties = new PropertyStore(local.catalog,local.options.sources.property);
        expect(() => properties.transferOwnership('estate-illegal-transfer',local.propertyId,3,{kind:'player',id:'alice'},{kind:'player',id:'bob'},wall)).toThrow(); properties.close();
        const businesses = new BusinessManagerStore(local.options.sources.business), current = businesses.get('forge')!;
        expect(() => businesses.update('forge',current.revision,{name:current.name,summary:current.summary,propertyId:current.propertyId,status:'active'},wall)).toThrow('custody'); businesses.close();
    });
    test('ambiguous settling money remains reserved and explicitly blocks a ready estate', () => {
        const local = fixture(); write(local.options.sources.contracts,"UPDATE economic_contract_settlement SET status='settling'");
        const current = local.run().cases[0]!; expect(current.status).toBe('blocked'); expect(current.blockers.join(' ')).toContain('ambiguous settlement');
        expect(read(local.options.sources.treasury,"SELECT reserved_gp FROM institution_treasury WHERE actor_id='other-company'")[0]!.reserved_gp).toBe(100);
    });
    test('a funded contract cannot substitute for a missing or already released treasury reservation', () => {
        const local = fixture(), treasury = new InstitutionTreasuryStore(local.options.sources.treasury);
        treasury.release('contract-estate-reserve',wall); treasury.close();
        const current = local.run().cases[0]!; expect(current.status).toBe('blocked');
        expect(current.blockers.join(' ')).toContain('matching treasury');
    });
    test('verified death does not authorize a caller-supplied ownership context', () => {
        const local = fixture(), authority = VerifiedEstateDeath.load(local.options.sources.agents,local.options.engineDeathPath,'alice');
        const context = inspectEstateContext(local.options.sources.agents,local.options.sources.business,local.options.sources.contracts,authority);
        const source = new EstateSource(local.options.sources.treasury,'treasury');
        expect(() => source.freeze(authority,{...context,ownedBusinessIds:['bank-main']})).toThrow('Unverified'); source.close();
    });
    test('real shared engine escrow remains held and wallet release is rejected atomically after estate admission', () => {
        const local = fixture(), market = new MarketStore(local.options.sources.escrow), escrow = new PlayerInventoryEscrowStore(market);
        let gp = 200; const escrowId = '10000000-0000-4000-8000-000000000009';
        const wallet = {count:()=>gp,remove:(_id:number,count:number)=>{gp-=count;return count},add:(_id:number,count:number)=>{gp+=count;return count}};
        const account = {owner:'alice',save:()=>new Uint8Array([gp]),rollback:()=>{gp=200}};
        escrow.mutateWithCheckpoint({operation:'hold',escrowId,username:'alice',assets:{gp:50,items:[]}},wallet,account,wall);
        expect(gp).toBe(150); escrow.close(); closeDb(market.db);
        expect(local.run().cases[0]!.status).toBe('custody-ready');
        const reopenedMarket = new MarketStore(local.options.sources.escrow), reopened = new PlayerInventoryEscrowStore(reopenedMarket);
        const before = gp, releaseAccount = {...account,rollback:()=>{gp=before}};
        expect(() => reopened.mutateWithCheckpoint({operation:'release',escrowId,username:'alice'},wallet,releaseAccount,wall)).toThrow('custody');
        expect(gp).toBe(150); reopened.close(); closeDb(reopenedMarket.db);
        expect(read(local.options.sources.escrow,'SELECT status FROM player_inventory_escrow')[0]!.status).toBe('held');
    });
    test('a ready case becomes blocked when its death authority is unavailable', () => {
        const local = fixture(); local.run();
        const result = runPopulationEstateCycle({...local.options,engineDeathPath:join(local.root,'missing-engine.sqlite')},wall);
        expect(result.authorityErrors).toHaveLength(1); expect(result.cases[0]!.status).toBe('blocked');
    });
    test('source tampering after custody is detected on replay', () => {
        const local = fixture(); local.run();
        write(local.options.sources.banking,'DROP TRIGGER estate_guard_bank_loan_update');
        write(local.options.sources.banking,"UPDATE bank_loan SET principal_outstanding_gp=0 WHERE loan_id='loan-1'");
        const current = local.run().cases[0]!; expect(current.status).toBe('blocked'); expect(current.blockers.join(' ')).toContain('source changed');
    });
    test('case audit suffix deletion and forged source receipts fail closed', () => {
        const local = fixture(); local.run();
        write(local.options.sources.property,"UPDATE population_estate_receipt SET receipt_digest='bad'");
        expect(local.run().cases[0]!.status).toBe('blocked');
        write(local.options.statePath,'DELETE FROM estate_audit WHERE sequence=(SELECT MAX(sequence) FROM estate_audit)');
        expect(() => new PopulationEstateStore(local.options.statePath)).toThrow('truncated');
    });
    test('active members and fabricated death authorities cannot open an estate', () => {
        const local = fixture(false); expect(local.run().cases).toEqual([]);
        expect(() => VerifiedEstateDeath.load(local.options.sources.agents,local.options.engineDeathPath,'alice')).toThrow('terminal');
        const source = new EstateSource(local.options.sources.property,'property');
        expect(() => source.freeze({assert(){},death:{playerUsername:'alice',agentId:'alice'}} as VerifiedEstateDeath,
            {ownedBusinessIds:[],affectedContractAgentIds:[],reservationIds:[],escrowIds:[]})).toThrow('Unverified'); source.close();
    });
    test('the admin exposes the real estate and blocks trusted planning while a source is missing', async () => {
        const local = fixture();
        const result = await listAdminAgents(local.options.sources.agents,{simulationClock:{store:local.clock,clockId:'world'},populationAgePolicy:age,
            populationMortalityPolicy:mortality,populationEstate:local.options,skillRuns:[],observedAt:wall});
        expect(result.agents.find(agent=>agent.identity.agentId==='alice')!.populationEstate!.status).toBe('custody-ready');
        renameSync(local.options.sources.banking,join(local.root,'banking-absent.sqlite'));
        const blocked = await listAdminAgents(local.options.sources.agents,{simulationClock:{store:local.clock,clockId:'world'},populationAgePolicy:age,
            populationMortalityPolicy:mortality,populationEstate:local.options,skillRuns:[],observedAt:wall});
        expect(blocked.agents.find(agent=>agent.identity.agentId==='alice')!.decisionContext).toContain('population-estate');
    });
});

function inheritanceFixture(clearClaims = true, personalSecond = false) {
    const local = fixture(true,personalSecond,clearClaims);
    const governance = new GovernanceStore(local.options.sources.governance);
    governance.createFaction({factionId:'realm',kind:'kingdom',name:'Realm'},wall);
    governance.createJurisdiction({jurisdictionId:'district',factionId:'realm',kind:'district',name:'District'},wall); governance.close();
    const inheritancePolicy = validateInheritancePolicy({schemaVersion:1,policyId:'test-inheritance',version:'1.0.0',mode:'admin-single-heir-personal-property',
        bindings:[{ruleId:'district-admin',factionId:'realm',jurisdictionId:'district',propertyIds:personalSecond ? local.catalog.properties.map(row=>row.propertyId) : [local.propertyId]}]});
    const current = local.run().cases[0]!, selection = {estateId:current.estateId,heirAgentId:'bob',ruleId:'district-admin',reason:'Reviewed personal Property succession'};
    const preview = () => previewAdminInheritance(local.options,inheritancePolicy,selection,wall);
    const request = () => { const view = preview(); return {...selection,decisionId:'admin-decision-1',expectedRevision:view.revision,previewDigest:view.digest}; };
    return {...local,inheritancePolicy,selection,preview,request};
}

// Multiple full eight-source cycles exercise file-backed transactions; this is not a latency assertion.
const inheritanceTest = (name: string, body: () => void | Promise<void>) => test(name,body,15_000);
function inheritanceMetrics(local: ReturnType<typeof inheritanceFixture>) {
    const data = { members: local.agents.listPopulationMembers(), skills: {}, archives: {}, entries: [], projectedDeaths: {} };
    return readDemographicInheritance(local.options,data,new Map(local.engine.listDeaths().map(death=>[death.agentId,death])));
}
describe('governed admin single-heir inheritance', () => {
    inheritanceTest('demographic inheritance counts native transfers once, without estimating GP or mutating the coordinator',()=>{
        const local=inheritanceFixture(),request=local.request();
        executeAdminInheritance(local.options,local.inheritancePolicy,request,wall);
        const before=read(local.options.statePath,'SELECT * FROM estate_case'),metrics=inheritanceMetrics(local);
        expect(metrics.value).toMatchObject({completedDecisions:1,appliedPropertyTransfers:1,distinctHeirs:1,awaitingCompletionTransfers:0,valueGp:null,windowAttributedTransfers:null});
        expect(inheritanceMetrics(local)).toEqual(metrics);
        expect(read(local.options.statePath,'SELECT * FROM estate_case')).toEqual(before);
        write(local.options.sources.property,"UPDATE population_estate_inheritance_transfer SET record_digest='forged'");
        expect(()=>inheritanceMetrics(local)).toThrow('conflicts');
    });
    inheritanceTest('demographic inheritance separates applied titles from a pending coordinator acknowledgement',()=>{
        const local=inheritanceFixture(),request=local.request();
        expect(()=>executeAdminInheritance(local.options,local.inheritancePolicy,request,wall,()=>{throw new Error('after-source crash')})).toThrow('crash');
        const before=read(local.options.statePath,'SELECT * FROM estate_case');
        expect(inheritanceMetrics(local).value).toMatchObject({preparedDecisions:1,completedDecisions:0,appliedPropertyTransfers:1,awaitingCompletionTransfers:1});
        expect(read(local.options.statePath,'SELECT * FROM estate_case')).toEqual(before);
    });
    inheritanceTest('transfers personal Property to the live heir and preserves company property, money and debt', () => {
        const local = inheritanceFixture(), preview = local.preview(); expect(preview.blockers).toEqual([]); expect(preview.assets).toHaveLength(1);
        const request = local.request(), result = executeAdminInheritance(local.options,local.inheritancePolicy,request,wall);
        expect(result.inheritance?.status).toBe('completed'); expect(result.status).toBe('custody-ready');
        const property = read(local.options.sources.property,`SELECT * FROM property_state WHERE property_id='${local.propertyId}'`)[0]!;
        expect(property).toMatchObject({owner_kind:'player',owner_id:'bob',status:'owned',version:4});
        expect(read(local.options.sources.property,"SELECT owner_id,status FROM property_state WHERE owner_kind='business'")[0]).toEqual({owner_id:'forge',status:'locked'});
        expect(read(local.options.sources.banking,"SELECT principal_outstanding_gp FROM bank_loan")[0]!.principal_outstanding_gp).toBe(200);
        expect(read(local.options.sources.treasury,"SELECT balance_gp FROM institution_treasury WHERE actor_id='forge'")[0]!.balance_gp).toBe(10000);
        expect(local.agents.listEconomicActorLinks('alice').map(row=>row.role)).toEqual(['self']);
        expect(executeAdminInheritance(local.options,local.inheritancePolicy,request,wall)).toEqual(result);
        expect(local.run().cases[0]).toEqual(result);
        const properties = new PropertyStore(local.catalog,local.options.sources.property);
        properties.transferOwnership('bob-later-transfer',local.propertyId,4,{kind:'player',id:'bob'},{kind:'player',id:'carol'},wall); properties.close();
        expect(local.run().cases[0]!.status).toBe('custody-ready');
    });
    inheritanceTest('unadjudicated debt, commitments, contracts and funding prevent distribution', () => {
        const local = inheritanceFixture(false), preview = local.preview();
        expect(preview.blockers.join(' ')).toContain('social debt'); expect(preview.blockers).toContain('Open personal commitment');
        expect(preview.blockers).toContain('Open personal contract'); expect(preview.blockers).toContain('Unresolved personal contract funding');
        expect(() => executeAdminInheritance(local.options,local.inheritancePolicy,local.request(),wall)).toThrow('blocked');
        expect(read(local.options.sources.property,'SELECT COUNT(*) AS count FROM property_transfer')[0]!.count).toBe(0);
    });
    inheritanceTest('empty bindings and an unrelated rule never fall back to a default law', () => {
        const local = inheritanceFixture(), {digest,...definition} = local.inheritancePolicy;
        const empty = validateInheritancePolicy({...definition,bindings:[]});
        expect(previewAdminInheritance(local.options,empty,local.selection,wall).blockers.join(' ')).toContain('No exact');
        expect(previewAdminInheritance(local.options,local.inheritancePolicy,{...local.selection,ruleId:'other'},wall).blockers.join(' ')).toContain('No exact');
    });
    inheritanceTest('a disabled faction cannot authorize inheritance', () => {
        const local = inheritanceFixture(); write(local.options.sources.governance,"UPDATE governance_faction SET status='disabled'");
        expect(local.preview().blockers.join(' ')).toContain('disabled');
    });
    inheritanceTest('self, institutional and deceased heirs are rejected', () => {
        const local = inheritanceFixture();
        for (const heirAgentId of ['alice','forge-mind','missing']) expect(previewAdminInheritance(local.options,local.inheritancePolicy,
            {...local.selection,heirAgentId},wall).blockers.join(' ')).toContain('active player');
        write(local.options.sources.agents,"UPDATE agent_character_lifecycle SET status='deceased' WHERE agent_id='bob'");
        expect(local.preview().blockers.join(' ')).toContain('active player');
    });
    inheritanceTest('an engine-only death prevents an heir whose AgentState is still active', () => {
        const local = inheritanceFixture(), member = local.agents.getPopulationMember('alice')!;
        local.agents.setCharacterBirth('bob',1,initial,'born',wall);
        local.agents.bindPopulationMember({agentId:'bob',playerUsername:'bob',worldProfile:member.worldProfile,lifecyclePolicy:member.lifecyclePolicy,
            simulationClock:member.simulationClock,joinedAtSimulationTime:initial,sourceResultId:member.sourceResultId,sourceResultDigest:member.sourceResultDigest},wall);
        const death = createPopulationDeathEvidence(local.agents.getPopulationMember('bob')!,local.clock.observe('world',wall,43),age,mortality,
            {damageEventId:'10000000-0000-4000-8000-000000000007',sessionId:'heir-session',engineTick:43});
        local.engine.record({username:'bob',sessionId:'heir-session',engineTick:43,occurredAt:wall,hpBefore:10,hpAfter:0,maxHp:10,damageType:1},
            death.cause.kind==='engine-hp-zero' ? death.cause.damageEventId : '',death);
        expect(local.agents.getCharacterLifecycle('bob')!.status).toBe('active');
        expect(local.preview().blockers.join(' ')).toContain('engine terminal');
    });
    inheritanceTest('a faction binding works and a jurisdiction bound to another faction fails closed', () => {
        const local = inheritanceFixture(), {digest,...definition} = local.inheritancePolicy;
        const factionPolicy = validateInheritancePolicy({...definition,bindings:[{...definition.bindings[0]!,jurisdictionId:null}]});
        expect(previewAdminInheritance(local.options,factionPolicy,local.selection,wall).blockers).toEqual([]);
        const governance = new GovernanceStore(local.options.sources.governance);
        governance.createFaction({factionId:'wrong-faction',kind:'city',name:'Other city'},wall); governance.close();
        write(local.options.sources.governance,"UPDATE governance_jurisdiction SET faction_id='wrong-faction'");
        expect(local.preview().blockers.join(' ')).toContain('unavailable');
    });
    inheritanceTest('a stale preview after heir or law changes cannot prepare an inheritance', () => {
        const local = inheritanceFixture(), request = local.request();
        write(local.options.sources.governance,"UPDATE governance_faction SET revision=revision+1");
        expect(() => executeAdminInheritance(local.options,local.inheritancePolicy,request,wall)).toThrow('preview changed');
        expect(local.run().cases[0]!.inheritance).toBeUndefined();
    });
    inheritanceTest('a changed heir, reason, preview or revision conflicts with an exact completed replay', () => {
        const local = inheritanceFixture(), request = local.request(); executeAdminInheritance(local.options,local.inheritancePolicy,request,wall);
        for (const patch of [{heirAgentId:'carol'},{reason:'Different decision reason'},{previewDigest:'f'.repeat(64)},{expectedRevision:request.expectedRevision+1}])
            expect(() => executeAdminInheritance(local.options,local.inheritancePolicy,{...request,...patch},wall)).toThrow('conflicts');
    });
    inheritanceTest('a source commit before coordinator acknowledgement is completed without a second title transfer', () => {
        const local = inheritanceFixture(), request = local.request();
        expect(() => executeAdminInheritance(local.options,local.inheritancePolicy,request,wall,()=>{throw new Error('after-source crash')})).toThrow('crash');
        expect(read(local.options.sources.property,'SELECT COUNT(*) AS count FROM property_transfer')[0]!.count).toBe(1);
        expect(local.run().cases[0]!.inheritance?.status).toBe('completed');
        expect(executeAdminInheritance(local.options,local.inheritancePolicy,request,wall).inheritance?.status).toBe('completed');
        expect(read(local.options.sources.property,'SELECT COUNT(*) AS count FROM property_transfer')[0]!.count).toBe(1);
    });
    inheritanceTest('a failed Property transfer rolls back title, native receipt, hold release and write permit', () => {
        const local = inheritanceFixture(), request = local.request();
        write(local.options.sources.property,"CREATE TRIGGER reject_inheritance BEFORE INSERT ON property_transfer BEGIN SELECT RAISE(ABORT,'simulated succession failure'); END");
        expect(() => executeAdminInheritance(local.options,local.inheritancePolicy,request,wall)).toThrow('simulated');
        expect(read(local.options.sources.property,"SELECT owner_id,status,version FROM property_state WHERE owner_kind='player'")[0]).toEqual({owner_id:'alice',status:'locked',version:3});
        expect(read(local.options.sources.property,'SELECT COUNT(*) AS count FROM property_transfer')[0]!.count).toBe(0);
        expect(read(local.options.sources.property,'SELECT COUNT(*) AS count FROM population_estate_write_permit')[0]!.count).toBe(0);
        write(local.options.sources.property,'DROP TRIGGER reject_inheritance');
        expect(executeAdminInheritance(local.options,local.inheritancePolicy,request,wall).inheritance?.status).toBe('completed');
    });
    inheritanceTest('a later failure rolls back every asset in a multi-Property decision', () => {
        const local = inheritanceFixture(true,true), request = local.request(), last = [...local.catalog.properties.map(row=>row.propertyId)].sort().at(-1)!;
        write(local.options.sources.property,`CREATE TRIGGER reject_second_inheritance BEFORE INSERT ON property_transfer WHEN NEW.property_id='${last}' BEGIN SELECT RAISE(ABORT,'second title rejected'); END`);
        expect(() => executeAdminInheritance(local.options,local.inheritancePolicy,request,wall)).toThrow('second title');
        expect(read(local.options.sources.property,'SELECT COUNT(*) AS count FROM property_state WHERE owner_id=\'alice\' AND status=\'locked\'')[0]!.count).toBe(2);
        expect(read(local.options.sources.property,'SELECT COUNT(*) AS count FROM property_transfer')[0]!.count).toBe(0);
    });
    inheritanceTest('an ignored title update cannot produce a successful native receipt', () => {
        const local = inheritanceFixture(), request = local.request();
        write(local.options.sources.property,"CREATE TRIGGER ignore_inheritance BEFORE UPDATE ON property_state WHEN NEW.owner_id='bob' BEGIN SELECT RAISE(IGNORE); END");
        expect(() => executeAdminInheritance(local.options,local.inheritancePolicy,request,wall)).toThrow('effect did not commit');
        expect(read(local.options.sources.property,'SELECT COUNT(*) AS count FROM property_transfer')[0]!.count).toBe(0);
        expect(read(local.options.sources.property,'SELECT owner_id FROM property_state WHERE owner_kind=\'player\'')[0]!.owner_id).toBe('alice');
    });
    inheritanceTest('collateral prevents personal Property distribution', () => {
        const local = fixture();
        write(local.options.sources.banking,`INSERT INTO bank_loan_collateral VALUES('loan-1','${local.propertyId}','player','alice',2,'bank-main','pledged',NULL,'${wall}','${wall}')`);
        const governance = new GovernanceStore(local.options.sources.governance); governance.createFaction({factionId:'realm',kind:'kingdom',name:'Realm'},wall); governance.close();
        const policy = validateInheritancePolicy({schemaVersion:1,policyId:'collateral-test',version:'1.0.0',mode:'admin-single-heir-personal-property',
            bindings:[{ruleId:'admin',factionId:'realm',jurisdictionId:null,propertyIds:[local.propertyId]}]});
        const current = local.run().cases[0]!;
        expect(previewAdminInheritance(local.options,policy,{estateId:current.estateId,heirAgentId:'bob',ruleId:'admin',reason:'Collateral review'},wall).blockers.join(' ')).toContain('collateral');
    });
    inheritanceTest('amended custody detects forged or missing succession receipts', () => {
        const local = inheritanceFixture(); executeAdminInheritance(local.options,local.inheritancePolicy,local.request(),wall);
        write(local.options.sources.property,"UPDATE population_estate_inheritance_transfer SET record_digest='forged'");
        expect(local.run().cases[0]!.status).toBe('blocked');
    });
    inheritanceTest('inheritance policy refuses overlapping legal assignments and a forged digest', () => {
        const local = inheritanceFixture(), {digest,...definition} = local.inheritancePolicy;
        expect(() => validateInheritancePolicy({...definition,bindings:[...definition.bindings,{...definition.bindings[0]!,ruleId:'overlap'}]})).toThrow('ambiguous');
        expect(() => previewAdminInheritance(local.options,{...local.inheritancePolicy,digest:'0'.repeat(64)},local.selection,wall)).toThrow('digest');
    });
    inheritanceTest('the admin HTTP boundary requires authorization and applies the exact returned preview', async () => {
        const local = inheritanceFixture(), {digest,...definition} = local.inheritancePolicy, policyPath = join(local.root,'inheritance-policy.json');
        writeFileSync(policyPath,JSON.stringify(definition));
        const {handleAdminRequest} = await import('../../server/gateway/admin/routes.js');
        const context = {gatewayBots:()=>new Map(),supervisor:{} as import('../../server/gateway/admin/supervisor.js').BotSupervisor,
            agentStatePath:local.options.sources.agents,populationEstateOptions:local.options,populationInheritancePolicyPath:policyPath};
        const base = `http://localhost/api/admin/population-estates/${local.selection.estateId}`;
        const headers = {'Content-Type':'application/json','x-admin-request':'rs-sdk-admin',...(process.env.ADMIN_TOKEN ? {'x-admin-token':process.env.ADMIN_TOKEN.trim()} : {})};
        const unauthorized = new Request(`${base}/inheritance`,{method:'POST',body:JSON.stringify(local.selection)});
        expect((await handleAdminRequest(unauthorized,new URL(unauthorized.url),context))!.status).toBe(401);
        const previewRequest = new Request(`${base}/inheritance-preview`,{method:'POST',headers,body:JSON.stringify(local.selection)});
        const response = (await handleAdminRequest(previewRequest,new URL(previewRequest.url),context))!;
        expect(response.status).toBe(200); const preview = await response.json() as {revision:number;digest:string;blockers:string[]}; expect(preview.blockers).toEqual([]);
        const applyRequest = new Request(`${base}/inheritance`,{method:'POST',headers,body:JSON.stringify({...local.selection,
            decisionId:'http-admin-decision',expectedRevision:preview.revision,previewDigest:preview.digest})});
        const applied = (await handleAdminRequest(applyRequest,new URL(applyRequest.url),context))!;
        expect(applied.status).toBe(200); expect((await applied.json() as EstateCaseForTest).inheritance?.status).toBe('completed');
    });
});
type EstateCaseForTest = {inheritance?:{status:string}};
