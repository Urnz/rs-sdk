/** Fixed memory bound; client keys come only from the socket, never forwarded headers. */
export class RequestBudget {
    private buckets = new Map<string, { start: number; count: number }>();
    constructor(private now = Date.now) {}
    take(key: string, limit: number) {
        const now = this.now();
        let bucket = this.buckets.get(key);
        if (!bucket || now - bucket.start >= 60000) {
            for (const [id, value] of this.buckets) if (now - value.start >= 60000) this.buckets.delete(id);
            if (!bucket && this.buckets.size >= 4096) return false;
            bucket = { start: now, count: 0 }; this.buckets.set(key, bucket);
        }
        return ++bucket.count <= limit;
    }
}
