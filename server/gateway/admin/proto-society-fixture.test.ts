import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportProtoSocietyFixture, fixtureDigest, validateProtoSocietyFixture }
    from './proto-society-fixture.js';
import { listAdminSkills } from './skill-catalog.js';

const fixturePath = join(import.meta.dir, '../../..', 'config', 'fixtures', 'varrock-proto-v1.json');

describe('varrock proto-society fixture manifest', () => {
    test('has six exact player bindings, one avatarless Business agent and a reproducible digest', () => {
        const source = readFileSync(fixturePath, 'utf8');
        const fixture = validateProtoSocietyFixture(JSON.parse(source) as unknown);
        expect(fixture.players).toHaveLength(6);
        expect(fixture.players.map(item => item.username)).toEqual([
            'VRCopper1', 'VRCopper2', 'VRIron1', 'VRSmith1', 'VRTrader1', 'VRWorker1'
        ]);
        expect(fixture.business.institutionAgentId).toBe('varrock-forge-mind');
        expect(fixtureDigest(fixture)).toBe(fixture.baselineDigest);
        expect(validateProtoSocietyFixture(JSON.parse(exportProtoSocietyFixture(fixture))).baselineDigest)
            .toBe(fixture.baselineDigest);
    });

    test('contains exact asset, goal, memory, skill and autonomy baselines without credentials', () => {
        const fixture = validateProtoSocietyFixture(JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown);
        for (const player of fixture.players) {
            expect(player.goals.map(goal => goal.horizon)).toEqual(['life', 'long-term', 'current', 'immediate']);
            expect(player.memorySeeds.length).toBeGreaterThan(0);
            expect(player.knownSkills.length).toBeGreaterThan(0);
            expect(player.autonomy).toMatchObject({ status: 'desired', policyVersion: '1.0.0' });
            expect(player.provenance).toBe('fixture-bootstrap');
        }
        expect(JSON.stringify(fixture)).not.toMatch(/password|credential|token|secret/i);
        expect(fixture.selfSustaining).toBeFalse();
        expect(fixture.externalDependencies.every(item => item.kind === 'vanilla-npc-shop' && item.measured))
            .toBeTrue();
        expect(fixture.players.filter(player => player.goals.at(-1)?.skill?.id.startsWith('mining.'))
            .every(player => player.inventory.some(item => item.id === 1265))).toBeTrue();
        expect(fixture.players.every(player => player.skills.overrides.some(skill =>
            skill.name === 'Hitpoints' && skill.experience === 9800))).toBeTrue();
        expect(fixture.players.find(player => player.agentId === 'vriron1')?.skills.overrides)
            .toContainEqual({ name: 'Mining', experience: 34100 });
        expect(fixture.players.filter(player => ['vrcopper1', 'vrcopper2', 'vrworker1'].includes(player.agentId))
            .every(player => player.skills.overrides.some(skill =>
                skill.name === 'Mining' && skill.experience === 18600))).toBeTrue();
        expect(fixture.players.find(player => player.agentId === 'vrsmith1')?.skills.overrides)
            .toContainEqual({ name: 'Smithing', experience: 18600 });
        expect(fixture.players.find(player => player.agentId === 'vrtrader1')?.coinPlacement)
            .toBe('inventory');
        expect(fixture.players.filter(player => player.agentId !== 'vrtrader1')
            .every(player => player.coinPlacement === 'bank')).toBeTrue();
        expect(fixture.business.workOrders).toHaveLength(2);
    });

    test('references only exact versions from the shared verified skill catalog', async () => {
        const fixture = validateProtoSocietyFixture(JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown);
        const verified = new Set((await listAdminSkills()).map(skill => skill.reference));
        const allowlisted = new Set(fixture.autonomousSkillAllowlist.map(skill => `${skill.id}@${skill.version}`));
        const references = fixture.players.flatMap(player => player.knownSkills)
            .map(skill => `${skill.id}@${skill.version}`);
        expect(allowlisted.size).toBe(10);
        expect([...allowlisted].every(reference => verified.has(reference))).toBeTrue();
        expect(references.every(reference => allowlisted.has(reference))).toBeTrue();
        expect(fixture.players.every(player => player.goals.at(-1)?.skill
            && player.knownSkills.some(skill => skill.id === player.goals.at(-1)!.skill!.id
                && skill.version === player.goals.at(-1)!.skill!.version))).toBeTrue();
    });

    test('rejects digest tampering, ambiguous bindings and missing equipment slots', () => {
        const source = JSON.parse(readFileSync(fixturePath, 'utf8')) as any;
        expect(() => validateProtoSocietyFixture({ ...source, seed: 'changed' })).toThrow('digest does not match');
        expect(() => validateProtoSocietyFixture({ ...source, players: source.players.map((player: any, index: number) =>
            index ? player : { ...player, agentId: 'another-agent' }) }, false)).toThrow('exact username-agent-player');
        expect(() => validateProtoSocietyFixture({ ...source, players: source.players.map((player: any, index: number) =>
            index ? player : { ...player, equipment: [{ id: 1265, count: 1 }] }) }, false)).toThrow('exact slots');
        expect(() => validateProtoSocietyFixture({ ...source, autonomousSkillAllowlist:
            source.autonomousSkillAllowlist.slice(1) }, false)).toThrow('exact ten-skill');
        expect(() => validateProtoSocietyFixture({ ...source, players: source.players.map((player: any, index: number) =>
            index ? player : { ...player, knownSkills: [{ id: 'draft.only', version: '0.1.0' }] }) }, false))
            .toThrow('outside the autonomous allowlist');
    });
});
