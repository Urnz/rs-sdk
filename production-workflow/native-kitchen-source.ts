import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { assertNativeFoodPath, assertNativeFoodDomainPath, type NativeFoodSourceOptions } from '../food-loop/native-source.js';
import { readNativeKitchenWip, authorizeKitchenRole, authorizeKitchenGrant, type NativeKitchenBinding } from './native-kitchen-wip.js';
import { loadDefaultBusinessRoleCatalog } from '../business-roles/index.js';
import { loadFacilityCapabilityCatalog } from '../facility-capability/catalog.js';
import { join } from 'node:path';
import { loadNativeKitchenPolicy } from './native-kitchen-policy.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { readNativeKitchen } from '../server/engine/src/mods/NativeKitchenStore.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';

export class NativeKitchenReservationSource {
    private readonly db: OwnedDatabase;
    constructor(readonly options: NativeFoodSourceOptions) {
        assertNativeFoodDomainPath(options); this.db = new OwnedDatabase(options.checkpointPath, { readonly: true, strict: true });
    }
    close(): void { this.db.close(true); }
    read(runId: string, clock?: SimulationClockObservation): NativeKitchenBinding {
        let result!: NativeKitchenBinding;
        this.db.transaction(() => {
            const row = readNativeKitchenWip(this.db).find(row => row.binding.intent.runId === runId);
            if (!row) throw new Error('Native kitchen reservation is unavailable');
            const intent = row.binding.intent;
            if (intent.worldId !== this.options.worldId || foodDigest(loadNativeKitchenPolicy(this.options.workspace)) !== foodDigest(intent.policy))
                throw new Error('Native kitchen reservation world/policy differs');
            if (clock) {
                if (row.revoked || row.phase !== 'prepared' || clock.clockId !== intent.clockId || clock.profileDigest !== intent.clockProfileDigest || clock.status !== 'running')
                    throw new Error('Native kitchen authorization is no longer active');
                authorizeKitchenRole(this.db, intent, loadDefaultBusinessRoleCatalog());
                authorizeKitchenGrant(intent, loadFacilityCapabilityCatalog(join(this.options.workspace, 'config/facility-capabilities.json')), clock.simulationTime,
                    grant => foodDigest(grant) === foodDigest(intent.grant));
            }
            result = structuredClone(row.binding);
        }).deferred();
        return result;
    }
}
export class NativeKitchenResultSource {
    private readonly db: OwnedDatabase;
    private active = false;
    constructor(readonly options: NativeFoodSourceOptions) {
        assertNativeFoodPath(options); this.db = new OwnedDatabase(options.checkpointPath, { readonly: true, strict: true });
    }
    close(): void { this.db.close(true); }
    snapshot<T>(work: () => T): T {
        if (this.active) return work();
        let result!: T;
        this.db.transaction(() => { this.active = true; try { result = work(); } finally { this.active = false; } }).deferred();
        return result;
    }
    result(binding: NativeKitchenBinding) {
        if (!this.active) throw new Error('Native kitchen result requires a read snapshot');
        if (binding.intent.worldId !== this.options.worldId) throw new Error('Native kitchen result world differs');
        const result = readNativeKitchen(this.db).find(result => result.binding.intent.runId === binding.intent.runId);
        if (!result || foodDigest(result.binding) !== foodDigest(binding)) throw new Error('Native kitchen result binding differs');
        return structuredClone(result);
    }
}
