import "server-only";

/* Attempt limiting for the places a password or a code is guessed:
   sign-in, the second factor, a setup link.

   Per process, like the API's rate limit, and honest about it — see
   docs/security.md "Known gaps". Behind one panel instance, which is
   how Geeboard runs today, it bounds a guessing script to a handful of
   tries a minute; behind several it bounds each instance. A code with a
   million possibilities and a thirty-second life needs exactly this
   kind of ceiling to mean anything. */

const buckets = new Map<string, { count: number; resetAt: number }>();

/** True when one more attempt under `key` is allowed; counts it either way. */
export function attempt(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 4096) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}

/** Forgets a key: a success ends the count against it. */
export function clearAttempts(key: string): void {
  buckets.delete(key);
}
