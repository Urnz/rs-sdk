import { expect, test } from 'bun:test';
import { selectThievingTarget } from './ThievingTargetSelection.js';
import type { EngineThievingKind } from './ThievingEvidenceStore.js';

test('both active pointers select exact procedure target, not retained tea seller',()=>{
    const npc={type:595,nid:22,x:3269,z:3411},loc={type:635,x:3269,z:3410};
    expect(selectThievingTarget('pickpocket',npc,loc)).toEqual({kind:'npc',entity:npc});
    for(const kind of ['container-theft','lockpick-door','property-burglary'] as const)
        expect(selectThievingTarget(kind,npc,loc)).toEqual({kind:'loc',entity:loc});
});
test('missing expected pointer refuses stale alternative pointer instead of misattributing evidence',()=>{
    const npc={type:595},loc={type:635};
    expect(()=>selectThievingTarget('pickpocket',null,loc)).toThrow('npc target');
    for(const kind of ['container-theft','lockpick-door','property-burglary'] as const)
        expect(()=>selectThievingTarget(kind,npc,null)).toThrow('loc target');
    expect(()=>selectThievingTarget('unknown' as EngineThievingKind,npc,loc)).toThrow('Unsupported');
});
