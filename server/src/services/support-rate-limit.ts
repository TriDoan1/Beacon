/**
 * In-memory rate limiter for the support widget endpoints.
 *
 * Phase 0: simple per-key token bucket (sliding window). Replace with
 * Upstash Redis when we deploy Paperclip beyond the Mac mini — the bus
 * pattern matches what Tailwind already uses for its API.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  if (limit <= 0) {
    return { allowed: true, remaining: Number.POSITIVE_INFINITY, resetAt: 0 };
  }
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

export function clearAllRateLimits(): void {
  buckets.clear();
}
