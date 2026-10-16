import { describe, expect, test } from 'bun:test';
import { captureThievingSightCandidates, shouldCaptureThievingSight, type SightPlayer } from './ThievingSightCandidates.js';

const actor: SightPlayer = { username: 'Thief1', x: 3000, z: 3000, level: 0, isActive: true };
const player = (username: string, x: number, z: number, level = 0, isActive = true): SightPlayer =>
    ({ username, x, z, level, isActive });

describe('engine line-of-sight candidate snapshot', () => {
    test('captures only the completed transfer or Property entry combinations', () => {
        for (const kind of ['pickpocket', 'container-theft', 'lockpick-door', 'property-burglary'])
            for (const effect of ['item-transfer', 'lock-opened', 'entry-completed'])
                expect(shouldCaptureThievingSight(kind, effect)).toBe(
                    (kind === 'property-burglary' && effect === 'entry-completed')
                    || (['pickpocket', 'container-theft'].includes(kind) && effect === 'item-transfer'));
    });
    test('retains only active same-level players in range and line of sight', () => {
        const checked: string[] = [];
        const snapshot = captureThievingSightCandidates(actor, [actor,
            player('Zoe', 3002, 3001), player('Amy', 2999, 3001), player('Blocked', 3001, 3000),
            player('Far', 3020, 3000), player('OtherLevel', 3000, 3001, 1),
            player('Inactive', 3000, 3001, 0, false)],
        (_level, x) => { checked.push(String(x)); return x !== 3001; }, 5);
        expect(snapshot).toEqual({ actor: { x: 3000, z: 3000, level: 0 }, radius: 5,
            candidates: [{ username: 'amy', x: 2999, z: 3001, level: 0 },
                { username: 'zoe', x: 3002, z: 3001, level: 0 }] });
        expect(checked).toEqual(['3002', '2999', '3001']);
    });
    test('empty opportunity is recorded distinctly from an absent legacy snapshot', () => {
        expect(captureThievingSightCandidates(actor, [], () => true).candidates).toEqual([]);
        expect(() => captureThievingSightCandidates(actor, [], () => true, 16)).toThrow('between 1 and 15');
    });
});
