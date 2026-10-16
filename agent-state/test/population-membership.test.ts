import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SimulationClockStore } from '../../simulation-clock/index.js';
import { AgentStateStore } from '../index.js';
import { AGENT_STATE_SCHEMA_VERSION } from '../types.js';

const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true})});

function harness(){
    const directory=mkdtempSync(join(tmpdir(),'population-member-'));directories.push(directory);
    const agentPath=join(directory,'agents.sqlite'),clock=new SimulationClockStore(join(directory,'clock.sqlite'));
    const clockState=clock.create({clockId:'world',profile:{schemaVersion:1,profileId:'normal',version:'1.0.0',
        seed:'population-member',rate:{simulationMilliseconds:1,wallMilliseconds:1}},
    wallTime:'2026-10-13T10:00:00.000Z',simulationTime:'2001-01-01T00:00:00.000Z'});
    const store=new AgentStateStore(agentPath,{store:clock,clockId:'world'});
    store.createIdentity({agentId:'alice-agent',playerUsername:'Alice',displayName:'Alice',
        background:'Finite population test member.',personalityTraits:['steady']},'2026-10-13T10:00:00.000Z');
    const input={agentId:'alice-agent',playerUsername:'alice',worldProfile:{profileId:'mature-society',
        version:'1.0.0',digest:'a'.repeat(64)},lifecyclePolicy:{policyId:'finite-population',version:'1.0.0',
        digest:'b'.repeat(64),kind:'finite' as const},simulationClock:{clockId:'world',
        profileDigest:clockState.profileDigest},joinedAtSimulationTime:'2001-01-01T00:00:00.000Z',
        sourceResultId:'genesis-0123456789abcdef01234567',sourceResultDigest:'c'.repeat(64)};
    return{directory,agentPath,clock,store,input};
}

describe('persistent finite PopulationMember binding',()=>{
    test('is exact-replay idempotent, restart-safe, visible in snapshots and explicitly resettable',()=>{
        const local=harness();
        const created=local.store.bindPopulationMember(local.input,'2026-10-13T10:01:00.000Z');
        expect(created).toMatchObject({agentId:'alice-agent',playerUsername:'alice',status:'active',revision:1,
            lifecyclePolicy:{kind:'finite'},characterLifecycle:{status:'active'}});
        expect(local.store.bindPopulationMember(local.input,'2026-10-13T10:02:00.000Z')).toEqual(created);
        expect(local.store.getSnapshot('alice-agent')?.populationMember).toEqual(created);
        expect(()=>local.store.bindPopulationMember({...local.input,sourceResultDigest:'d'.repeat(64)}))
            .toThrow('different');
        local.store.close();

        const reopened=new AgentStateStore(local.agentPath,{store:local.clock,clockId:'world'});
        expect(reopened.listPopulationMembers('active')).toHaveLength(1);
        const reset=reopened.resetPopulationMember('alice-agent',local.input.sourceResultDigest,created.revision,
            '2026-10-13T10:03:00.000Z');
        expect(reset).toMatchObject({status:'reset',revision:2,resetAtSimulationTime:'2001-01-01T00:00:00.000Z'});
        expect(reopened.resetPopulationMember('alice-agent',local.input.sourceResultDigest,created.revision)).toEqual(reset);
        expect(()=>reopened.bindPopulationMember(local.input)).toThrow('reset population membership');
        reopened.close();local.clock.close();
    });

    test('migrates additively without inventing memberships for existing identities',()=>{
        const local=harness();local.store.close();
        const database=new Database(local.agentPath,{strict:true});
        // v21 predates death and memory-archive tables, not just PopulationMember.
        for(const row of database.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'memory_%'").all() as Array<{name:string}>)database.run(`DROP TRIGGER ${row.name}`);
        for(const table of ['agent_memory_transfer','agent_population_memory_archive','agent_memory_audit','agent_memory_audit_tail','agent_population_death'])database.run(`DROP TABLE ${table}`);
        database.run('DROP TABLE agent_population_entry');
        database.run('DROP TABLE agent_population_member');database.run('PRAGMA user_version = 21');database.close();
        const migrated=new AgentStateStore(local.agentPath,{store:local.clock,clockId:'world'});
        expect(migrated.listIdentities()).toHaveLength(1);
        expect(migrated.listPopulationMembers()).toEqual([]);
        const inspected=new Database(local.agentPath,{strict:true});
        expect(inspected.query('PRAGMA user_version').get()).toEqual({user_version:AGENT_STATE_SCHEMA_VERSION});inspected.close();
        migrated.close();local.clock.close();
    });
});
