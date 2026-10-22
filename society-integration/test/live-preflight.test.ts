import { expect, test } from 'bun:test';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectD1Feasibility, inspectMealReachability, validateD1Plan } from '../live-preflight.js';
import { loadIntegrationFixture, buildSurvivalIntegrationFixture } from '../fixture.js';

test('day-survival profiles expose the changed clock and finite supply limits without weakening D1 acceptance', async () => {
    for (const mode of ['live', 'accelerated-test'] as const) {
        const f = loadIntegrationFixture(join(root, `config/fixtures/society-lobster-four-${mode}-day-v1.json`));
        expect(f).toEqual(buildSurvivalIntegrationFixture(fixture, mode));
        const p = { ...plan, planId: `society-lobster-four-d1-${mode}`, fixtureDigest: f.digest };
        const report = await inspectD1Feasibility(root, f, p);
        expect(report.mealBound.earliestFirstMealMinutes).toBe(mode === 'live' ? 60 : 5);
        expect(report.survivalBound?.earliestSecondMealMinutes).toBe(mode === 'live' ? 120 : 10);
        expect(report.gates.find(g => g.id === 'meal-reachability')?.status).toBe('blocked');
        expect(report.liveRunStarted).toBeFalse();
    }
});

const root = resolve(import.meta.dir, '../..'), fixture = loadIntegrationFixture(join(root, 'config/fixtures/society-lobster-four-v1.json'));
const plan = JSON.parse(readFileSync(join(root, 'config/fixtures/society-lobster-four-d1-plan-v1.json'), 'utf8'));
test('D1 candidate pins the real four-avatar fixture, bounds restart and capacity without weakening acceptance', () => {
    expect(validateD1Plan(plan, fixture)).toEqual(plan);
    expect(fixture.avatars.map(a => a.coinsGp).reduce((n, p) => n + p, fixture.kitchen.treasuryGp)).toBe(3800);
});
for (const [name, edit] of [
    ['foreign fixture', (p: any) => { p.fixtureDigest = '0'.repeat(64); }],
    ['numeric plan identity', (p: any) => { p.planId = 123; }],
    ['shortened window', (p: any) => { p.durationMinutes = 59; }],
    ['overlong window', (p: any) => { p.durationMinutes = 91; }],
    ['provider costs', (p: any) => { p.providerCalls = 1; }],
    ['reduced meals', (p: any) => { p.minimumConsumesPerAvatar = 1; }],
    ['reduced demand', (p: any) => { p.minimumSatisfiedDemandBasisPoints = 9000; }],
    ['late restart', (p: any) => { p.restartAfterMinutes = 89; }],
    ['unbounded shortage', (p: any) => { p.plannedInputShortage.endsAfterMinutes = 91; }],
    ['third simultaneous bed', (p: any) => { p.bedWindows = ['sicook', 'sifisher', 'sicourier'].map(agentId => ({ agentId, startsAfterMinutes: 1, endsAfterMinutes: 10 })); }],
    ['same tenant in two beds', (p: any) => { p.bedWindows = [p.bedWindows[0], p.bedWindows[0]]; }],
    ['invented authority', (p: any) => { p.liveStartAuthorized = true; }]
] as const) test(`D1 plan rejects ${name}`, () => { const p = structuredClone(plan); edit(p); expect(() => validateD1Plan(p, fixture)).toThrow(); });

test('normal 1:1 hunger proves that not even the first automatic meal is reachable in the D1 window', () => {
    expect(inspectMealReachability(0, 300, 6000, 90)).toEqual({ initialHunger: 0, maximumAccrualPerHour: 300,
        hungerThreshold: 6000, wallMinutes: 90, unitDivisor: 60, maximumHungerNumerator: '27000', earliestFirstMealMinutes: 1200, firstMealReachable: false });
    expect(inspectMealReachability(0, 300, 6000, 1200).firstMealReachable).toBeTrue();
    expect(inspectMealReachability(0, 0, 6000, 90).earliestFirstMealMinutes).toBeNull();
    expect(inspectMealReachability(5999, 1, 6000, 59).firstMealReachable).toBeFalse();
    expect(inspectMealReachability(5999, 1, 6000, 60).firstMealReachable).toBeTrue();
});

test('actual D1 preflight retains all draft, physiological, route and result-archive blockers without creating a world', async () => {
    const report = await inspectD1Feasibility(root, fixture, plan);
    expect(report.liveStartAuthorized).toBeFalse(); expect(report.liveRunStarted).toBeFalse(); expect(report.liveVerdict).toBe('not-run');
    expect(report.verifiedSkills).toHaveLength(1); expect(report.opening.totalGp).toBe(3800);
    expect(report.gates.find(g => g.id === 'publication')?.status).toBe('blocked');
    expect(report.gates.find(g => g.id === 'meal-reachability')?.status).toBe('blocked');
    expect(report.gates.find(g => g.id === 'native-travel')?.status).toBe('unverified');
    expect(report.gates.find(g => g.id === 'archive-and-restore')?.status).toBe('unverified');
    expect(report.mealBound.maximumHungerNumerator).toBe('27000');
});

test('production D1 CLI returns blocked and refuses unsupported startup/output without writing native data or a false run result', () => {
    const child = Bun.spawnSync([process.execPath, join(root, 'scripts/society-integration-live.ts'), 'preflight'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    expect(child.exitCode, child.stderr.toString()).toBe(2);
    const record = JSON.parse(child.stdout.toString());
    expect(record.nativeSourcesUnchanged).toBeTrue(); expect(record.nativeBefore).toHaveLength(51);
    expect(record.report.liveVerdict).toBe('not-run'); expect(record.report.unresolvedGateCount).toBe(6);
    const directory = mkdtempSync(join(tmpdir(), 'si-a15-plan-'));
    try {
        const path = join(directory, 'report.json');
        const outside = Bun.spawnSync([process.execPath, join(root, 'scripts/society-integration-live.ts'), 'preflight', '--output', path], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
        expect(outside.exitCode).toBe(1); expect(existsSync(path)).toBeFalse();
        const start = Bun.spawnSync([process.execPath, join(root, 'scripts/society-integration-live.ts'), 'start'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
        expect(start.exitCode).toBe(1); expect(start.stderr.toString()).toContain('Usage:');
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
