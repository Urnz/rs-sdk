import { OwnedDatabase } from '../../engine/src/io/OwnedDatabase.js';
import { businessRoleHasPermission, loadDefaultBusinessRoleCatalog, resolveBusinessRole } from '../../../business-roles/index.js';
import { loadNativeKitchenPolicy } from '../../../production-workflow/native-kitchen-policy.js';
import type { FacilityAccessGrantEvidence } from '../../../facility-capability/types.js';
import type { SimulationClockObservation } from '../../../simulation-clock/types.js';

/** A grant verifier can run inside a Business writer transaction. Opening a
 * migrating manager there would deadlock against that transaction's own lock. */
export function readBusinessFacilityGrant(workspace: string, businessPath: string, businessId: string,
    workerAgentId: string, capability: string, clock: SimulationClockObservation): FacilityAccessGrantEvidence {
    const db = new OwnedDatabase(businessPath, { readonly: true, strict: true });
    try {
        db.run('PRAGMA busy_timeout=5000');
        let result!: FacilityAccessGrantEvidence;
        db.transaction(() => {
            const business = db.query(`SELECT owner_agent_id,property_id FROM business WHERE business_id=?1 AND status='active'
                AND EXISTS(SELECT 1 FROM business_policy_proposal WHERE business_id=?1 AND status='approved')`)
                .get(businessId) as { owner_agent_id: string; property_id: string | null } | null;
            if (!business) throw new Error('Approved Business policy required');
            const employment = db.query(`SELECT employment_id,role_definition_id FROM business_employment
                WHERE business_id=?1 AND worker_agent_id=?2 AND status='active'`).get(businessId, workerAgentId) as
                { employment_id: string; role_definition_id: string } | null;
            const owner = business.owner_agent_id === workerAgentId;
            if (!owner && !employment) throw new Error('Business actor entitlement changed');
            if (!owner && capability === 'storage.secure') {
                const role = resolveBusinessRole(loadDefaultBusinessRoleCatalog(), employment!.role_definition_id);
                if (!businessRoleHasPermission(role, 'inventory', 'issue') || !businessRoleHasPermission(role, 'inventory', 'receive')
                    || !businessRoleHasPermission(role, 'logistics', 'operate')) throw new Error('Business commerce role is not authorized');
            }
            const entitlement = db.query(`SELECT entitlement_id,valid_from,valid_until FROM business_facility_entitlement
                WHERE business_id=?1 AND property_id=?2 AND facility_capability=?3 AND valid_from<=?4
                AND (valid_until IS NULL OR valid_until>?4) ORDER BY entitlement_id LIMIT 1`)
                .get(businessId, business.property_id, capability, clock.simulationTime) as
                { entitlement_id: string; valid_from: string; valid_until: string | null } | null;
            if (!entitlement) throw new Error('Existing Business facility entitlement required');
            result = { grantId: entitlement.entitlement_id, kind: owner ? 'explicit' : 'employment', subjectAgentId: workerAgentId,
                facilityId: loadNativeKitchenPolicy(workspace).facilityId, capabilityId: capability, status: 'active',
                validFrom: entitlement.valid_from, validUntil: entitlement.valid_until,
                sourceEvidenceId: owner ? businessId : employment!.employment_id };
        }).deferred();
        return result;
    } finally { db.close(true); }
}
