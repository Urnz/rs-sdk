#!/usr/bin/env bun

import { CapabilityGapStore } from '../agent-skills/capability-gaps.js';
import { capabilityGapsPath } from '../server/gateway/admin/paths.js';
import { preparePhase15CapabilityTrials } from '../server/gateway/admin/phase15-capability-preparation.js';

const prepared = await preparePhase15CapabilityTrials(new CapabilityGapStore(capabilityGapsPath));
console.log(JSON.stringify({ prepared: prepared.map(gap => ({ gapId: gap.gapId, status: gap.status,
    draft: gap.draftSkill, requesterCount: gap.requesters.length })) }, null, 2));
