import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as rsbuf from '#/network/rsbuf/index.js';
import { anonymousVisualDigest, witnessSessionToken, witnessContinuityTracker, selectVisibleWitnesses } from './WitnessContinuity.js';
import { isClientConnected } from '#/engine/entity/NetworkPlayer.js';
import { selectThievingTarget } from './ThievingTargetSelection.js';

import InvType from '#/cache/config/InvType.js';
import LocType from '#/cache/config/LocType.js';
import NpcType from '#/cache/config/NpcType.js';
import ObjType from '#/cache/config/ObjType.js';
import { PlayerStat } from '#/engine/entity/PlayerStat.js';
import { isLineOfSight } from '#/engine/GameMap.js';
import ScriptState from '#/engine/script/ScriptState.js';
import World from '#/engine/World.js';
import { getPropertyRuntime } from './PropertyRuntime.js';
import { captureThievingSightCandidates, shouldCaptureThievingSight } from './ThievingSightCandidates.js';
import { getThievingEvidenceStore, type EngineThievingEffect, type EngineThievingItemDelta,
    type EnginePropertyAccessSnapshot, type EngineThievingKind, type EngineThievingTarget } from './ThievingEvidenceStore.js';
import { loadHousingEffectPolicyCatalog, loadHousingTierPolicyCatalog, loadHousingUnitCatalog,
    loadFurnishingCatalog } from '../../../../housing/config.js';
import { FurnishingPlacementStore } from '../../../../housing/furnishing-store.js';
import { loadStorageSurfaceBindings } from '../../../../housing/placed-storage-security.js';
import { loadHousingSecurityPolicy } from '../../../../housing/security.js';
import { loadEngineHousingStorageLocations, resolveEngineHousingStorageAccess,
    type EngineHousingStorageAccessSnapshot } from '../../../../housing/engine-storage-runtime.js';

const kinds: Record<number, EngineThievingKind> = {
    1: 'pickpocket',
    2: 'lockpick-door',
    3: 'container-theft',
    4: 'property-burglary'
};
const effects: Record<number, EngineThievingEffect> = {
    1: 'item-transfer',
    2: 'lock-opened',
    3: 'entry-completed'
};

interface Observation {
    procedureKind: EngineThievingKind;
    target: EngineThievingTarget;
    startedAtEngineTick: number;
    thievingXp: number;
    inventory: Map<number, number>;
    propertyAccess?: EnginePropertyAccessSnapshot;
    storageAccess?: EngineHousingStorageAccessSnapshot;
}

const observations = new WeakMap<ScriptState, Observation>();

function inventorySnapshot(state: ScriptState): Map<number, number> {
    const result = new Map<number, number>();
    for (const item of state.activePlayer.getInventory(InvType.INV)?.itemsFiltered ?? []) {
        result.set(item.id, (result.get(item.id) ?? 0) + item.count);
    }
    return result;
}

function target(state: ScriptState, procedureKind: EngineThievingKind): EngineThievingTarget {
    const selected=selectThievingTarget(procedureKind,state._activeNpc,state._activeLoc);
    if (selected.kind==='npc') {
        const npc=selected.entity,type = NpcType.get(npc.type);
        return { kind: 'npc', typeId: type.id, instanceIndex: npc.nid,
            name: type.name ?? type.debugname ?? `npc-${type.id}`, x: npc.x,
            z: npc.z, level: npc.level };
    }
    {
        const loc=selected.entity,type = LocType.get(loc.type);
        return { kind: 'loc', typeId: type.id, instanceIndex: null,
            name: type.name ?? type.debugname ?? `loc-${type.id}`, x: loc.x,
            z: loc.z, level: loc.level };
    }
}

function propertyAccessSnapshot(state: ScriptState, observedTarget: EngineThievingTarget):
    EnginePropertyAccessSnapshot | undefined {
    const runtime = getPropertyRuntime();
    const entry = observedTarget.kind === 'loc'
        ? runtime.resolveEntryPoint(observedTarget.x, observedTarget.z, observedTarget.level) : null;
    return entry ? { propertyId: entry.property.propertyId, entryPointId: entry.entryPoint.entryPointId,
        owner: entry.property.state.owner, propertyStateVersion: entry.property.state.version,
        lockLevel: entry.property.security.lockLevel,
        actorAuthorized: runtime.canPlayerEnter(entry.property, state.activePlayer.username,
            state.activePlayer.staffModLevel >= 2) } : undefined;
}

const config = (name: string) => fileURLToPath(new URL(`../../../../config/${name}`, import.meta.url));
const furnishingDb = () => process.env.HOUSING_FURNISHING_DB
    || fileURLToPath(new URL('../../../../.local/admin/housing-furnishings.sqlite', import.meta.url));
let housingStorageConfiguration: ReturnType<typeof loadHousingStorageConfiguration> | null = null;

function loadHousingStorageConfiguration() {
    const runtime = getPropertyRuntime(), properties = runtime.list();
    const propertyIds = new Set(properties.map(value => value.propertyId));
    const hierarchy = loadHousingTierPolicyCatalog(config('housing-tier-policies.json')).policies[0]!;
    const effects = loadHousingEffectPolicyCatalog(config('housing-effect-policies.json'), hierarchy).policies[0]!;
    const units = loadHousingUnitCatalog(config('housing-units.json'), hierarchy, propertyIds);
    const furnishings = loadFurnishingCatalog(config('housing-furnishings.json'), propertyIds);
    const policy = loadHousingSecurityPolicy(config('housing-security-policy.json'), hierarchy, effects);
    const bindings = loadStorageSurfaceBindings(config('housing-storage-bindings.json'), furnishings, units, policy);
    const locations = loadEngineHousingStorageLocations(config('housing-engine-storage-locations.json'));
    return { hierarchy, effects, units, furnishings, policy, bindings, locations };
}

function storageAccessSnapshot(state: ScriptState, observedTarget: EngineThievingTarget):
    EngineHousingStorageAccessSnapshot | undefined {
    const configuration = housingStorageConfiguration ??= loadHousingStorageConfiguration();
    if (!configuration.locations.locations.some(value => observedTarget.kind === 'loc'
        && value.locTypeId === observedTarget.typeId && value.x === observedTarget.x
        && value.z === observedTarget.z && value.level === observedTarget.level)) return undefined;
    const placements = new FurnishingPlacementStore(furnishingDb(), configuration.furnishings);
    try {
        const runtime = getPropertyRuntime();
        return resolveEngineHousingStorageAccess(observedTarget, state.activePlayer.username,
            state.activePlayer.staffModLevel >= 2, { placements, ...configuration,
                property: propertyId => runtime.list().find(value => value.propertyId === propertyId) ?? null,
                canEnter: (property, username, isAdmin) => runtime.canPlayerEnter(property, username, isAdmin) });
    } finally { placements.close(); }
}

export function beginThievingEvidence(state: ScriptState, kindCode: number): void {
    const procedureKind = kinds[kindCode];
    if (!procedureKind) throw new Error('Unsupported Thieving procedure kind');
    if (observations.has(state)) throw new Error('A Thieving evidence observation is already active');
    const observedTarget = target(state,procedureKind);
    const propertyAccess = propertyAccessSnapshot(state, observedTarget);
    const storageAccess = procedureKind === 'container-theft'
        ? storageAccessSnapshot(state, observedTarget) : undefined;
    if (storageAccess?.actorAuthorized) throw new Error('Authorized Housing storage access is not theft');
    if (storageAccess && state.activePlayer.baseLevels[PlayerStat.THIEVING] < storageAccess.lockLevel)
        throw new Error(`Housing storage requires Thieving level ${storageAccess.lockLevel}`);
    observations.set(state, { procedureKind, target: observedTarget, startedAtEngineTick: World.currentTick,
        thievingXp: state.activePlayer.stats[PlayerStat.THIEVING], inventory: inventorySnapshot(state),
        ...(propertyAccess ? { propertyAccess } : {}), ...(storageAccess ? { storageAccess } : {}) });
}

export function commitThievingEvidence(state: ScriptState, effectCode: number): void {
    const observation = observations.get(state), effect = effects[effectCode];
    if (!observation) throw new Error('Thieving evidence commit has no active observation');
    observations.delete(state);
    if (!effect) throw new Error('Unsupported Thieving procedure effect');
    const current = inventorySnapshot(state), ids = new Set([...observation.inventory.keys(), ...current.keys()]);
    const transferredItems: EngineThievingItemDelta[] = [];
    for (const itemId of ids) {
        const quantity = (current.get(itemId) ?? 0) - (observation.inventory.get(itemId) ?? 0);
        if (quantity > 0) {
            const type = ObjType.get(itemId);
            transferredItems.push({ itemId, itemName: type.name ?? type.debugname ?? `obj-${itemId}`, quantity });
        }
    }
    transferredItems.sort((left, right) => left.itemId - right.itemId);
    const thievingXpDelta = state.activePlayer.stats[PlayerStat.THIEVING] - observation.thievingXp;
    if (thievingXpDelta < 0) throw new Error('Thieving XP decreased during evidence observation');
    if (effect === 'item-transfer' && transferredItems.length === 0) {
        throw new Error('Thieving item-transfer evidence has no positive inventory delta');
    }
    if (effect !== 'item-transfer' && transferredItems.length > 0) {
        throw new Error('Non-transfer Thieving evidence unexpectedly changed inventory');
    }
    const propertyAccess = effect === 'entry-completed'
        ? propertyAccessSnapshot(state, observation.target) : observation.propertyAccess;
    const sightSnapshot = shouldCaptureThievingSight(observation.procedureKind, effect)
        ? captureThievingSightCandidates(state.activePlayer, World.players.filter(player => player), isLineOfSight)
        : undefined;
    if (sightSnapshot && state.activePlayer.visibility === rsbuf.Visibility.DEFAULT && isClientConnected(state.activePlayer)) {
        const actor = state.activePlayer;
        const visible = selectVisibleWitnesses(actor,World.players.filter(player=>player),rsbuf.hasPlayer,isClientConnected)
            .filter(player=>sightSnapshot.candidates.some(candidate=>candidate.username===player.username.toLowerCase()));
        const visualDigest = anonymousVisualDigest(actor.generateAppearance());
        sightSnapshot.candidates = sightSnapshot.candidates.filter(candidate=>visible.some(player=>player.username.toLowerCase()===candidate.username));
        for (const observer of visible) witnessContinuityTracker.remember(observer,actor,visualDigest,World.currentTick,Date.now());
        sightSnapshot.continuity = { actorSessionToken: witnessSessionToken(actor), visualDigest,
            observers: visible.map(player => ({ username: player.username.toLowerCase(),
                sessionToken: witnessSessionToken(player) })) };
    } else if (sightSnapshot) sightSnapshot.candidates = [];
    getThievingEvidenceStore().append({ eventId: randomUUID(), playerUsername: state.activePlayer.username.toLowerCase(),
        procedureKind: observation.procedureKind, target: observation.target, effect, transferredItems,
        thievingXpDelta, startedAtEngineTick: observation.startedAtEngineTick, endedAtEngineTick: World.currentTick,
        occurredAt: new Date().toISOString(),
        ...(propertyAccess ? { propertyAccess } : {}),
        ...(observation.storageAccess ? { storageAccess: observation.storageAccess } : {}),
        ...(sightSnapshot ? { sightSnapshot } : {}) });
}
