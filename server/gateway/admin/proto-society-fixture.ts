import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface FixtureSkillReference { id: string; version: string }
export interface FixtureItem { id: number; count: number; slot?: number }
export interface FixtureGoal { goalId: string; parentGoalId: string | null;
    horizon: 'life' | 'long-term' | 'current' | 'immediate'; title: string; description: string; priority: number;
    skill: FixtureSkillReference | null }
export interface FixturePlayer {
    username: string; agentId: string; displayName: string; background: string; personalityTraits: string[];
    controlProfile: { decisionIntervalMs: number; maxDecisionsPerDay: number;
        dailyLlmBudgetMicros: number; dailyOperationalBudgetGp: number };
    position: { x: number; z: number; level: number; region: string };
    skills: { defaultExperience: number; overrides: Array<{ name: string; experience: number }> };
    inventory: FixtureItem[]; equipment: FixtureItem[]; bank: FixtureItem[]; coins: number;
    coinPlacement: 'inventory' | 'bank';
    goals: FixtureGoal[];
    memorySeeds: Array<{ episodeId: string; kind: 'observation' | 'economic'; summary: string;
        details: string; importance: number; tags: string[] }>;
    knownSkills: FixtureSkillReference[];
    autonomy: { status: 'desired'; policyId: string; policyVersion: string };
    provenance: 'fixture-bootstrap';
}
export interface ProtoSocietyFixture {
    schemaVersion: 1; fixtureId: 'varrock-proto-v1'; fixtureVersion: string; seed: string; worldBuild: string;
    provenance: 'fixture-bootstrap'; baselineDigest: string; autonomousSkillAllowlist: FixtureSkillReference[];
    players: FixturePlayer[];
    business: { businessId: 'varrock-forge'; institutionAgentId: string; name: string; summary: string;
        property: { propertyId: 'varrock.east-workshop'; expectedState: 'available' | 'owned'; provenance: 'fixture-bootstrap' };
        treasury: { balanceGp: number; provenance: 'fixture-bootstrap' };
        policy: { proposalId: string; objective: string; mode: 'balanced' | 'growth' | 'profit' | 'survival';
            maxRewardGp: number; preferredSkills: FixtureSkillReference[]; approvalNote: string };
        employments: Array<{ employmentId: string; workerAgentId: string; role: 'manager' | 'worker';
            title: string; wageGp: number; requiredSkill: FixtureSkillReference }>;
        workOrders: Array<{ requestId: string; assigneeAgentId: string; skill: FixtureSkillReference;
            parameters: Record<string, string | number | boolean>; objective: string; rewardGp: number }> };
    externalDependencies: Array<{ dependencyId: string; kind: 'vanilla-npc-shop'; description: string;
        measured: true; metric: string }>;
    selfSustaining: false;
    restorePlan: { engineSaveBackups: 'per-player-before-edit'; agentState: 'sqlite-backup-before-apply';
        domainDatabases: string[]; rollbackRequiresStoppedStack: true };
}

const ID = /^[a-z0-9][a-z0-9._-]{1,95}$/;
const USERNAME = /^[a-zA-Z0-9]{1,12}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) throw new Error(`${field} has unknown fields: ${unknown.join(', ')}`);
}

function boundedText(value: unknown, field: string, maximum: number): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw new Error(`${field} is invalid`);
    return value.trim();
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} is invalid`);
    }
    return Number(value);
}

function reference(value: unknown, field: string): FixtureSkillReference {
    const entry = object(value, field); exactKeys(entry, ['id', 'version'], field);
    const id = boundedText(entry.id, `${field}.id`, 120), version = boundedText(entry.version, `${field}.version`, 32);
    if (!ID.test(id) || !VERSION.test(version)) throw new Error(`${field} is invalid`);
    return { id, version };
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
}

export function fixtureDigest(value: Omit<ProtoSocietyFixture, 'baselineDigest'> | ProtoSocietyFixture): string {
    const { baselineDigest: _ignored, ...payload } = value as ProtoSocietyFixture;
    return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

function validatePlayer(value: unknown, index: number): FixturePlayer {
    const field = `players[${index}]`, player = object(value, field);
    exactKeys(player, ['username', 'agentId', 'displayName', 'background', 'personalityTraits', 'position',
        'skills', 'inventory', 'equipment', 'bank', 'coins', 'coinPlacement', 'goals', 'memorySeeds', 'knownSkills',
        'controlProfile', 'autonomy', 'provenance'], field);
    const username = boundedText(player.username, `${field}.username`, 12);
    const agentId = boundedText(player.agentId, `${field}.agentId`, 64);
    if (!USERNAME.test(username) || !ID.test(agentId) || username.toLowerCase() !== agentId) {
        throw new Error(`${field} must have an exact username-agent-player binding`);
    }
    if (player.provenance !== 'fixture-bootstrap') throw new Error(`${field}.provenance is invalid`);
    const controlProfile = object(player.controlProfile, `${field}.controlProfile`);
    exactKeys(controlProfile, ['decisionIntervalMs', 'maxDecisionsPerDay', 'dailyLlmBudgetMicros',
        'dailyOperationalBudgetGp'], `${field}.controlProfile`);
    const position = object(player.position, `${field}.position`);
    exactKeys(position, ['x', 'z', 'level', 'region'], `${field}.position`);
    const skills = object(player.skills, `${field}.skills`);
    exactKeys(skills, ['defaultExperience', 'overrides'], `${field}.skills`);
    if (!Array.isArray(skills.overrides) || skills.overrides.length > 19) throw new Error(`${field}.skills is invalid`);
    const overrides = skills.overrides.map((raw, skillIndex) => {
        const item = object(raw, `${field}.skills.overrides[${skillIndex}]`);
        exactKeys(item, ['name', 'experience'], `${field}.skills.overrides[${skillIndex}]`);
        return { name: boundedText(item.name, 'skill name', 32),
            experience: integer(item.experience, 'skill experience', 0, 2_000_000_000) };
    });
    if (new Set(overrides.map(item => item.name.toLowerCase())).size !== overrides.length) {
        throw new Error(`${field}.skills has duplicate overrides`);
    }
    const parseItems = (raw: unknown, name: string, equipment: boolean): FixtureItem[] => {
        if (!Array.isArray(raw) || raw.length > 496) throw new Error(`${field}.${name} is invalid`);
        const slots = new Set<number>();
        return raw.map((entry, itemIndex) => {
            const item = object(entry, `${field}.${name}[${itemIndex}]`);
            exactKeys(item, ['id', 'count', 'slot'], `${field}.${name}[${itemIndex}]`);
            const parsed: FixtureItem = { id: integer(item.id, 'item id', 0, 65_534),
                count: integer(item.count, 'item count', 1, 2_147_483_647) };
            if (item.slot !== undefined) parsed.slot = integer(item.slot, 'item slot', 0, equipment ? 13 : 495);
            if (equipment && parsed.slot === undefined) throw new Error(`${field}.equipment requires exact slots`);
            if (parsed.slot !== undefined && !slots.add(parsed.slot)) throw new Error(`${field}.${name} has duplicate slots`);
            if (parsed.id === 995) throw new Error(`${field}.${name} must keep coins in the dedicated field`);
            return parsed;
        });
    };
    if (!Array.isArray(player.personalityTraits) || player.personalityTraits.length < 1) throw new Error(`${field}.personalityTraits is invalid`);
    if (!Array.isArray(player.goals) || player.goals.length !== 4) throw new Error(`${field} requires an exact four-level goal hierarchy`);
    const goals = player.goals as FixtureGoal[];
    if (goals.map(goal => goal.horizon).join('|') !== 'life|long-term|current|immediate'
        || goals.some((goal, goalIndex) => goal.parentGoalId !== (goalIndex === 0 ? null : goals[goalIndex - 1]!.goalId))) {
        throw new Error(`${field}.goals hierarchy is invalid`);
    }
    if (!Array.isArray(player.knownSkills) || player.knownSkills.length < 1) throw new Error(`${field}.knownSkills is invalid`);
    const autonomy = object(player.autonomy, `${field}.autonomy`);
    if (autonomy.status !== 'desired' || !ID.test(String(autonomy.policyId)) || !VERSION.test(String(autonomy.policyVersion))) {
        throw new Error(`${field}.autonomy is invalid`);
    }
    return { username, agentId, displayName: boundedText(player.displayName, `${field}.displayName`, 80),
        background: boundedText(player.background, `${field}.background`, 1000),
        personalityTraits: (player.personalityTraits as unknown[]).map((item, trait) => boundedText(item, `${field}.personalityTraits[${trait}]`, 80)),
        controlProfile: {
            decisionIntervalMs: integer(controlProfile.decisionIntervalMs, 'decisionIntervalMs', 1_000, 86_400_000),
            maxDecisionsPerDay: integer(controlProfile.maxDecisionsPerDay, 'maxDecisionsPerDay', 1, 10_000),
            dailyLlmBudgetMicros: integer(controlProfile.dailyLlmBudgetMicros, 'dailyLlmBudgetMicros', 0, 1_000_000_000),
            dailyOperationalBudgetGp: integer(controlProfile.dailyOperationalBudgetGp,
                'dailyOperationalBudgetGp', 0, 2_147_483_647)
        },
        position: { x: integer(position.x, 'x', 0, 16_383), z: integer(position.z, 'z', 0, 16_383),
            level: integer(position.level, 'level', 0, 3), region: boundedText(position.region, 'region', 80) },
        skills: { defaultExperience: integer(skills.defaultExperience, 'defaultExperience', 0, 2_000_000_000), overrides },
        inventory: parseItems(player.inventory, 'inventory', false), equipment: parseItems(player.equipment, 'equipment', true),
        bank: parseItems(player.bank, 'bank', false), coins: integer(player.coins, `${field}.coins`, 0, 2_147_483_647),
        coinPlacement: player.coinPlacement === 'inventory' || player.coinPlacement === 'bank'
            ? player.coinPlacement : (() => { throw new Error(`${field}.coinPlacement is invalid`); })(),
        goals, memorySeeds: player.memorySeeds as FixturePlayer['memorySeeds'],
        knownSkills: (player.knownSkills as unknown[]).map((item, skill) => reference(item, `${field}.knownSkills[${skill}]`)),
        autonomy: { status: 'desired', policyId: String(autonomy.policyId), policyVersion: String(autonomy.policyVersion) },
        provenance: 'fixture-bootstrap' };
}

export function validateProtoSocietyFixture(value: unknown, verifyDigest = true): ProtoSocietyFixture {
    const manifest = object(value, 'fixture');
    exactKeys(manifest, ['schemaVersion', 'fixtureId', 'fixtureVersion', 'seed', 'worldBuild', 'provenance',
        'baselineDigest', 'autonomousSkillAllowlist', 'players', 'business', 'externalDependencies',
        'selfSustaining', 'restorePlan'], 'fixture');
    if (manifest.schemaVersion !== 1 || manifest.fixtureId !== 'varrock-proto-v1'
        || manifest.provenance !== 'fixture-bootstrap' || manifest.selfSustaining !== false) {
        throw new Error('Fixture identity or safety declaration is invalid');
    }
    if (!Array.isArray(manifest.autonomousSkillAllowlist) || manifest.autonomousSkillAllowlist.length !== 10) {
        throw new Error('Fixture requires an exact ten-skill autonomous allowlist');
    }
    const autonomousSkillAllowlist = (manifest.autonomousSkillAllowlist as unknown[])
        .map((item, index) => reference(item, `autonomousSkillAllowlist[${index}]`));
    const allowlistedReferences = new Set(autonomousSkillAllowlist.map(skill => `${skill.id}@${skill.version}`));
    if (allowlistedReferences.size !== autonomousSkillAllowlist.length) {
        throw new Error('Fixture autonomous skill allowlist contains duplicate references');
    }
    if (!Array.isArray(manifest.players) || manifest.players.length !== 6) throw new Error('Fixture requires exactly six players');
    const players = manifest.players.map(validatePlayer);
    if (new Set(players.map(player => player.agentId)).size !== 6) throw new Error('Fixture player bindings must be unique');
    for (const player of players) {
        const known = new Set(player.knownSkills.map(skill => `${skill.id}@${skill.version}`));
        if ([...known].some(skill => !allowlistedReferences.has(skill))) {
            throw new Error(`${player.agentId} has a known skill outside the autonomous allowlist`);
        }
        const immediateSkill = player.goals.at(-1)?.skill;
        if (!immediateSkill || !known.has(`${immediateSkill.id}@${immediateSkill.version}`)) {
            throw new Error(`${player.agentId} immediate goal must use an exact known skill`);
        }
    }
    const business = object(manifest.business, 'business') as unknown as ProtoSocietyFixture['business'];
    if (business.businessId !== 'varrock-forge' || business.institutionAgentId !== 'varrock-forge-mind'
        || business.property?.propertyId !== 'varrock.east-workshop' || business.property.provenance !== 'fixture-bootstrap'
        || business.treasury?.provenance !== 'fixture-bootstrap' || business.employments?.length < 2
        || business.workOrders?.length < 2
        || !UUID.test(business.policy?.proposalId)) throw new Error('Fixture Business baseline is invalid');
    if (!business.employments.every(item => UUID.test(item.employmentId)
        && players.some(player => player.agentId === item.workerAgentId))) throw new Error('Fixture employment is invalid');
    if (!business.workOrders.every(item => UUID.test(item.requestId) && item.rewardGp >= 0
        && players.some(player => player.agentId === item.assigneeAgentId
            && player.knownSkills.some(skill => `${skill.id}@${skill.version}`
                === `${item.skill.id}@${item.skill.version}`)))) throw new Error('Fixture work order is invalid');
    if (!Array.isArray(manifest.externalDependencies) || !(manifest.externalDependencies as unknown[]).every(raw => {
        const dependency = raw as ProtoSocietyFixture['externalDependencies'][number];
        return dependency.kind === 'vanilla-npc-shop' && dependency.measured === true && !!dependency.metric;
    })) throw new Error('Fixture external economy dependencies are invalid');
    const result = { ...manifest, autonomousSkillAllowlist, players } as unknown as ProtoSocietyFixture;
    if (!DIGEST.test(String(manifest.baselineDigest))) throw new Error('Fixture baseline digest is invalid');
    if (verifyDigest && fixtureDigest(result) !== result.baselineDigest) throw new Error('Fixture baseline digest does not match');
    return result;
}

export async function loadProtoSocietyFixture(path: string): Promise<ProtoSocietyFixture> {
    return validateProtoSocietyFixture(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export function exportProtoSocietyFixture(value: ProtoSocietyFixture): string {
    const checked = validateProtoSocietyFixture(value);
    return `${JSON.stringify(canonical(checked), null, 2)}\n`;
}
