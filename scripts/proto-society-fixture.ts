import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FixtureBootstrapStore } from '../server/gateway/admin/fixture-bootstrap-store.js';
import { applyProtoSocietyFixture, preflightProtoSocietyFixture,
    restoreProtoSocietyDatabases, restoreProtoSocietyEngineSaves }
    from '../server/gateway/admin/proto-society-bootstrap.js';
import { exportProtoSocietyFixture, loadProtoSocietyFixture } from '../server/gateway/admin/proto-society-fixture.js';
import { fixtureBootstrapDbPath, repoRoot } from '../server/gateway/admin/paths.js';

const { positionals, values } = parseArgs({ allowPositionals: true, strict: true, options: {
    manifest: { type: 'string', short: 'm', default: 'config/fixtures/varrock-proto-v1.json' },
    output: { type: 'string', short: 'o' }, 'stack-stopped': { type: 'boolean', default: false }
} });
const command = positionals[0] ?? 'preview';
const manifestPath = resolve(repoRoot, values.manifest);
const fixture = await loadProtoSocietyFixture(manifestPath);

if (command === 'preview') {
    console.log(JSON.stringify(await preflightProtoSocietyFixture(fixture), null, 2));
} else if (command === 'apply') {
    console.log(JSON.stringify(await applyProtoSocietyFixture(fixture), null, 2));
} else if (command === 'export') {
    const output = exportProtoSocietyFixture(fixture);
    if (values.output) await writeFile(resolve(repoRoot, values.output), output, { encoding: 'utf8', flag: 'wx' });
    else process.stdout.write(output);
} else if (command === 'status') {
    const store = new FixtureBootstrapStore(fixtureBootstrapDbPath);
    try {
        console.log(JSON.stringify({ application: store.get(fixture.fixtureId),
            provenance: store.listProvenance(fixture.fixtureId) }, null, 2));
    } finally { store.close(); }
} else if (command === 'restore-engine') {
    console.log(JSON.stringify(await restoreProtoSocietyEngineSaves(fixture.fixtureId), null, 2));
} else if (command === 'restore-databases') {
    if (!values['stack-stopped']) throw new Error('restore-databases requires --stack-stopped after the entire local stack was stopped');
    console.log(JSON.stringify(restoreProtoSocietyDatabases(fixture.fixtureId, true), null, 2));
} else {
    throw new Error('Command must be preview, apply, export, status, restore-engine or restore-databases');
}
