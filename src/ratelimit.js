// Fixed-window, in-memory rate limiter. Per process (Node) or per isolate
// (Workers): a best-effort abuse brake, not a hard global quota.
export class RateLimiter {
  constructor(now = Date.now, windowMs = 60_000) {
    this.now = now;
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  bucket(key) {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b || t >= b.reset) {
      b = { count: 0, reset: t + this.windowMs };
      this.buckets.set(key, b);
      if (this.buckets.size > 50_000) this.sweep(t);
    }
    return b;
  }

  // Counts a hit. Returns seconds until reset when over the limit, else 0.
  hit(key, limit) {
    const b = this.bucket(key);
    b.count++;
    return b.count > limit ? Math.max(1, Math.ceil((b.reset - this.now()) / 1000)) : 0;
  }

  // Returns seconds until reset when the key is already at/over the limit.
  check(key, limit) {
    const b = this.bucket(key);
    return b.count >= limit ? Math.max(1, Math.ceil((b.reset - this.now()) / 1000)) : 0;
  }

  sweep(t) {
    for (const [k, b] of this.buckets) if (t >= b.reset) this.buckets.delete(k);
  }
}
