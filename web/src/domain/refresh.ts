/* How often a page that is waiting for something draws itself again, by how long it has been waiting. */

export const FAST_MS = 5_000;
export const SLOW_MS = 15_000;
export const FAST_FOR_MS = 2 * 60_000;
export const GIVE_UP_MS = 10 * 60_000;

/** The wait before the next refresh for a page that has been waiting `ageMs`, or null once it has waited as long as it will. */
export function nextRefreshIn(ageMs: number): number | null {
  if (ageMs > GIVE_UP_MS) return null;
  return ageMs < FAST_FOR_MS ? FAST_MS : SLOW_MS;
}
