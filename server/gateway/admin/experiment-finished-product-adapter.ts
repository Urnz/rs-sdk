import { validateExperimentParameterProfile, type ExperimentParameterProfile } from './experiment-parameters.js';
import type { MultiAgentExperimentEnvironment } from './multi-agent-experiments.js';
import type { EconomySnapshot } from './types.js';
import type { WorldModView } from './world-mods.js';

export const EXPERIMENT_FINISHED_PRODUCT_MOD_ID = 'experiment.finished-product-valuation';

export interface ExperimentFinishedProductWorldModEntry {
    enabled: true;
    config: { profileId: string; profileVersion: string; profileDigest: string; productsJson: string };
}

export interface ExperimentFinishedProductValuation {
    profileId: string;
    profileVersion: string;
    profileDigest: string;
    grossProducedValueGp: number;
    grossConsumedValueGp: number;
    netValueDeltaGp: number;
    products: Array<{ itemId: number; itemName: string; unitValueGp: number; countDelta: number; valueDeltaGp: number }>;
}

export function buildExperimentFinishedProductWorldModEntry(
    profileInput: ExperimentParameterProfile
): ExperimentFinishedProductWorldModEntry {
    const profile = validateExperimentParameterProfile(profileInput, profileInput.createdAt);
    if (profile.digest !== profileInput.digest) throw new Error('A paraméterprofil digestje sérült.');
    if (profile.parameters.finishedProducts.length === 0) {
        throw new Error('A kiválasztott profil nem tartalmaz késztermékértéket.');
    }
    return { enabled: true, config: { profileId: profile.profileId, profileVersion: profile.version,
        profileDigest: profile.digest, productsJson: JSON.stringify(profile.parameters.finishedProducts) } };
}

export function verifyExperimentFinishedProductWorldMod(
    profile: ExperimentParameterProfile,
    mods: WorldModView[]
): WorldModView {
    const expected = buildExperimentFinishedProductWorldModEntry(profile);
    const mod = mods.find(entry => entry.id === EXPERIMENT_FINISHED_PRODUCT_MOD_ID);
    if (!mod || mod.status !== 'active' || !mod.active?.enabled
        || JSON.stringify(mod.active.config) !== JSON.stringify(expected.config)) {
        throw new Error('Az engine nem az exact kiválasztott késztermékérték-profilt olvasta vissza aktívként.');
    }
    return mod;
}

function safeAdd(left: number, right: number): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new Error('A késztermékérték összege túllépi a biztonságos tartományt.');
    return result;
}

function itemCounts(items: EconomySnapshot['itemStock']): Map<number, number> {
    const output = new Map<number, number>();
    for (const item of items) {
        if (!Number.isSafeInteger(item.id) || item.id < 0 || item.id > 65_535
            || !Number.isSafeInteger(item.count) || item.count < 0) {
            throw new Error('A késztermékértékelés gazdasági snapshotja érvénytelen.');
        }
        output.set(item.id, safeAdd(output.get(item.id) ?? 0, item.count));
    }
    return output;
}

export function evaluateExperimentFinishedProducts(
    profileInput: ExperimentParameterProfile,
    environment: MultiAgentExperimentEnvironment,
    baseline: EconomySnapshot,
    final: EconomySnapshot
): ExperimentFinishedProductValuation | null {
    const profile = validateExperimentParameterProfile(profileInput, profileInput.createdAt);
    if (profile.digest !== profileInput.digest) throw new Error('A paraméterprofil digestje sérült.');
    const mod = environment.mods.find(entry => entry.id === EXPERIMENT_FINISHED_PRODUCT_MOD_ID);
    if (!mod?.enabled) return null;
    const expected = buildExperimentFinishedProductWorldModEntry(profile).config;
    if (mod.version !== '1.0.0' || mod.dataSchemaVersion !== 1
        || mod.config.profileId !== expected.profileId || mod.config.profileVersion !== expected.profileVersion
        || mod.config.profileDigest !== expected.profileDigest || mod.config.productsJson !== expected.productsJson) {
        throw new Error('A futás aktív késztermékérték-modja nem egyezik az exact kiválasztott profillal.');
    }
    const before = itemCounts(baseline.itemStock);
    const after = itemCounts(final.itemStock);
    let grossProducedValueGp = 0;
    let grossConsumedValueGp = 0;
    const products = profile.parameters.finishedProducts.map(product => {
        const countDelta = (after.get(product.itemId) ?? 0) - (before.get(product.itemId) ?? 0);
        const valueDeltaGp = countDelta * product.valueGp;
        if (!Number.isSafeInteger(valueDeltaGp)) {
            throw new Error(`A késztermékérték túllépi a biztonságos tartományt: ${product.itemId}`);
        }
        if (valueDeltaGp >= 0) grossProducedValueGp = safeAdd(grossProducedValueGp, valueDeltaGp);
        else grossConsumedValueGp = safeAdd(grossConsumedValueGp, Math.abs(valueDeltaGp));
        return { ...product, unitValueGp: product.valueGp, countDelta, valueDeltaGp };
    }).filter(product => product.countDelta !== 0)
        .map(({ valueGp: _valueGp, ...product }) => product);
    const netValueDeltaGp = grossProducedValueGp - grossConsumedValueGp;
    if (!Number.isSafeInteger(netValueDeltaGp)) {
        throw new Error('A nettó késztermékérték túllépi a biztonságos tartományt.');
    }
    return { profileId: profile.profileId, profileVersion: profile.version, profileDigest: profile.digest,
        grossProducedValueGp, grossConsumedValueGp, netValueDeltaGp, products };
}
