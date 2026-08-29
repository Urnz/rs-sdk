export class InferenceQueue {
    private tail: Promise<void> = Promise.resolve();
    private waiting = 0;

    get pending(): number {
        return this.waiting;
    }

    enqueue<T>(operation: () => Promise<T>): Promise<T> {
        this.waiting++;
        const previous = this.tail;
        let release!: () => void;
        this.tail = new Promise<void>(resolve => { release = resolve; });
        return previous.then(operation).finally(() => {
            this.waiting--;
            release();
        });
    }
}
