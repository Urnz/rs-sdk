import { createHash } from 'node:crypto';
import type { ThievingEvidenceStore } from './ThievingEvidenceStore.js';
import type { EngineWitnessInspectionStore, EngineWitnessInspectionReceipt } from './WitnessInspectionStore.js';
import { anonymousVisualDigest, witnessSessionToken, witnessContinuityTracker, type WitnessContinuityTracker } from './WitnessContinuity.js';

export interface WitnessInspectionCommand {
    commandId: string; eventId: string; observerUsername: string; targetPlayerSlot: number; expiresAt: number;
}
export interface WitnessInspectionPlayer {
    username: string; slot: number; x: number; z: number; level: number; isActive: boolean; visibility: number;
    generateAppearance(): Uint8Array;
}
export interface WitnessInspectionPolicy { version: 1; maxDistance: number; maxEventAgeMs: number }
export function loadWitnessInspectionPolicy(raw = process.env.THIEVING_WITNESS_RECOGNITION_POLICY): WitnessInspectionPolicy {
    const value = raw ? JSON.parse(raw) : {version:1,maxDistance:8,maxEventAgeMs:300_000};
    if (!value || Object.keys(value).sort().join(',') !== 'maxDistance,maxEventAgeMs,version'
        || value.version !== 1 || !Number.isSafeInteger(value.maxDistance) || value.maxDistance < 1 || value.maxDistance > 15
        || !Number.isSafeInteger(value.maxEventAgeMs) || value.maxEventAgeMs < 1 || value.maxEventAgeMs > 3_600_000)
        throw new Error('Invalid witness recognition policy');
    return {version:1,maxDistance:value.maxDistance,maxEventAgeMs:value.maxEventAgeMs};
}
export function executeWitnessInspection(command: WitnessInspectionCommand, deps: {
    engine: ThievingEvidenceStore; inspections: EngineWitnessInspectionStore;
    observer(username:string): WitnessInspectionPlayer | null; target(slot:number): WitnessInspectionPlayer | null;
    visible(observerSlot:number,targetSlot:number): boolean;
    lineOfSight(level:number,fromX:number,fromZ:number,toX:number,toZ:number): boolean;
    connected(player:WitnessInspectionPlayer): boolean; engineTick:number; now:number; policy:WitnessInspectionPolicy;
    tracker?: WitnessContinuityTracker;
}): EngineWitnessInspectionReceipt {
    if (typeof command.observerUsername !== 'string' || !/^[a-z0-9]{1,12}$/.test(command.observerUsername)
        || typeof command.eventId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{1,127}$/i.test(command.eventId)
        || typeof command.commandId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(command.commandId) || !Number.isSafeInteger(command.targetPlayerSlot)
        || command.targetPlayerSlot < 0 || command.targetPlayerSlot > 2047) throw new Error('Invalid inspection command');
    if (!deps.engine.verifyChain() || !deps.inspections.verifyChain()) throw new Error('Inspection source audit invalid');
    const event = deps.engine.get(command.eventId);
    if (!event) throw new Error('Inspection event missing');
    const existing = deps.inspections.get(command.commandId);
    if (existing) {
        if (existing.eventId !== command.eventId || existing.observerUsername !== command.observerUsername
            || existing.targetPlayerSlot !== command.targetPlayerSlot
            || existing.sourceEvidenceDigest !== event.eventDigest) throw new Error('Inspection command reused');
        return existing;
    }
    if (!Number.isFinite(command.expiresAt) || command.expiresAt < deps.now) throw new Error('Inspection command expired');
    const age = deps.now - Date.parse(event.occurredAt), continuity = event.sightSnapshot?.continuity;
    if (!continuity || !Number.isFinite(age) || age < 0 || age > deps.policy.maxEventAgeMs)
        throw new Error('Inspection continuity unavailable or expired');
    const observer = deps.observer(command.observerUsername), target = deps.target(command.targetPlayerSlot);
    const observerSnapshot = continuity.observers.find(item => item.username === command.observerUsername);
    if (!observer || !target || observer === target || target.slot !== command.targetPlayerSlot
        || observer.username.toLowerCase() !== command.observerUsername
        || !observerSnapshot || !observer.isActive || !target.isActive || observer.visibility !== 0 || target.visibility !== 0
        || !deps.connected(observer) || !deps.connected(target)
        || witnessSessionToken(observer) !== observerSnapshot.sessionToken
        || witnessSessionToken(target) !== continuity.actorSessionToken
        || anonymousVisualDigest(target.generateAppearance()) !== continuity.visualDigest
        || !(deps.tracker ?? witnessContinuityTracker).has(observer,target,event.endedAtEngineTick,deps.engineTick,continuity.visualDigest)
        || observer.level !== target.level
        || Math.max(Math.abs(observer.x-target.x),Math.abs(observer.z-target.z)) > deps.policy.maxDistance
        || !deps.visible(observer.slot,target.slot)
        || !deps.lineOfSight(observer.level,observer.x,observer.z,target.x,target.z))
        throw new Error('Visible person does not match witnessed continuity');
    // Independently sample the explicitly inspected live entity. Never resolve it from event.playerUsername.
    return deps.inspections.append({recognitionId:command.commandId,eventId:event.eventId,
        observerUsername:observer.username.toLowerCase(),recognizedPlayerUsername:target.username.toLowerCase(),
        sourceEvidenceDigest:event.eventDigest,occurredAt:new Date(deps.now).toISOString(),engineTick:deps.engineTick,
        actorSessionToken:continuity.actorSessionToken,visualDigest:continuity.visualDigest,
        policyDigest:createHash('sha256').update(JSON.stringify(deps.policy)).digest('hex'),targetPlayerSlot:target.slot});
}
