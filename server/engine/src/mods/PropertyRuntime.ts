import { fileURLToPath } from 'node:url';
import { loadPropertyCatalog, type PropertyCatalog, type PropertyDefinition, type PropertyStateEntry } from './Properties.js';
import {
    PropertyStore,
    type PropertyPendingResolution,
    type PropertyPurchaseRecord,
    type PropertyWallet
} from './PropertyStore.js';

export interface PropertyPlayerWalletTarget {
    username: string;
    coinBalance(): number;
    removeCoins(amount: number): number;
    addCoins(amount: number): number;
}

export interface PropertyView extends PropertyDefinition {
    state: PropertyStateEntry;
}

export interface PropertyPurchaseOutcome {
    purchase: PropertyPurchaseRecord;
    property: PropertyView;
    coinsBefore: number;
    coinsAfter: number;
}

const catalogPath = fileURLToPath(new URL('../../../../config/properties.json', import.meta.url));
const statePath = fileURLToPath(new URL('../../../../.local/admin/properties.sqlite', import.meta.url));

export class PropertyRuntime {
    private readonly definitions;

    constructor(
        private readonly catalog: PropertyCatalog,
        private readonly store: PropertyStore
    ) {
        this.definitions = new Map(catalog.properties.map(property => [property.propertyId, property]));
    }

    list(): PropertyView[] {
        const states = new Map(this.store.listProperties().map(state => [state.propertyId, state]));
        return this.catalog.properties.map(property => ({
            ...property,
            state: states.get(property.propertyId) ?? (() => { throw new Error(`Missing property state: ${property.propertyId}`); })()
        }));
    }

    listPendingPurchases(): PropertyPurchaseRecord[] {
        return this.store.listPurchases('pending');
    }

    resetProperty(propertyId: string, expectedVersion: number, now = new Date().toISOString()): PropertyView {
        this.store.resetProperty(propertyId, expectedVersion, now);
        const property = this.list().find(entry => entry.propertyId === propertyId);
        if (!property) throw new Error(`Reset property disappeared from catalog: ${propertyId}`);
        return property;
    }

    reconcilePending(
        transactionId: string,
        resolution: PropertyPendingResolution,
        now = new Date().toISOString()
    ): { purchase: PropertyPurchaseRecord; property: PropertyView } {
        const result = this.store.reconcilePending(transactionId, resolution, now);
        const property = this.list().find(entry => entry.propertyId === result.property.propertyId);
        if (!property) throw new Error(`Reconciled property disappeared from catalog: ${result.property.propertyId}`);
        return { purchase: result.purchase, property };
    }

    purchase(
        target: PropertyPlayerWalletTarget,
        propertyId: string,
        transactionId: string,
        writesEnabled: boolean,
        now = new Date().toISOString()
    ): PropertyPurchaseOutcome {
        if (!writesEnabled) throw new Error('The property mod is read-only while disabled');
        const definition = this.definitions.get(propertyId);
        if (!definition) throw new Error(`Unknown property: ${propertyId}`);
        if (this.store.getPurchase(transactionId)?.status === 'pending') {
            throw new Error('Pending inventory purchase requires administrator reconciliation before retry');
        }
        const coinsBefore = target.coinBalance();
        let debited = false;
        let refunded = false;
        const wallet: PropertyWallet = {
            debit: (_owner, amount) => {
                if (debited) return;
                if (target.coinBalance() < amount) throw new Error(`Insufficient inventory coins: ${amount} required`);
                const removed = target.removeCoins(amount);
                if (removed !== amount) {
                    if (removed > 0 && target.addCoins(removed) !== removed) throw new Error('Partial coin debit could not be compensated');
                    throw new Error('Inventory coin debit was incomplete');
                }
                debited = true;
            },
            refund: (_owner, amount) => {
                if (!debited || refunded) return;
                if (target.addCoins(amount) !== amount) throw new Error('Inventory coin refund was incomplete');
                refunded = true;
            }
        };
        const purchase = this.store.purchase({
            transactionId,
            propertyId,
            buyer: { kind: 'player', id: target.username.toLowerCase() }
        }, wallet, now);
        const property = this.list().find(entry => entry.propertyId === propertyId);
        if (!property) throw new Error(`Purchased property disappeared from catalog: ${propertyId}`);
        return { purchase, property, coinsBefore, coinsAfter: target.coinBalance() };
    }
}

let defaultRuntime: PropertyRuntime | null = null;

export function getPropertyRuntime(): PropertyRuntime {
    if (!defaultRuntime) {
        const catalog = loadPropertyCatalog(catalogPath);
        defaultRuntime = new PropertyRuntime(catalog, new PropertyStore(catalog, statePath));
    }
    return defaultRuntime;
}
