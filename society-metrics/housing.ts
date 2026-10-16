import type { HousingUnitCatalog } from '../housing/types.js';
import { integer, sum, timestamp } from './policy.js';
import { requireEvidence as check, same, type LedgerData } from './sources.js';

export function housingObservations(data: LedgerData, catalog: HousingUnitCatalog) {
    const tables = data.tables, rows = tables.housing_tenancy!, payments = tables.housing_rent_payment!;
    check(tables.housing_tenancy_meta!.length === 1 && tables.housing_tenancy_meta![0]!.catalog_digest === catalog.digest,
        'Housing catalog binding differs');
    let matchedAudits = 0, matchedPayments = 0;
    const intervals = rows.map(row => {
        const audits = tables.audit!.filter(item => item.tenancyId === row.tenancy_id), created = audits[0],
            unit = catalog.units.find(item => item.housingUnitId === row.housing_unit_id);
        check(unit && row.unit_catalog_digest === catalog.digest && unit.bedSlots.some(bed => bed.bedSlotId === row.bed_slot_id)
            && row.rent_gp_per_period === unit.rentGpPerPeriod && row.rent_period_minutes === unit.rentPeriodSimulationMinutes,
        'Housing unit differs');
        check(created?.action === 'tenancy-created' && created.at === row.starts_at
            && same(created.detail, { unitId: row.housing_unit_id, bedId: row.bed_slot_id, tenantId: row.tenant_agent_id, end: row.ends_at })
            && audits.filter(item => item.action === 'tenancy-created').length === 1 && row.revision === audits.length,
        'Housing tenancy/audit differs');
        const start = timestamp(row.starts_at), scheduledEnd = timestamp(row.ends_at), period = integer(row.rent_period_minutes) * 60000;
        check(scheduledEnd > start && period > 0, 'Invalid tenancy interval');
        let end = scheduledEnd;
        for (const audit of audits.slice(1)) {
            check(timestamp(audit.at) >= start, 'Housing event predates tenancy');
            if (audit.action === 'tenancy-ended') end = Math.min(end, timestamp(audit.at));
            else if (audit.action === 'rent-paid') {
                const payment = payments.find(item => item.payment_id === audit.detail.paymentId);
                check(payment && same(payment, { payment_id: audit.detail.paymentId, tenancy_id: row.tenancy_id,
                    amount_gp: audit.detail.amountGp, source_digest: audit.detail.sourceDigest, occurred_at: audit.at }), 'Housing payment differs');
                matchedPayments++;
            } else check(audit.action === 'rent-assessed', 'Unsupported housing audit action');
        }
        matchedAudits += audits.length;
        // A payment clears arrears; it is not a persisted historical access grant. Count only the initial reservation period.
        if (unit.rentGpPerPeriod > 0) end = Math.min(end, start + period);
        if (!unit.enabled) end = start;
        return { actor: row.tenant_agent_id as string, unitId: unit.housingUnitId, bedId: row.bed_slot_id as string,
            tierId: unit.tierId, start, end, tenancyId: row.tenancy_id as string };
    });
    check(matchedAudits === tables.audit!.length && matchedPayments === payments.length, 'Housing ledger has unmatched rows');
    return intervals;
}

/** Integrate half-open intervals once per actor, refusing simultaneous bed or actor reservations. */
export function reservationCoverage(intervals: ReturnType<typeof housingObservations>, actors: string[], from: number, to: number,
    eligibleTierIds?: ReadonlySet<string>) {
    const points = [...new Set([from, to, ...intervals.flatMap(item => [Math.max(from, Math.min(to, item.start)),
        Math.max(from, Math.min(to, item.end))])])].sort((a, b) => a - b);
    const covered = new Map(actors.map(actor => [actor, 0])), conflicts = new Set<string>();
    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i]!, duration = points[i + 1]! - start;
        const active = intervals.filter(item => item.start <= start && item.end > start);
        for (const actor of actors) {
            const own = active.filter(item => item.actor === actor);
            if (own.length === 0) continue;
            const reservation = own[0]!;
            if (own.length !== 1 || active.filter(item => item.unitId === reservation.unitId && item.bedId === reservation.bedId).length !== 1) {
                conflicts.add(actor); continue;
            }
            if (eligibleTierIds && !eligibleTierIds.has(reservation.tierId)) continue;
            covered.set(actor, sum([covered.get(actor)!, duration]));
        }
    }
    return actors.map(actor => ({ actorAgentId: actor, reservedMilliseconds: covered.get(actor)!,
        reservationConflictObserved: conflicts.has(actor) }));
}
