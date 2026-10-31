import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootstrapIntegrationStage, bootstrapFoodTrialStage } from '../society-integration/bootstrap.js';
import { loadIntegrationFixture } from '../society-integration/fixture.js';
import { sealIntegrationBaseline } from '../society-integration/baseline.js';

const root = resolve(import.meta.dir, '..');
const fixture = loadIntegrationFixture(join(root, 'config/fixtures/society-lobster-four-v1.json'));
if (JSON.parse(readFileSync(join(root, '.integration-stage.json'), 'utf8')).fixtureDigest !== fixture.digest) throw new Error('Native bootstrap requires its staging capability');
const keyPath = join(root, 'server/engine/data/config/private.pem');
mkdirSync(join(root, 'server/engine/data/config'), { recursive: true });
// Transient local engine load requirement; never copied from the source world or kept in the baseline.
const temporaryKey = generateKeyPairSync('rsa', { modulusLength: 512, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
writeFileSync(keyPath, temporaryKey, { flag: 'wx' });
process.env.ENGINE_LOGIN_PRIVATE_KEY = temporaryKey;
try {
    // World must establish the engine module graph before Player/NetworkPlayer's
    // circular inheritance imports; native test hosts already do this first.
    const { default: World } = await import(pathToFileURL(join(root, 'server/engine/src/engine/World.ts')).href);
    const names = ['InvType', 'ObjType', 'NpcType', 'LocType', 'VarPlayerType', 'VarNpcType', 'VarBitType', 'ParamType', 'EnumType', 'StructType', 'SeqType', 'DbRowType', 'DbTableType'];
    for (const name of names) { const type = await import(pathToFileURL(join(root, `server/engine/src/cache/config/${name}.ts`)).href); type.default.load(join(root, 'server/engine/data/pack')); }
    const index = await import(pathToFileURL(join(root, 'server/engine/src/cache/config/DbTableIndex.ts')).href); index.default.init();
    const damage=process.argv.includes('--damage-founder-trial');
    if (fixture.nativeSiteProfile&&!damage) {
        // Read actual packed map/content without starting ticks or placing synthetic
        // facilities. Missing objects fail before any native save is provisioned.
        World.reload(); World.gameMap.init();
        const { default: LocType } = await import(pathToFileURL(join(root, 'server/engine/src/cache/config/LocType.ts')).href);
        const sites = JSON.parse(readFileSync(join(root, 'config/society-native-sites.json'), 'utf8'));
        const expected = [sites.kitchen.heat, ...sites.housing.beds.map((bed: object) => ({ ...bed, debugName: sites.housing.bedDebugName }))];
        for (const site of expected) if (!World.getLoc(site.x, site.z, site.level, LocType.getId(site.debugName)))
            throw new Error(`Actual native fixture site is missing: ${site.debugName} at ${site.x},${site.z},${site.level}`);
        console.log('Actual packed kitchen and both rental beds verified; no physical travel claimed.');
    }
    if(damage){
        const {damageFounderTrialTool}=await import(pathToFileURL(join(root,'server/engine/src/mods/FounderProcedureTrialNative.ts')).href);
        console.log(JSON.stringify(await damageFounderTrialTool(root))); // Explicit non-minimum trial precondition, not Mining credit.
    }else{
    const { nativeIntegrationBootstrapPorts } = await import(pathToFileURL(join(root, 'server/engine/src/mods/IntegrationFixtureNative.ts')).href);
    const ports = await nativeIntegrationBootstrapPorts(root);
    const trial = process.argv.includes('--food-trials');
    try {
        if (trial) {
            await bootstrapFoodTrialStage(root, fixture, ports);
            if(process.argv.includes('--founder-procedures')){
                const {provisionFounderProcedureTrial}=await import(pathToFileURL(join(root,'server/engine/src/mods/FounderProcedureTrialNative.ts')).href);
                await provisionFounderProcedureTrial(root,fixture);
            }
        }
        else { await bootstrapIntegrationStage(root, fixture, ports); sealIntegrationBaseline(root, fixture); }
    }
    finally { ports.close(); }
    console.log(trial ? 'Disposable native food trial world; no integration receipt or seal.'
        : 'Native integration fixture staged and sealed; no live acceptance executed.');
    }
} finally { delete process.env.ENGINE_LOGIN_PRIVATE_KEY; unlinkSync(keyPath); }
// Offline bootstrap deliberately never starts World.cycle(). World imports still
// create login/friend/logger workers, so an otherwise finished CLI would remain
// alive indefinitely. All native stores and the transient key are closed above.
process.exit(0);
