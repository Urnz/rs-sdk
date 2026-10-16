import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import InvType from '#/cache/config/InvType.js';
import type Player from '#/engine/entity/Player.js';
import { validateCheckpointInspectionPolicy } from '../../../../crime-checkpoints/policy.js';
import type { CheckpointInspectionPolicy } from '../../../../crime-checkpoints/types.js';
import { CheckpointEvidenceStore, type EngineCheckpointDetectionRecord,
    type EngineCheckpointInspectionRecord } from './CheckpointEvidenceStore.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
export interface EngineCheckpointDefinition {
    checkpointId: string; inspectorAgentId: string; x: number; z: number; level: number; radius: number;
}
export interface EngineCheckpointConfiguration {
    schemaVersion: 1; policy: CheckpointInspectionPolicy; checkpoints: EngineCheckpointDefinition[];
}
export interface CheckpointSearchCommand {
    commandId: string; checkpointId: string; subjectUsername: string; expiresAt: number;
}
export interface CheckpointDetectionCommand {
    commandId: string; inspectionId: string; subjectAgentId: string; assetId: string; itemId: number;
    result: 'recognized-stolen' | 'not-recognized'; expiresAt: number;
}
export interface CheckpointOperationDependencies {
    store: CheckpointEvidenceStore; configuration: EngineCheckpointConfiguration;
    subject: (username: string) => Player | null; connected: (player: Player) => boolean;
    engineTick: number; now: number;
}
function integer(value: unknown, field: string, min: number, max: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
        throw new Error(`${field} is invalid`);
    return Number(value);
}
export function validateEngineCheckpointConfiguration(value: unknown): EngineCheckpointConfiguration {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Checkpoint configuration is invalid');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'checkpoints,policy,schemaVersion'
        || input.schemaVersion !== 1 || !Array.isArray(input.checkpoints))
        throw new Error('Checkpoint configuration is invalid');
    const policy = validateCheckpointInspectionPolicy(input.policy);
    const checkpoints = input.checkpoints.map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error(`Checkpoint ${index} is invalid`);
        const entry = value as Record<string, unknown>;
        if (Object.keys(entry).sort().join(',') !== 'checkpointId,inspectorAgentId,level,radius,x,z'
            || typeof entry.checkpointId !== 'string' || !ID.test(entry.checkpointId)
            || typeof entry.inspectorAgentId !== 'string' || !ID.test(entry.inspectorAgentId))
            throw new Error(`Checkpoint ${index} is invalid`);
        return { checkpointId: entry.checkpointId, inspectorAgentId: entry.inspectorAgentId,
            x: integer(entry.x, 'x', 0, 16_383), z: integer(entry.z, 'z', 0, 16_383),
            level: integer(entry.level, 'level', 0, 3), radius: integer(entry.radius, 'radius', 0, 15) };
    });
    if (new Set(checkpoints.map(value => value.checkpointId)).size !== checkpoints.length
        || checkpoints.some(checkpoint => policy.rules.filter(rule => rule.checkpointId === checkpoint.checkpointId).length !== 1))
        throw new Error('Checkpoint definitions must map one-to-one to policy rules');
    return { schemaVersion: 1, policy, checkpoints };
}
export function loadEngineCheckpointConfiguration(raw = readFileSync(fileURLToPath(
    new URL('../../../../config/crime-checkpoints.json', import.meta.url)), 'utf8')): EngineCheckpointConfiguration {
    return validateEngineCheckpointConfiguration(JSON.parse(raw) as unknown);
}
function commandId(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
        throw new Error('Checkpoint command identity is invalid');
    return value.toLowerCase();
}
function username(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9]{1,12}$/.test(normalized)) throw new Error('Checkpoint subject is invalid');
    return normalized;
}
export function executeCheckpointSearch(command: CheckpointSearchCommand,
    deps: CheckpointOperationDependencies): EngineCheckpointInspectionRecord {
    const inspectionId = commandId(command.commandId), subjectAgentId = username(command.subjectUsername);
    const checkpoint = deps.configuration.checkpoints.find(value => value.checkpointId === command.checkpointId);
    const rule = deps.configuration.policy.rules.find(value => value.checkpointId === command.checkpointId);
    if (!checkpoint || !rule || rule.permission !== 'allow') throw new Error('Checkpoint search is not configured');
    const previous = deps.store.getInspection(inspectionId);
    if (previous) {
        if (previous.checkpointId !== checkpoint.checkpointId || previous.subjectAgentId !== subjectAgentId)
            throw new Error('Checkpoint inspection identity was reused');
        return previous;
    }
    if (!Number.isSafeInteger(command.expiresAt) || deps.now > command.expiresAt)
        throw new Error('Checkpoint search command expired');
    const subject = deps.subject(subjectAgentId);
    if (!subject || !deps.connected(subject) || subject.level !== checkpoint.level
        || Math.max(Math.abs(subject.x - checkpoint.x), Math.abs(subject.z - checkpoint.z)) > checkpoint.radius)
        throw new Error('Checkpoint subject is not present for search');
    const quantities = new Map<number, number>();
    for (const item of subject.getInventory(InvType.INV)?.itemsFiltered ?? [])
        quantities.set(item.id, (quantities.get(item.id) ?? 0) + item.count);
    const searchedItems = [...quantities].map(([itemId, quantity]) => ({ itemId, quantity }))
        .sort((left, right) => left.itemId - right.itemId);
    return deps.store.appendInspection({ inspectionId, jurisdictionId: rule.jurisdictionId,
        locationId: rule.locationId, checkpointId: rule.checkpointId, authorityId: rule.authorityId,
        inspectorAgentId: checkpoint.inspectorAgentId, subjectAgentId,
        occurredAt: new Date(deps.now).toISOString(), engineTick: deps.engineTick, searchedItems });
}
export function executeCheckpointDetection(command: CheckpointDetectionCommand,
    deps: Pick<CheckpointOperationDependencies, 'store' | 'engineTick' | 'now'>): EngineCheckpointDetectionRecord {
    const detectionId = commandId(command.commandId), subjectAgentId = username(command.subjectAgentId);
    if (typeof command.assetId !== 'string' || !ID.test(command.assetId)
        || !Number.isSafeInteger(command.itemId) || command.itemId < 0 || command.itemId > 65_535
        || (command.result !== 'recognized-stolen' && command.result !== 'not-recognized'))
        throw new Error('Checkpoint detection command is invalid');
    const previous = deps.store.getDetection(detectionId);
    if (previous) {
        if (previous.inspectionId !== command.inspectionId || previous.subjectAgentId !== subjectAgentId
            || previous.assetId !== command.assetId || previous.itemId !== command.itemId
            || previous.result !== command.result) throw new Error('Checkpoint detection identity was reused');
        return previous;
    }
    if (!Number.isSafeInteger(command.expiresAt) || deps.now > command.expiresAt)
        throw new Error('Checkpoint detection command expired');
    return deps.store.appendDetection({ detectionId, inspectionId: command.inspectionId,
        subjectAgentId, assetId: command.assetId, itemId: command.itemId, result: command.result,
        occurredAt: new Date(deps.now).toISOString(), engineTick: deps.engineTick });
}
