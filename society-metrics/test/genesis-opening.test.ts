import {afterEach,expect,test} from 'bun:test';
import {mkdtempSync,rmSync,cpSync,mkdirSync,readFileSync,copyFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {OwnedDatabase} from '../../server/engine/src/io/OwnedDatabase.js';
import {SimulationClockStore} from '../../simulation-clock/store.js';
import {AgentStateStore} from '../../agent-state/store.js';
import {PlayerHealthEvidenceStore} from '../../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import {PropertyStore} from '../../server/engine/src/mods/PropertyStore.js';
import {loadPropertyCatalog} from '../../server/engine/src/mods/Properties.js';
import {BusinessManagerStore} from '../../server/gateway/admin/business-manager.js';
import {InstitutionTreasuryStore} from '../../server/gateway/admin/institution-treasury.js';
import {LocalLostCityWorldGenesisAdapter,type LocalGenesisDependencies} from '../../server/gateway/admin/local-world-genesis-adapter.js';
import {startAdminWorldGenesis} from '../../server/gateway/admin/world-genesis.js';
import {buildWorldGenesisResult} from '../../world-genesis/result.js';
import {businessGenesisInventoryDigest} from '../../world-genesis/provenance.js';
import {loadWorldGenesisProfileCatalog} from '../../world-genesis/config.js';
import type {GenesisAssetAllocation} from '../../world-genesis/types.js';
import {SocietyIntegrityStore,saveValueSnapshot} from '../../society-integrity/store.js';
import {createSaveData} from '../../sdk/test/utils/save-generator.js';
import {parsePlayerSaveBytes} from '../../server/gateway/admin/save-reader.js';
import {nativeIntegrationOptions} from '../integration-sources.js';
import {reportNativeOutcomes,type NativeOutcomeOptions} from '../native-outcomes.js';
import {projectNativeMinimumAssessment} from '../minimum-assessment.js';
import {loadSocietyMinimumContract} from '../../society-minimum/contract.js';
import {readNativeFounderBaseline} from '../population-outcomes.js';
import {readNativeGenesisOpening} from '../genesis-opening.js';

import {createNativeGenesisFixture as fixture,genesisFixtureRoots as roots,initial,wall} from './native-genesis-fixture.js';
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function sql(path:string,command:string){const db=new OwnedDatabase(path);try{db.run(command);}finally{db.close(true);}}
const gate=(r:ReturnType<typeof projectNativeMinimumAssessment>)=>r.integrity.find(g=>g.gateId==='applied-genesis-baseline')!.verdict;
test('applied genesis joins real local bootstrap receipts to canonical native opening and rereads offline without writes',async()=>{
    const f=await fixture(),before=f.hashes(),outcomes=f.outcomes();
    const baseline=readNativeFounderBaseline(f.scope,{...f.options,population:f.options.population!});
    expect(readNativeGenesisOpening(f.scope,{...f.options,population:f.options.population!},baseline)).toMatchObject({verdict:'pass',mismatches:[]});
    expect(outcomes.sources.genesisOpening.status).toBe('available');
    const r=f.report();expect(gate(r)).toBe('pass');expect(r.integrity.filter(g=>g.verdict==='pass').map(g=>g.gateId)).toEqual(['applied-genesis-baseline','frozen-founder-roster']);
    expect(r.sourceCoverage.rows).toHaveLength(16);expect(r.sourceCoverage.completeSourceCount).toBe(2);
    expect(r.sourceCoverage.rows.find(s=>s.sourceId==='applied-genesis')!.status).toBe('complete');
    expect(r.sourceCoverage.rows.find(s=>s.sourceId==='administrative-value-history')!.status).toBe('unavailable');
    expect(r.sourceCoverage.verdict).toBe('inconclusive');
    expect(r.qualifiesMinimum).toBeFalse();expect(r.verdict).toBe('inconclusive');expect(f.report().digest).toBe(r.digest);expect(f.hashes()).toEqual(before);
});
for(const [label,key,command] of [
    ['player','checkpointPath',"UPDATE accounts SET save=(SELECT save FROM accounts WHERE owner='bea') WHERE owner='ada'"],
    ['business-stock','businessPath','UPDATE business_inventory SET count=count+1'],
    ['treasury','treasuryPath','UPDATE institution_treasury SET balance_gp=balance_gp+1'],
    ['property','propertyPath',"UPDATE property_state SET owner_id='foreign' WHERE status='owned'"]
] as const)test(`applied genesis reports verified ${label} opening mismatch as FAIL without a full run`,async()=>{
    const f=await fixture();sql(f.opening[key],command);const r=f.report();expect(gate(r)).toBe('fail');expect(r.verdict).toBe('fail');expect(r.qualifiesMinimum).toBeFalse();
    const short={...f.scope,toSimulationTime:'2001-01-03T00:00:00.000Z'},partial=projectNativeMinimumAssessment(f.contract,short,reportNativeOutcomes(short,f.options));
    expect(partial.bindingStatus).toBe('invalid');expect(gate(partial)).toBe('fail');
});
test('applied genesis requires explicit complete paused opening and exact receipt; missing, late and foreign sources never donate PASS',async()=>{
    const f=await fixture(),p=f.options.population!;
    for(const opening of [undefined,{...f.opening,checkpointPath:join(f.root,'server/engine/data/missing.sqlite')},
        {...f.opening,checkpointPath:join(f.root,'../outside.sqlite')}]){
        const o={...f.options,population:{...p,opening}};expect(gate(projectNativeMinimumAssessment(f.contract,f.scope,reportNativeOutcomes(f.scope,o)))).toBe('inconclusive');}
    sql(f.opening.clockPath,'UPDATE simulation_clock SET last_simulation_ms=last_simulation_ms+1000');expect(gate(f.report())).toBe('inconclusive');
    sql(f.opening.clockPath,'UPDATE simulation_clock SET last_simulation_ms=last_simulation_ms-1000');
    sql(p.genesisPath,"UPDATE world_genesis_application SET receipt_json='{\"fixture\":true}'");expect(gate(f.report())).toBe('inconclusive');
});
test('applied genesis snapshot paths can be restored separately; a foreign scope cannot donate its PASS or FAIL',async()=>{
    const f=await fixture(),frozen=join(f.root,'.local/opening');mkdirSync(frozen,{recursive:true});
    const opening={...f.opening};for(const key of Object.keys(opening) as (keyof typeof opening)[]){const target=join(frozen,`${key}.sqlite`);copyFileSync(opening[key],target);opening[key]=target;}
    f.options.population!.opening=opening;expect(gate(f.report())).toBe('pass');
    sql(f.opening.checkpointPath,"UPDATE accounts SET save=(SELECT save FROM accounts WHERE owner='bea') WHERE owner='ada'");expect(gate(f.report())).toBe('pass');
    const scope={...f.scope,clockId:'foreign'};expect(gate(projectNativeMinimumAssessment(f.contract,scope,f.outcomes()))).toBe('inconclusive');
});
test('verified physical opening FAIL survives a different missing source without claiming complete opening coverage',async()=>{
    const f=await fixture();sql(f.opening.checkpointPath,"UPDATE accounts SET save=(SELECT save FROM accounts WHERE owner='bea') WHERE owner='ada'");
    f.options.population!.opening={...f.opening,treasuryPath:join(f.root,'.local/missing.sqlite')};
    const source=f.outcomes().sources.genesisOpening;expect(source.status).toBe('available');
    if(source.status==='available')expect(source.value).toMatchObject({verdict:'fail',completeOpeningSources:false,mismatches:['player-opening-state']});
    expect(gate(f.report())).toBe('fail');
});
for(const [label,key,command,expected] of [
    ['native property receipt','propertyPath','DELETE FROM property_genesis_assignment','fail'],
    ['native stock receipt','businessPath',"UPDATE business_genesis_inventory SET count=count+1",'fail'],
    ['native treasury receipt','treasuryPath',"UPDATE institution_treasury_genesis SET amount_gp=amount_gp+1",'fail'],
    ['bootstrap permit','integrityPath',"UPDATE integrity_permit SET consumed=0",'inconclusive'],
    ['opening snapshot','integrityPath',"DELETE FROM integrity_event WHERE event_id LIKE 'opening:player:ada:%'",'inconclusive']
] as const)test(`applied genesis checks ${label} instead of trusting the application status`,async()=>{
    const f=await fixture(),path=key==='integrityPath'?f.options.population!.integrityPath:f.opening[key];sql(path,command);expect(gate(f.report())).toBe(expected);
});
