import { expect,test } from 'bun:test';
import { join } from 'node:path';
import { existsSync,mkdirSync,rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { miningSourceFixture } from './mining-demand-fixture.js';
import { OwnedDatabase } from '../../server/engine/src/io/OwnedDatabase.js';
import { installMiningExecutorSource,miningExecutorSourceAvailable,requireMiningExecutorAdmission } from '../mining-request-source.js';
import { nativeToolDigest } from '../../item-lifecycle/native-tool.js';
import { NativeMiningRequestStore } from '../../item-lifecycle/native-mining-requests.js';
import { authorizeMiningDemand } from '../mining-demand-source.js';
import { miningOperationAdmissionPath,sealMiningOperationAdmission } from '../mining-admission.js';
test('real executor admission is recorded before transport, participates in authority, and closes after the durable seal',()=>{
    const f=miningSourceFixture(),path=join(f.root,'checkpoint.sqlite');new OwnedDatabase(path).close(true);
    try{installMiningExecutorSource(f.root,path,{schemaVersion:1,selectionId:randomUUID(),worldId:f.owner.worldId,clockId:f.owner.clockId,clockProfileDigest:f.owner.clockProfileDigest,
        fromSimulationTime:'2001-01-01T00:00:00.000Z',toSimulationTime:'2001-01-02T00:00:00.000Z',actors:[f.owner]});
        const admitted=f.admit();expect(authorizeMiningDemand(f.root,f.owner,f.request).authorityDigest).toHaveLength(64);
        const db=new OwnedDatabase(path);try{const store=new NativeMiningRequestStore(db);expect(store.current(f.demandId)?.admission).toEqual(admitted);
            sealMiningOperationAdmission(f.root,f.request);expect(store.current(f.demandId)?.phase).toBe('closed');expect(store.read().entries).toHaveLength(2);
        }finally{db.close(true);}
        expect(()=>authorizeMiningDemand(f.root,f.owner,f.request)).toThrow();
    }finally{f.close();}
});
test('a producer database write failure leaves a sticky failure witness and cannot later claim a clean source',()=>{
    const f=miningSourceFixture(),path=join(f.root,'checkpoint.sqlite');new OwnedDatabase(path).close(true);
    try{const s={schemaVersion:1 as const,selectionId:randomUUID(),worldId:f.owner.worldId,clockId:f.owner.clockId,clockProfileDigest:f.owner.clockProfileDigest,
        fromSimulationTime:'2001-01-01T00:00:00.000Z',toSimulationTime:'2001-01-02T00:00:00.000Z',actors:[f.owner]};installMiningExecutorSource(f.root,path,s);
        const db=new OwnedDatabase(path);try{db.exec("CREATE TRIGGER fail_request BEFORE INSERT ON native_mining_request_event BEGIN SELECT RAISE(ABORT,'injected write failure'); END;");
            expect(()=>f.admit()).toThrow('injected');expect(existsSync(join(f.root,'.local/agent-skills/mining-request-source.failed.json'))).toBeTrue();
            db.exec('DROP TRIGGER fail_request');expect(miningExecutorSourceAvailable(f.root,db,nativeToolDigest(s))).toBeFalse();expect(()=>f.admit()).toThrow('retained');
            const body={schemaVersion:1 as const,username:'outsider',checksum:'d'.repeat(64),args:f.request.args,context:f.request.context,
                admittedAt:new Date().toISOString(),expiresAtWallTime:new Date(Date.now()+f.request.args.timeoutMs).toISOString()};
            expect(()=>requireMiningExecutorAdmission(f.root,{...f.owner,actorId:'outsider',username:'outsider'},{...body,digest:nativeToolDigest(body)})).not.toThrow();
        }finally{db.close(true);}
    }finally{f.close();}
});
test('failed operation sidecar publication leaves its pre-native request in the selected source',()=>{
    const f=miningSourceFixture(),path=join(f.root,'checkpoint.sqlite');new OwnedDatabase(path).close(true);
    try{installMiningExecutorSource(f.root,path,{schemaVersion:1,selectionId:randomUUID(),worldId:f.owner.worldId,clockId:f.owner.clockId,clockProfileDigest:f.owner.clockProfileDigest,
        fromSimulationTime:'2001-01-01T00:00:00.000Z',toSimulationTime:'2001-01-02T00:00:00.000Z',actors:[f.owner]});
        mkdirSync(miningOperationAdmissionPath(f.root,f.request));expect(()=>f.admit()).toThrow();
        const db=new OwnedDatabase(path);try{expect(new NativeMiningRequestStore(db).current(f.demandId)?.phase).toBe('requested');}finally{db.close(true);}
        rmSync(miningOperationAdmissionPath(f.root,f.request),{recursive:true});
    }finally{f.close();}
});
test('managed private instance binds its own descriptor, checkpoint and retained failure marker',()=>{
    const f=miningSourceFixture(),directory=join(f.root,'server/engine/data');mkdirSync(directory,{recursive:true});const path=join(directory,'checkpoint.sqlite');new OwnedDatabase(path).close(true);
    const keys=['CONTROL_PLANE_SERVER_ID','MANAGED_WORKSPACE','ENGINE_ADMIN_URL','GATEWAY_URL'] as const,prior=Object.fromEntries(keys.map(k=>[k,process.env[k]])),worldId=`srv-${randomUUID()}`;
    try{process.env.CONTROL_PLANE_SERVER_ID=worldId;process.env.MANAGED_WORKSPACE=f.root;process.env.ENGINE_ADMIN_URL='http://127.0.0.1:7780';process.env.GATEWAY_URL='ws://127.0.0.1:7782';
        const s={schemaVersion:1 as const,selectionId:randomUUID(),worldId,clockId:f.owner.clockId,clockProfileDigest:f.owner.clockProfileDigest,
            fromSimulationTime:'2001-01-01T00:00:00.000Z',toSimulationTime:'2001-01-02T00:00:00.000Z',actors:[{...f.owner,worldId}]};
        installMiningExecutorSource(f.root,path,s);f.admit();const db=new OwnedDatabase(path);try{
            expect(miningExecutorSourceAvailable(f.root,db,nativeToolDigest(s))).toBeTrue();
            db.exec("CREATE TRIGGER fail_close BEFORE INSERT ON native_mining_request_event BEGIN SELECT RAISE(ABORT,'managed close failure'); END;");
            expect(()=>sealMiningOperationAdmission(f.root,f.request)).toThrow('managed close');expect(existsSync(join(f.root,'.local/agent-skills/mining-request-source.failed.json'))).toBeTrue();
            expect(miningExecutorSourceAvailable(f.root,db,nativeToolDigest(s))).toBeFalse();
        }finally{db.close(true);}
    }finally{for(const key of keys){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}f.close();}
});
