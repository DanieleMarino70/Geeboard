/* What the boot check of the stored secrets says (lib/sealed-check.ts opens them; this words the result). */

export interface SealedReport {
  /** Values that were opened. */
  opened: number;
  /** What did not open, by where it is kept; empty when all did. */
  unreadable: Array<{ what: string; count: number }>;
}

/** The one line for the log, or null when everything opened. */
export function describeSealed(report: SealedReport): string | null {
  if (report.unreadable.length === 0) return null;
  const total = report.unreadable.reduce((n, u) => n + u.count, 0);
  const where = report.unreadable.map((u) => `${u.what}: ${u.count}`).join(", ");
  return `${total} stored secret${total === 1 ? "" : "s"} do${total === 1 ? "es" : ""} not open with SECRETS_KEY (${where})`;
}
