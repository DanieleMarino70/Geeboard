/* Doing several things at once, a few at a time.

   The poller used to walk its nodes and their servers one call after another, so a pass was the sum of every round trip: a hundred servers
   at a second a stats call was three minutes in which nothing was watched. These are the two shapes it needs, kept apart from it so that
   the order in which things finish is something a test can set. */

/** Runs `work` for each item with at most `limit` in flight, and says how each ended; a throw is the item's and stops nobody. */
export async function mapPool<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const at = next++;
      try {
        results[at] = { status: "fulfilled", value: await work(items[at]!, at) };
      } catch (reason) {
        results[at] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}

/** A gate shared by everything that goes through it: at most `limit` pieces of work run at once, and the rest wait their turn in order. */
export function gate(limit: number): <T>(work: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: Array<() => void> = [];
  /* A place that is given back goes straight to the next in line and stays counted: freed and then taken a moment later, a caller that
     arrived in between would have found it empty, and there would have been one more than the limit. */
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };
  return async <T>(work: () => Promise<T>) => {
    if (running >= Math.max(1, limit)) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      return await work();
    } finally {
      release();
    }
  };
}

/** Gives up waiting for `work` after `ms`, and says so with `onLate`'s value. The work is not cancelled: it ends by its own limits, and nothing here waits for it. */
export function withDeadline<T, L>(work: Promise<T>, ms: number, onLate: () => L): Promise<T | L> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<L>((resolve) => {
    timer = setTimeout(() => resolve(onLate()), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
