import { randomUUID } from 'node:crypto';
import type { AgentPopulationMember } from '../../../agent-state/types.js';
import type { SimulationClockObservation } from '../../../simulation-clock/types.js';
import { populationNeedsBinding } from './needs-runtime.js';
import { NativeRentCoordinator } from '../../../housing/native-rent-runtime.js';
import { nativeHousingCatalogs, type HousingNativeOptions, type NativeHousingCommand, type NativeHousingResponse } from '../../../housing/native-rent.js';
import { assertNativeFoodDomainPath } from '../../../food-loop/native-source.js';
import { OwnedDatabase } from '../../engine/src/io/OwnedDatabase.js';
import { foodDigest } from '../../engine/src/mods/NativeFoodConsumptionStore.js';
import {assertOwnerBedAuthority} from '../../../housing/native-owner.js';
export function reservePopulationOwnerBed(options:HousingNativeOptions,owner:AgentPopulationMember,clock:SimulationClockObservation,
    request:{operationId:string;bedSlotId:string}){
    const b=populationNeedsBinding(options.worldId,owner);
    if(owner.status!=='active'||owner.characterLifecycle.status!=='active'||b.clockId!==clock.clockId||b.clockProfileDigest!==clock.profileDigest)
        throw Error('Owner bed needs active population lifecycle/clock');
    assertNativeFoodDomainPath({...options,checkpointPath:options.propertyPath});
    const catalogs=nativeHousingCatalogs(options.workspace),unit=catalogs.units.units.find(u=>u.housingUnitId===catalogs.native.housingUnitId)!,
        coordinator=new NativeRentCoordinator(options);let source:OwnedDatabase|undefined;
    try{
        const prior=coordinator.owner(request.operationId);
        if(prior){
            if(prior.intent.bedSlotId!==request.bedSlotId||prior.intent.owner.agentId!==owner.agentId||prior.intent.owner.username!==owner.playerUsername
                ||prior.intent.owner.lifecycleId!==b.lifecycleId)throw Error('Owner operation id reused');
            assertOwnerBedAuthority(options,prior,clock);return prior;
        }
        source=new OwnedDatabase(options.propertyPath,{readonly:true,strict:true});
        const property=source.query('SELECT * FROM property_state WHERE property_id=?1').get(unit.propertyId) as any;
        if(property?.status!=='owned'||property.owner_kind!=='player'||property.owner_id!==owner.playerUsername)throw Error('Owner bed applicant is not the Property owner');
        return coordinator.reserveOwner({operationId:request.operationId,worldId:options.worldId,clockId:clock.clockId,clockProfileDigest:clock.profileDigest,
            owner:{agentId:owner.agentId,username:owner.playerUsername,lifecycleId:b.lifecycleId},housingUnitId:unit.housingUnitId,bedSlotId:request.bedSlotId,
            propertyVersion:property.version,startsAt:clock.simulationTime,
            endsAt:new Date(Date.parse(clock.simulationTime)+unit.rentPeriodSimulationMinutes*60000).toISOString(),catalogs},clock);
    }finally{source?.close(true);coordinator.close();}
}
/** Existing trusted population membership, Property title and catalog supply terms; posted receipts/balances are not accepted. */
export function reservePopulationRental(options: HousingNativeOptions, tenant: AgentPopulationMember, landlord: AgentPopulationMember,
    clock: SimulationClockObservation, request: { operationId: string; bedSlotId: string }) {
    const actor = (member: AgentPopulationMember) => {
        const b = populationNeedsBinding(options.worldId, member);
        if (member.status !== 'active' || member.characterLifecycle.status !== 'active' || b.clockId !== clock.clockId || b.clockProfileDigest !== clock.profileDigest)
            throw new Error('Rental needs active population lifecycle/clock');
        return { agentId: member.agentId, username: member.playerUsername, lifecycleId: b.lifecycleId };
    };
    const t = actor(tenant), l = actor(landlord), coordinator = new NativeRentCoordinator(options);
    try {
        const prior = coordinator.get(request.operationId);
        if (prior) {
            if (prior.binding.intent.bedSlotId !== request.bedSlotId || foodDigest(prior.binding.intent.tenant) !== foodDigest(t)
                || foodDigest(prior.binding.intent.landlord) !== foodDigest(l)) throw new Error('Rental operation id reused'); return prior;
        }
        assertNativeFoodDomainPath({ ...options, checkpointPath: options.propertyPath });
        const catalogs = nativeHousingCatalogs(options.workspace), unit = catalogs.units.units.find(u => u.housingUnitId === catalogs.native.housingUnitId)!;
        const db = new OwnedDatabase(options.propertyPath, { readonly: true, strict: true }); let version: number;
        try { const property = db.query('SELECT * FROM property_state WHERE property_id=?1').get(unit.propertyId) as Record<string, unknown> | null;
            if (!property || property.status !== 'owned' || property.owner_kind !== 'player' || property.owner_id !== l.username) throw new Error('Rental landlord is not the Property owner'); version = Number(property.version);
        } finally { db.close(true); }
        return coordinator.reserve({ operationId: request.operationId, worldId: options.worldId, clockId: clock.clockId, clockProfileDigest: clock.profileDigest,
            tenant: t, landlord: l, housingUnitId: unit.housingUnitId, bedSlotId: request.bedSlotId, startsAt: clock.simulationTime,
            endsAt: new Date(Date.parse(clock.simulationTime) + unit.rentPeriodSimulationMinutes * 60000).toISOString(),
            expiresAt: new Date(Date.parse(clock.wallTime) + 300000).toISOString(), amountGp: unit.rentGpPerPeriod, propertyVersion: version, catalogs }, clock);
    } finally { coordinator.close(); }
}
export async function requestNativeHousing(command: NativeHousingCommand): Promise<NativeHousingResponse> {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim(); if (!token) throw new Error('Housing engine channel unavailable');
    const url = new URL('/api/internal/admin/native-housing', process.env.ENGINE_ADMIN_URL?.trim() ?? 'http://localhost:8888');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Housing requires a local/private engine');
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Engine-Admin-Token': token },
        body: JSON.stringify({ commandId: randomUUID(), operation: command.operation, operationId: command.operationId }), signal: AbortSignal.timeout(8000) });
    const result = await response.json() as NativeHousingResponse;
    if (!response.ok || !result.ok) throw new Error(result.ok ? 'Housing request failed' : result.error); return result;
}
export function finalizePopulationRental(options: HousingNativeOptions, id: string) {
    const coordinator = new NativeRentCoordinator(options); try { return coordinator.finalize(id); } finally { coordinator.close(); }
}
