/* A minute of its own for each server's nightly backup.

   Every server the wizard made got "Daily backup" at `0 3 * * *`, the same minute for all of them: ten servers at two minutes each was twenty
   minutes of a poller doing nothing else, and ten archives written to one disk at once. The minute is taken from the server's id, so it is
   the same every time and needs no state: spread over 03:00 to 03:45, which leaves the quarter hour before four for the last to finish. */

/** How many minutes past three o'clock a server's backup may fall on: 03:00 to 03:45. */
export const STAGGER_MINUTES = 46;

/** FNV-1a over the id: the same answer for the same id, and no pattern in the ids (they are random) to bias it. */
function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function staggerMinute(serverId: string): number {
  return hashOf(serverId) % STAGGER_MINUTES;
}

/** The default nightly backup of a server: `<minute> 3 * * *`. */
export function nightlyBackupCron(serverId: string): string {
  return `${staggerMinute(serverId)} 3 * * *`;
}

/** How much later than its turn a server's world is measured again, so that servers measured in the same pass do not fall due in the same pass. */
export const WORLD_SIZE_SPREAD_MS = 2 * 60_000;

export function worldSizeJitterMs(serverId: string): number {
  return hashOf(`size:${serverId}`) % WORLD_SIZE_SPREAD_MS;
}

/** Whether a world is due to be measured: never measured, or measured longer ago than the interval and this server's own share of the spread. */
export function worldSizeDue(measuredAt: Date | null, serverId: string, now: number, everyMs: number): boolean {
  if (!measuredAt) return true;
  return now - measuredAt.getTime() >= everyMs + worldSizeJitterMs(serverId);
}
