/**
 * Sliding-window rate limiter held in memory (no Redis on the free tier; the API
 * runs as a single instance). `consume` returns false once `limit` calls were
 * made within the last `windowMs`.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter(
      (at) => t - at < this.windowMs,
    );
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }

  /** Drops keys whose hits have all expired. Call now and then to bound memory. */
  prune(): void {
    const t = this.now();
    for (const [key, times] of this.hits) {
      if (times.every((at) => t - at >= this.windowMs)) this.hits.delete(key);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}
