/** Shared manifest: engine registration and gateway selection must cover the same cases.
 * Keep each existing leaf timeout; there is no aggregate 120s budget for ten tests.
 */
export const INTEGRATION_NATIVE_CASES = [
    { id: 'draft-trial', name: 'disposable draft trial provisions actual finite state without verified status, enrollment, integration receipt or seal', timeoutMs: 60000 },
    { id: 'published-trial', name: 'a fresh utility trial keeps published food unchanged without granting autonomy or producing an integration seal', timeoutMs: 60000 },
    { id: 'day-profiles', name: 'both day-survival fixture modes provision and seal four real native avatars with the same nutrition rules', timeoutMs: 60000 },
    { id: 'genesis-replay', name: 'real native four-avatar genesis seals exact inventory, personal XP, lifecycle, needs, treasury, Property and grants; replay never duplicates', timeoutMs: 60000 },
    { id: 'treasury-drift', name: 'read-only preflight rejects native treasury drift and does not refill the account', timeoutMs: 60000 },
    { id: 'grant-clock-drift', name: 'grant deletion and moved clock cannot survive the exact native baseline seal', timeoutMs: 60000 },
    { id: 'baseline-archive', name: 'native baseline capture restores into a new directory with identical source/cache/runtime/native bindings and no credentials', timeoutMs: 60000 },
    { id: 'recovery-save', name: 'native version 8 reader accepts actual saves and fails closed on pending recovery assets', timeoutMs: 5000 },
    { id: 'live-result', name: 'progressed live world archives a real native consumption and rereads the same report after restore', timeoutMs: 60000 },
    { id: 'accelerated-test-result', name: 'progressed accelerated-test world archives a real native consumption and rereads the same report after restore', timeoutMs: 60000 }
] as const;
export type IntegrationNativeCaseId = typeof INTEGRATION_NATIVE_CASES[number]['id'];
// Measured process/cache setup ~1.5s; bounded watchdog/cleanup overhead is separate from the leaf budget.
export const NATIVE_PROCESS_OVERHEAD_MS = 5000;
export const exactNativeCasePattern = (name: string): string => `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
