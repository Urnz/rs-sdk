import type { WitnessContinuitySnapshot } from './WitnessContinuity.js';
export interface SightPlayer {
    username: string;
    x: number;
    z: number;
    level: number;
    isActive: boolean;
}
export interface ThievingSightSnapshot {
    actor: { x: number; z: number; level: number };
    radius: number;
    /** Optional new event-time, observer-visible continuity. Legacy events cannot identify. */
    continuity?: WitnessContinuitySnapshot;
    /** Geometric opportunities only; no attention, recognition or testimony is implied. */
    candidates: Array<{ username: string; x: number; z: number; level: number }>;
}

/** Only completed theft/entry effects have an observer opportunity; unlocking alone is not entry. */
export function shouldCaptureThievingSight(kind: string, effect: string): boolean {
    return (kind === 'property-burglary' && effect === 'entry-completed')
        || ((kind === 'pickpocket' || kind === 'container-theft') && effect === 'item-transfer');
}

/** Bounded server visibility scan, independent of any witness-admission policy. */
export function captureThievingSightCandidates(actor: SightPlayer, players: Iterable<SightPlayer>,
    lineOfSight: (level: number, fromX: number, fromZ: number, toX: number, toZ: number) => boolean,
    radius = 15): ThievingSightSnapshot {
    if (!Number.isSafeInteger(radius) || radius < 1 || radius > 15)
        throw new Error('Sight candidate radius must be between 1 and 15');
    const candidates = Array.from(players).filter(player => player.isActive
        && player.username.toLowerCase() !== actor.username.toLowerCase()
        && player.level === actor.level
        && Math.max(Math.abs(player.x - actor.x), Math.abs(player.z - actor.z)) <= radius
        && lineOfSight(player.level, player.x, player.z, actor.x, actor.z))
        .map(player => ({ username: player.username.toLowerCase(), x: player.x, z: player.z,
            level: player.level })).sort((left, right) => left.username.localeCompare(right.username));
    return { actor: { x: actor.x, z: actor.z, level: actor.level }, radius, candidates };
}
