import { randomUUID } from 'node:crypto';

export interface InferenceQueueAdmission {
    requestId: string;
    agentId: string;
    priority: number;
    enqueuedAt: string;
}

export interface InferenceQueueClaimStore {
    admit(admission: InferenceQueueAdmission, maxBacklog: number): void;
    claim(requestId: string, leaseOwner: string, leaseExpiresAt: string, now: string): boolean;
    complete(requestId: string, leaseOwner: string, status: 'completed' | 'failed', now: string,
        error?: string): void;
}

export interface InferenceQueueOptions {
    maxBacklog?: number;
    claimLeaseMs?: number;
    maxRateLimitRetries?: number;
    baseRateLimitBackoffMs?: number;
    maxRateLimitBackoffMs?: number;
    claimStore?: InferenceQueueClaimStore;
    leaseOwner?: string;
    now?: () => number;
}

export class InferenceQueueBacklogError extends Error {
    constructor(maxBacklog: number) {
        super(`Inference queue backlog limit reached (${maxBacklog})`);
        this.name = 'InferenceQueueBacklogError';
    }
}

export class InferenceQueueRateLimitError extends Error {
    constructor(message: string, readonly retryAfterMs: number | null = null) {
        super(message);
        this.name = 'InferenceQueueRateLimitError';
    }
}

type PendingJob<T> = InferenceQueueAdmission & {
    sequence: number;
    operation: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number,
    label: string): number {
    const resolved = value ?? fallback;
    if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
        throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
    }
    return resolved;
}

function abortError(): DOMException {
    return new DOMException('The operation was aborted', 'AbortError');
}

/** Highest priority first, round-robin between agents, FIFO within each agent. */
export class InferenceQueue {
    private readonly jobs: PendingJob<unknown>[] = [];
    private readonly lastAgentByPriority = new Map<number, string>();
    private readonly maxBacklog: number;
    private readonly claimLeaseMs: number;
    private readonly maxRateLimitRetries: number;
    private readonly baseRateLimitBackoffMs: number;
    private readonly maxRateLimitBackoffMs: number;
    private readonly claimStore?: InferenceQueueClaimStore;
    private readonly leaseOwner: string;
    private readonly now: () => number;
    private active = false;
    private sequence = 0;
    private providerBackoffUntil = 0;

    constructor(options: InferenceQueueOptions = {}) {
        this.maxBacklog = boundedInteger(options.maxBacklog, 100, 1, 10_000, 'maxBacklog');
        this.claimLeaseMs = boundedInteger(options.claimLeaseMs, 15 * 60_000, 1_000, 60 * 60_000, 'claimLeaseMs');
        this.maxRateLimitRetries = boundedInteger(options.maxRateLimitRetries, 2, 0, 10, 'maxRateLimitRetries');
        this.baseRateLimitBackoffMs = boundedInteger(options.baseRateLimitBackoffMs, 1_000, 1, 300_000,
            'baseRateLimitBackoffMs');
        this.maxRateLimitBackoffMs = boundedInteger(options.maxRateLimitBackoffMs, 60_000,
            this.baseRateLimitBackoffMs, 15 * 60_000, 'maxRateLimitBackoffMs');
        this.claimStore = options.claimStore;
        this.leaseOwner = options.leaseOwner?.trim() || `inference-queue:${process.pid}:${randomUUID()}`;
        this.now = options.now ?? Date.now;
    }

    get pending(): number {
        return this.jobs.length + (this.active ? 1 : 0);
    }

    get backoffUntil(): string | null {
        return this.providerBackoffUntil > this.now() ? new Date(this.providerBackoffUntil).toISOString() : null;
    }

    enqueue<T>(operation: () => Promise<T>, metadata: Partial<Omit<InferenceQueueAdmission, 'enqueuedAt'>> = {}): Promise<T> {
        if (this.pending >= this.maxBacklog) return Promise.reject(new InferenceQueueBacklogError(this.maxBacklog));
        const agentId = metadata.agentId?.trim().toLowerCase() || 'anonymous';
        if (!/^[a-z0-9][a-z0-9.-]{0,99}$/.test(agentId)) return Promise.reject(new Error('Invalid inference queue agent id'));
        const priority = boundedInteger(metadata.priority, 50, 0, 100, 'Inference queue priority');
        const admission: InferenceQueueAdmission = {
            requestId: metadata.requestId?.trim() || randomUUID(), agentId, priority,
            enqueuedAt: new Date(this.now()).toISOString()
        };
        if (!admission.requestId || admission.requestId.length > 200) {
            return Promise.reject(new Error('Invalid inference queue request id'));
        }
        try { this.claimStore?.admit(admission, this.maxBacklog); }
        catch (error) { return Promise.reject(error); }
        return new Promise<T>((resolve, reject) => {
            this.jobs.push({ ...admission, sequence: this.sequence++, operation, resolve, reject } as PendingJob<unknown>);
            this.pump();
        });
    }

    async completeWithRateLimitBackoff<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
        for (let attempt = 0; ; attempt++) {
            await this.waitForProvider(signal);
            try { return await operation(); }
            catch (error) {
                if (!(error instanceof InferenceQueueRateLimitError) || attempt >= this.maxRateLimitRetries) throw error;
                const exponential = this.baseRateLimitBackoffMs * (2 ** attempt);
                const requested = error.retryAfterMs === null ? exponential : Math.max(exponential, error.retryAfterMs);
                this.providerBackoffUntil = Math.max(this.providerBackoffUntil,
                    this.now() + Math.min(this.maxRateLimitBackoffMs, requested));
            }
        }
    }

    private async waitForProvider(signal: AbortSignal): Promise<void> {
        while (this.providerBackoffUntil > this.now()) {
            if (signal.aborted) throw abortError();
            const delay = Math.min(this.providerBackoffUntil - this.now(), 1_000);
            await new Promise<void>((resolve, reject) => {
                const onAbort = () => { clearTimeout(timer); reject(abortError()); };
                const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, delay);
                signal.addEventListener('abort', onAbort, { once: true });
            });
        }
    }

    private takeNext(): PendingJob<unknown> | undefined {
        if (!this.jobs.length) return undefined;
        const priority = Math.max(...this.jobs.map(job => job.priority));
        const tier = this.jobs.filter(job => job.priority === priority);
        const agents = [...new Set(tier.map(job => job.agentId))];
        const previous = this.lastAgentByPriority.get(priority);
        const previousIndex = previous ? agents.indexOf(previous) : -1;
        const agent = agents[(previousIndex + 1) % agents.length]!;
        this.lastAgentByPriority.set(priority, agent);
        const index = this.jobs.findIndex(job => job.priority === priority && job.agentId === agent);
        return this.jobs.splice(index, 1)[0];
    }

    private pump(): void {
        if (this.active) return;
        const job = this.takeNext();
        if (!job) return;
        this.active = true;
        const now = new Date(this.now()).toISOString();
        const expires = new Date(this.now() + this.claimLeaseMs).toISOString();
        try {
            if (this.claimStore && !this.claimStore.claim(job.requestId, this.leaseOwner, expires, now)) {
                throw new Error(`Inference queue request ${job.requestId} could not acquire its persisted claim`);
            }
        } catch (error) {
            this.active = false;
            job.reject(error);
            queueMicrotask(() => this.pump());
            return;
        }
        void job.operation().then(value => {
            try {
                this.claimStore?.complete(job.requestId, this.leaseOwner, 'completed', new Date(this.now()).toISOString());
                job.resolve(value);
            } catch (error) { job.reject(error); }
        }, error => {
            try { this.claimStore?.complete(job.requestId, this.leaseOwner, 'failed',
                new Date(this.now()).toISOString(), error instanceof Error ? error.message : String(error)); }
            finally { job.reject(error); }
        }).finally(() => {
            this.active = false;
            this.pump();
        });
    }
}
