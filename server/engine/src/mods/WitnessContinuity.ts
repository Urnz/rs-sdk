import { createHash, randomUUID } from 'node:crypto';

const sessions = new WeakMap<object, string>();
export function witnessSessionToken(player: object): string {
    let token = sessions.get(player);
    if (!token) { token = randomUUID(); sessions.set(player, token); }
    return token;
}
/** Appearance packet ends in username37 (8), combat (1), skill level (2).
 * Strip these identity/stat labels: recognition continuity is visual, not username-derived. */
export function anonymousVisualDigest(appearance: Uint8Array): string {
    if (appearance.length < 12) throw new Error('Invalid visible appearance');
    return createHash('sha256').update(appearance.subarray(0, appearance.length - 11)).digest('hex');
}
export interface WitnessContinuitySnapshot {
    actorSessionToken: string;
    visualDigest: string;
    observers: Array<{ username: string; sessionToken: string }>;
}
export function selectVisibleWitnesses<T extends {isActive:boolean;visibility:number;slot:number}>(actor:T,
    players:Iterable<T>, visible:(observerSlot:number,targetSlot:number)=>boolean, connected:(player:T)=>boolean):T[] {
    if (!actor.isActive || actor.visibility!==0 || !connected(actor)) return [];
    return Array.from(players).filter(observer=>observer!==actor && observer.isActive && observer.visibility===0
        && connected(observer) && visible(observer.slot,actor.slot));
}

interface TrackedPair {
    observer: object; target: object; fromTick: number; lastTick: number; createdAt: number; visualDigest: string;
}
/** Observer-local uninterrupted tracking, not global entity identity. Loss/eviction is irreversible
 * for the older event, even if the same avatar later returns with the same appearance. */
export class WitnessContinuityTracker {
    private readonly pairs = new Map<string, TrackedPair>();
    constructor(private readonly capacity = 4096, private readonly maxAgeMs = 3_600_000) {
        if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100_000
            || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 3_600_000)
            throw new Error('Invalid continuity tracking bounds');
    }
    private key(observer: object, target: object): string {
        return `${witnessSessionToken(observer)}:${witnessSessionToken(target)}`;
    }
    remember(observer: object, target: object, visualDigest: string, tick: number, now: number): void {
        const key = this.key(observer,target), previous = this.pairs.get(key);
        if (previous && previous.lastTick >= tick - 1 && previous.visualDigest === visualDigest
            && now - previous.createdAt <= this.maxAgeMs) return;
        this.pairs.delete(key);
        while (this.pairs.size >= this.capacity) this.pairs.delete(this.pairs.keys().next().value!);
        this.pairs.set(key,{observer,target,visualDigest,fromTick:tick,lastTick:tick,createdAt:now});
    }
    refresh(tick: number, now: number, stillVisible: (observer:object,target:object,visualDigest:string)=>boolean): void {
        for (const [key,pair] of this.pairs) {
            let valid = false;
            try { valid = pair.lastTick >= tick - 1 && now >= pair.createdAt && now - pair.createdAt <= this.maxAgeMs
                && stillVisible(pair.observer,pair.target,pair.visualDigest); } catch { /* fail closed */ }
            if (!valid) this.pairs.delete(key); else pair.lastTick=tick;
        }
    }
    has(observer:object,target:object,eventTick:number,currentTick:number,visualDigest:string): boolean {
        const pair=this.pairs.get(this.key(observer,target));
        return !!pair && pair.fromTick <= eventTick && pair.lastTick >= currentTick - 1 && pair.visualDigest === visualDigest;
    }
}
export const witnessContinuityTracker = new WitnessContinuityTracker();
