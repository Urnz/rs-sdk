import {expect,test} from 'bun:test';
import {join,resolve} from 'node:path';
import {loadIntegrationFixture} from '../../society-integration/fixture.js';
import {founderProcedureTrialFixture} from '../founder-trial-stage.js';
import {equalNativeInventoryQuantities} from '../../society-integration/native-inventory.js';
const root=resolve(import.meta.dir,'../..');
test('separate founder trial input is deterministic and declares only mainland position, one tool/hammer and two copper',()=>{
    const original=loadIntegrationFixture(join(root,'config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json')),before=JSON.stringify(original),trial=founderProcedureTrialFixture(original);
    expect(JSON.stringify(original)).toBe(before);expect(trial.digest).not.toBe(original.digest);expect(founderProcedureTrialFixture(original)).toEqual(trial);
    const subject=trial.avatars.find(a=>a.agentId===trial.kitchen.courierAgentId)!;
    expect(subject.position).toEqual({x:3280,z:3365,level:0});expect(subject.tools).toEqual([{itemId:1265,count:1},{itemId:2347,count:1},{itemId:436,count:2}]);
    expect(trial.skills).toEqual(original.skills);expect(trial.kitchen).toEqual(original.kitchen);expect(trial.housing).toEqual(original.housing);
    expect(trial.avatars.map(a=>[a.coinsGp,a.cookedReserve,a.personalSkills])).toEqual(original.avatars.map(a=>[a.coinsGp,a.cookedReserve,a.personalSkills]));
});
test('slot grouping cannot hide missing, extra, foreign or invalid native item quantities',()=>{
    const planned=[{id:436,count:2},{id:2347,count:1}];
    expect(equalNativeInventoryQuantities([{id:2347,count:1},{id:436,count:1},{id:436,count:1}],planned)).toBeTrue();
    for(const invalid of [[{id:436,count:1},{id:2347,count:1}],[{id:436,count:3},{id:2347,count:1}],[{id:438,count:2},{id:2347,count:1}],
        [{id:436,count:2},{id:2347,count:-1}],[{id:436,count:2},{id:2347,count:1,slot:2}]])expect(equalNativeInventoryQuantities(invalid,planned)).toBeFalse();
});
test('normal or obsolete fixture cannot silently become the accelerated native procedure trial',()=>{
    expect(()=>founderProcedureTrialFixture(loadIntegrationFixture(join(root,'config/fixtures/society-lobster-four-v1.json')))).toThrow('accelerated');
});
