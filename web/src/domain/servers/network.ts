/* How much a container sent and received between two readings.

   Docker's network counters are cumulative from the start of the container's
   network namespace, and they begin again at zero every time the container
   does: measured on 2026-10-03, 5.11 MB received, then 1.17 kB after a
   `docker restart`, and 1.17 kB again after a stop and a start. So the
   difference between two readings is not simply the second minus the first.
   If the run is a different one — the container started again in between — or
   the counter went down, what the second reading says is what has gone through
   since the new run began, and is the amount; the bytes between the last
   reading and the restart are lost, which is what a restart costs.

   The first reading of a run has nothing before it and is no amount at all. */

export interface NetReading {
  rx: number;
  tx: number;
  /** When the container's run began, as the node says; null when it did not say. */
  startedAt: Date | null;
}

export interface NetBase {
  rx: bigint | number | null;
  tx: bigint | number | null;
  startedAt: Date | null;
}

export interface NetDelta {
  rx: number;
  tx: number;
}

/** Two starts of one run read a little differently from the engine; further apart than this is another run. */
export const SAME_RUN_MS = 2_000;

const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

export function networkDelta(previous: NetBase, now: NetReading): NetDelta | null {
  if (previous.rx === null || previous.tx === null) return null;
  const rx = Number(previous.rx);
  const tx = Number(previous.tx);
  const anotherRun = previous.startedAt !== null && now.startedAt !== null && Math.abs(now.startedAt.getTime() - previous.startedAt.getTime()) > SAME_RUN_MS;
  const reset = anotherRun || now.rx < rx || now.tx < tx;
  return reset ? { rx: whole(now.rx), tx: whole(now.tx) } : { rx: whole(now.rx - rx), tx: whole(now.tx - tx) };
}
