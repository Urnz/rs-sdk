export const economicActorKinds = ['player', 'business', 'faction'] as const;
export type EconomicActorKind = (typeof economicActorKinds)[number];

export interface EconomicActorRef {
    kind: EconomicActorKind;
    id: string;
}

export function validateEconomicActorRef(value: EconomicActorRef, context = 'economic actor'): EconomicActorRef {
    if (!economicActorKinds.includes(value.kind) || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.id)) {
        throw new Error(`${context} must have a supported kind and a stable normalized id`);
    }
    return { kind: value.kind, id: value.id };
}
