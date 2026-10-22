import { createHash } from 'node:crypto';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { LivelihoodAction, LivelihoodJournalEntry } from '../../../agent-state/livelihood.js';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import type { ReplanOutcome } from './replan-coordinator.js';
import { LIVELIHOOD_POLICY_KEY, selectLivelihoodAction, type LivelihoodSnapshot } from './livelihood-policy.js';

export interface LivelihoodReceipt { status: 'completed' | 'pending' | 'failed' | 'expected-failure'; reason: string; source: string | null }
/** Trusted backend adapters only. Neither chat nor a model may supply these snapshots/receipts. */
export interface LivelihoodPorts {
    snapshot(agentId: string): Promise<LivelihoodSnapshot>;
    execute(entry: LivelihoodJournalEntry): Promise<LivelihoodReceipt>;
    reconcile(entry: LivelihoodJournalEntry): Promise<LivelihoodReceipt>;
    reconcileFailedSkill?(entry: LivelihoodJournalEntry, runId: string): Promise<LivelihoodReceipt | null>;
}
export interface LivelihoodRuntimeOptions {
    agentPath: string; ports: LivelihoodPorts;
    dispatchSkill(entry: LivelihoodJournalEntry & { action: Extract<LivelihoodAction, { kind: 'skill' }> }): Promise<ReplanOutcome>;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const outcome = (id: string, status: string, reason: string, entry?: LivelihoodJournalEntry): ReplanOutcome => ({
    runId: id, status, reason: `livelihood:${reason}`,
    decision: { kind: 'livelihood', policy: LIVELIHOOD_POLICY_KEY, actionId: entry?.actionId ?? null,
        action: entry?.action ?? null, phase: entry?.phase ?? null, reasonCode: reason, receipt: entry?.receipt ?? null }
});

export async function runLivelihoodReplan(agentId: string, event: LlmReplanEvent,
    options: LivelihoodRuntimeOptions): Promise<ReplanOutcome> {
    const use = <T>(fn: (store: AgentStateStore) => T): T => {
        const store = new AgentStateStore(options.agentPath); try { return fn(store); } finally { store.close(); }
    };
    const save = (entry: LivelihoodJournalEntry, phase: LivelihoodJournalEntry['phase'], reason: string, receipt: string | null) =>
        use(s => s.writeLivelihoodJournal({ ...entry, phase, reason, receipt,
            updatedAt: new Date().toISOString(), revision: entry.revision + 1 }, entry.revision));
    const settle = (entry: LivelihoodJournalEntry, proof: LivelihoodReceipt) => {
        if (proof.status === 'pending') {
            const pending = save(entry, 'submitted', proof.reason, null);
            return outcome(event.eventId, proof.reason === 'clock-paused' ? 'waiting' : 'bounded-wait', proof.reason, pending);
        }
        if (['completed', 'expected-failure'].includes(proof.status) && !proof.source) throw new Error('Routine completion needs canonical source proof');
        const terminal = save(entry, proof.status === 'completed' ? 'completed' : 'blocked', proof.reason, proof.source);
        return outcome(event.eventId, proof.status === 'completed' ? 'completed' : proof.status === 'expected-failure' ? 'waiting' : 'input-required', proof.reason, terminal);
    };
    let entry: LivelihoodJournalEntry | undefined;
    try {
        const snapshot = await options.ports.snapshot(agentId);
        const journal = use(s => s.listLivelihoodJournal(agentId));
        entry = journal.find(e => e.phase === 'prepared' || e.phase === 'submitted');
        // Terminal lifecycle never starts or replays gameplay; pending custody stays visible for reconciliation.
        if (!snapshot.alive) {
            if (entry) save(entry, entry.phase, 'lifecycle-terminal-reconciliation-required', entry.receipt);
            return outcome(event.eventId, 'operator-warning', 'lifecycle-terminal-reconciliation-required', entry);
        }
        if (entry && (entry.lifecycle !== snapshot.lifecycle || entry.policy !== LIVELIHOOD_POLICY_KEY))
            return outcome(event.eventId, 'operator-warning', 'pending-binding-differs', entry);
        if (entry?.phase === 'submitted') {
            if (entry.action?.kind === 'skill') {
                const dispatch = use(s => s.listSkillDispatches(agentId, 500).find(d => d.decisionId === entry!.eventId));
                const terminal = dispatch ? use(s => s.getSkillRunOutcome(dispatch.runId)) : null;
                if (terminal?.status !== 'completed' && terminal && options.ports.reconcileFailedSkill) {
                    const canonical = await options.ports.reconcileFailedSkill(entry, terminal.runId);
                    if (canonical) return settle(entry, canonical);
                }
                if (terminal) return settle(entry, { status: terminal.status === 'completed' ? 'completed' : 'failed',
                    reason: terminal.status === 'completed' ? 'skill-source-completed' : `skill-${terminal.classification}`,
                    source: `skill-run:${terminal.runId}` });
                // A dispatch intent without terminal evidence is never a licence to start another process.
                return outcome(event.eventId, 'bounded-wait', 'skill-terminal-pending', entry);
            }
            return settle(entry, await options.ports.reconcile(entry));
        }
        if (!entry) {
            const prior = journal.find(e => e.eventId === event.eventId);
            if (prior) return outcome(event.eventId, prior.phase === 'completed' ? 'completed' : 'input-required', prior.reason, prior);
            const choice = selectLivelihoodAction(snapshot);
            const now = new Date().toISOString();
            const profile = use(s => s.getControlProfile(agentId));
            if (!profile) return outcome(event.eventId, 'input-required', 'control-profile-required');
            use(s => s.recordDecision(agentId, profile.revision, { decisionId: event.eventId,
                trigger: event.type === 'autonomy-startup' || event.type === 'autonomy-idle' ? 'scheduled' : 'event',
                llmCostMicros: 0, operationalBudgetGp: 0, contextDigest: digest(snapshot) }, now));
            entry = use(s => s.writeLivelihoodJournal({ actionId: `routine.${digest([agentId, event.eventId]).slice(0, 48)}`,
                agentId, eventId: event.eventId, policy: LIVELIHOOD_POLICY_KEY, lifecycle: snapshot.lifecycle,
                action: choice.action, phase: choice.action ? 'prepared' : 'blocked', reason: choice.reason,
                receipt: null, createdAt: now, updatedAt: now, revision: 1 }, null));
            if (!choice.action) return outcome(event.eventId,
                ['rest-in-progress', 'no-due-routine', 'clock-paused', 'stock-satisfied', 'stock-work-in-progress', 'stock-input-required'].includes(choice.reason)
                    ? 'waiting' : 'input-required', choice.reason, entry);
        }
        // The immutable prepared intent is written before *any* external side effect.
        // Recheck the priority after a restart: prepared work must not beat newly urgent self-care.
        if (JSON.stringify(selectLivelihoodAction(snapshot).action) !== JSON.stringify(entry.action)) {
            const blocked = save(entry, 'blocked', 'prepared-context-changed', null);
            return outcome(event.eventId, 'bounded-wait', blocked.reason, blocked);
        }
        if (entry.action?.kind === 'skill') {
            const submitted = save(entry, 'submitted', 'skill-dispatch-intent', null);
            const result = await options.dispatchSkill({ ...submitted, action: entry.action });
            if (result.status !== 'executing') {
                const blocked = save(submitted, 'blocked', 'skill-authorization-or-input-required', null);
                return outcome(event.eventId, 'input-required', blocked.reason, blocked);
            }
            return { ...result, decision: { kind: 'livelihood', actionId: submitted.actionId, action: entry.action } };
        }
        const submitted = save(entry, 'submitted', 'native-dispatch-intent', null);
        return settle(submitted, await options.ports.execute(submitted));
    } catch (error) {
        // Preserve submitted intent on transport failure: reconciliation, never a new economic operation.
        const current = use(s => s.listLivelihoodJournal(agentId).find(e => e.actionId === entry?.actionId));
        if (current && ['prepared', 'submitted'].includes(current.phase)) save(current, current.phase, 'adapter-reconciliation-required', null);
        return { ...outcome(event.eventId, 'bounded-wait', 'adapter-reconciliation-required', current),
            decision: { kind: 'livelihood', actionId: current?.actionId ?? null,
                reasonCode: 'adapter-reconciliation-required', detail: error instanceof Error ? error.message : String(error) } };
    }
}
