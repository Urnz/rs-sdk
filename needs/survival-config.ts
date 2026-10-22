import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileSurvivalProfile, type SurvivalMode } from './survival.js';

/** Configuration generation only in a newly owned, unpublished provisioning
 * stage. Never changes a live clock or reinterprets an existing needs DB. */
export function stageSurvivalConfiguration(root: string, mode: SurvivalMode, seed: string) {
    if (!existsSync(join(root, '.integration-stage.json')) || existsSync(join(root, 'config/survival-profile.json')) || existsSync(join(root, '.local/simulation/integration-fixture.json'))
        || existsSync(join(root, '.local/simulation/food-needs.sqlite')) || existsSync(join(root, '.local/simulation/simulation-clock.sqlite')))
        throw new Error('Survival configuration requires an unpublished fresh integration stage');
    const p = compileSurvivalProfile(JSON.parse(readFileSync(join(root, 'config/survival-rules.json'), 'utf8')), mode, seed);
    const definition = <T extends { digest: string }>(value: T) => { const { digest: _digest, ...body } = value; return body; };
    const files = { 'needs-policies.json': { schemaVersion: 1, policies: [definition(p.policy)] },
        'needs-dynamics-policies.json': { schemaVersion: 1, policies: [definition(p.dynamics)] },
        'food-loops.json': definition(p.food), 'simulation-clock.json': p.clock };
    for (const [file, content] of Object.entries(files)) writeFileSync(join(root, 'config', file), JSON.stringify(content, null, 2) + '\n');
    writeFileSync(join(root, 'config/survival-profile.json'), JSON.stringify(p.selection, null, 2) + '\n', { flag: 'wx' });
    return p;
}
