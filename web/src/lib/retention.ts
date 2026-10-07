/* Which backups a cleanup removes. Pure, so the arithmetic is tested without a database.

   The rule used to be "keep the newest N rows that are not locked", and a row
   is also a backup that failed or is still being written. Seven days of
   failures — a disk that filled, a node whose uplink to the bucket was cut,
   an agent restarted mid-archive — left seven failed rows in the seven slots,
   and the cleanup removed every good backup older than them at the moment
   they were all anybody had. So the count is of complete backups only:

   - the newest `keep` complete ones stay, whatever else is in the table;
   - a failed row is not a backup and takes no slot, and goes by age, with
     whatever bytes it left behind;
   - a running row is somebody's work in progress and is left alone, and so is a
     locked one, which an operator said to keep. */

export interface RetentionRow {
  id: string;
  state: "RUNNING" | "COMPLETE" | "FAILED" | "LOCKED";
  createdAt: Date;
}

/** A failed row is evidence for a week, then it is clutter. */
export const FAILED_KEPT_DAYS = 7;

export interface RetentionPlan<T extends RetentionRow> {
  /** Complete backups beyond the newest `keep`. */
  surplus: T[];
  /** Failed rows older than FAILED_KEPT_DAYS. */
  stale: T[];
}

export function planRetention<T extends RetentionRow>(rows: T[], keep: number, now: Date): RetentionPlan<T> {
  const complete = rows
    .filter((row) => row.state === "COMPLETE")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const cutoff = now.getTime() - FAILED_KEPT_DAYS * 24 * 3600_000;
  /* A count that is not a number, or is negative, is a mistake somewhere
     upstream and removes nothing: the explicit sweep is zero, not -1. */
  const sound = Number.isFinite(keep) && keep >= 0;
  return {
    surplus: sound ? complete.slice(Math.floor(keep)) : [],
    stale: rows.filter((row) => row.state === "FAILED" && row.createdAt.getTime() < cutoff),
  };
}
