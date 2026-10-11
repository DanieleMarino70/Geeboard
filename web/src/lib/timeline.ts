/* The Scheduler's "Next 24 hours", as slots.

   Each firing used to be an icon at its own place on the line, and a task every thirty minutes put forty-eight of them on it: a pile, and
   the count beside the heading said fourteen, because only the first eight of each task and fourteen in all were drawn. The line is now cut
   into equal slots, and each slot with anything in it is one mark that says how many and, on a pointer or the keyboard, which and when.
   How many slots depends on the width there is (the page draws a phone's, a tablet's and a desktop's and shows the one that fits), so
   nothing has to be measured and two marks never overlap. */

export interface Slot<F> {
  /** Where the slot is on the line, from 0. */
  index: number;
  start: Date;
  end: Date;
  firings: F[];
}

/** The firings from `from` to `hours` later, in `count` equal slots: only the slots that have any, in order, each with its firings in order. */
export function slotFirings<F extends { at: Date }>(firings: F[], from: Date, hours: number, count: number): Array<Slot<F>> {
  const span = hours * 3600_000;
  const width = span / count;
  const slots = new Map<number, F[]>();
  for (const f of [...firings].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const offset = f.at.getTime() - from.getTime();
    if (offset < 0 || offset > span) continue;
    // A firing at the very end of the window belongs to the last slot, not to one past it.
    const index = Math.min(count - 1, Math.floor(offset / width));
    slots.set(index, [...(slots.get(index) ?? []), f]);
  }
  return [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, inSlot]) => ({
      index,
      start: new Date(from.getTime() + index * width),
      end: new Date(from.getTime() + (index + 1) * width),
      firings: inSlot,
    }));
}

/** "14:30" in UTC, as the expressions are. */
export function utcClock(at: Date): string {
  return `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
}
