import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import type { IntegrationFixture } from './fixture.js';

const marker = 'config/integration-sites-profile.json';
const files = ['native-kitchen.json', 'native-housing.json', 'properties.json', 'facility-capabilities.json', 'business-work-policies.json', 'housing-units.json'];
const read = (root: string, name: string) => JSON.parse(readFileSync(join(root, 'config', name), 'utf8'));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export function integrationSiteProfile(root: string, binding: { profileId: string; digest: string }) {
    const profile = read(root, 'society-native-sites.json');
    check(profile.schemaVersion === 1 && profile.profileId === binding.profileId && digest(profile) === binding.digest, 'Native site profile differs');
    return profile;
}
/** Only a new owned stage: no reinterpretation of existing property, WIP or rental state. */
export function stageIntegrationSites(root: string, fixture: IntegrationFixture) {
    check(fixture.nativeSiteProfile && existsSync(join(root, '.integration-stage.json'))
        && JSON.parse(readFileSync(join(root, '.integration-stage.json'), 'utf8')).fixtureDigest === fixture.digest
        && ['.local/agent-state/agents.sqlite', '.local/simulation/simulation-clock.sqlite', '.local/admin/properties.sqlite',
            'server/engine/data/player-checkpoints.sqlite', marker].every(path => !existsSync(join(root, path))), 'Native site configuration requires a fresh unpublished stage');
    const profile = integrationSiteProfile(root, fixture.nativeSiteProfile), values = Object.fromEntries(files.map(name => [name, read(root, name)]));
    values['native-kitchen.json'].heat = profile.kitchen.heat;
    values['native-housing.json'].beds = profile.housing.beds;
    const property = values['properties.json'].properties.find((p: any) => p.propertyId === fixture.kitchen.propertyId);
    check(property, 'Kitchen Property is missing');
    property.location = profile.kitchen.propertyLocation; property.displayName = 'Karamjai konyha és raktár';
    property.description = 'A natív brimhaveni tűzhelyhez kötött konyha és raktár; a korábbi logical Property ID megmarad.';
    property.entryPoints = [{ entryPointId: 'kitchen-door', label: 'Konyhai bejárat', ...profile.kitchen.propertyLocation }]
        .map(({ region: _region, ...entry }: any) => entry);
    values['facility-capabilities.json'].facilities.find((f: any) => f.facilityId === 'karamja.fishing-hut.utility').label = 'Brimhaven native kitchen';
    for (const policy of values['business-work-policies.json'].policies.filter((p: any) => p.businessId === fixture.kitchen.businessId)) {
        const pin = fixture.skills.find(s => s.id === policy.requiredSkill.id); check(pin, 'Work procedure pin missing');
        policy.requiredSkill = { id: pin.id, version: pin.version };
    }
    const unit = values['housing-units.json'].units.find((u: any) => u.housingUnitId === 'falador.south-house.main');
    unit.bedSlots = profile.housing.beds.map((b: any, i: number) => ({ bedSlotId: b.bedSlotId, label: `Ground-floor bed ${i + 1}` }));
    for (const [name, value] of Object.entries(values)) writeFileSync(join(root, 'config', name), JSON.stringify(value, null, 2) + '\n');
    writeFileSync(join(root, marker), JSON.stringify({ binding: fixture.nativeSiteProfile, fixtureDigest: fixture.digest,
        generated: files.map(name => ({ name, digest: digest(values[name]) })) }, null, 2) + '\n', { flag: 'wx' });
}
export function withIntegrationSites<T>(root: string, fixture: IntegrationFixture, work: (effectiveRoot: string) => T): T {
    if (!fixture.nativeSiteProfile) return work(root);
    integrationSiteProfile(root, fixture.nativeSiteProfile);
    if (existsSync(join(root, marker))) {
        const current = JSON.parse(readFileSync(join(root, marker), 'utf8'));
        check(current.fixtureDigest === fixture.digest && digest(current.binding) === digest(fixture.nativeSiteProfile)
            && current.generated.length === files.length && files.every(name => current.generated.some((f: any) => f.name === name && f.digest === digest(read(root, name)))),
        'Generated native site configuration changed');
        return work(root);
    }
    const temporary = mkdtempSync(join(tmpdir(), 'si-native-sites-'));
    try {
        cpSync(join(root, 'config'), join(temporary, 'config'), { recursive: true });
        cpSync(join(root, 'agent-skills/catalog'), join(temporary, 'agent-skills/catalog'), { recursive: true });
        writeFileSync(join(temporary, '.integration-stage.json'), JSON.stringify({ fixtureDigest: fixture.digest }));
        stageIntegrationSites(temporary, fixture);
        return work(temporary);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
}
