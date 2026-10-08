/* The counter behind attempt limiting, without the panel around it, so that its ceiling can be held by a test (lib/attempts.ts is the one
   the panel uses, and is server-only).

   A key is made by whoever sends the request (an address typed into a form), so the number of them is bounded here and not by good
   behaviour: the audit of 0.9.5 posted a different address each time and watched the map grow for fifteen minutes while every insertion
   swept all of it. Expired keys are swept at most twice a minute; past the ceiling the oldest key is dropped for the new one, which costs an
   attacker who floods the map nothing it could not already do and costs nobody else more than a counter that starts again. The callers keep
   a key short and fixed in size (a hash, not the text that was sent) and count the source first. */

export interface AttemptCounter {
  /** True when one more attempt under `key` is allowed; counts it either way. */
  attempt(key: string, limit: number, windowMs: number): boolean;
  /** Whether `key` has already used its `limit`, without counting this look. */
  exhausted(key: string, limit: number): boolean;
  /** Forgets a key: a success ends the count against it. */
  clear(key: string): void;
  /** How many keys are held. */
  size(): number;
}

export function createAttemptCounter(options: { max?: number; sweepEveryMs?: number; now?: () => number } = {}): AttemptCounter {
  const max = options.max ?? 20_000;
  const sweepEvery = options.sweepEveryMs ?? 30_000;
  const clock = options.now ?? Date.now;
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let sweptAt = 0;

  const sweep = (now: number): void => {
    sweptAt = now;
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  };

  return {
    attempt(key, limit, windowMs) {
      const now = clock();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        if (buckets.size >= max / 2 && now - sweptAt >= sweepEvery) sweep(now);
        if (buckets.size >= max) {
          const oldest = buckets.keys().next().value;
          if (oldest !== undefined) buckets.delete(oldest);
        }
        // Deleted first so that an expired key goes to the end of the order: the oldest is then the one that has waited longest.
        buckets.delete(key);
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      bucket.count++;
      return bucket.count <= limit;
    },
    exhausted(key, limit) {
      const bucket = buckets.get(key);
      return !!bucket && bucket.resetAt > clock() && bucket.count >= limit;
    },
    clear(key) {
      buckets.delete(key);
    },
    size: () => buckets.size,
  };
}
