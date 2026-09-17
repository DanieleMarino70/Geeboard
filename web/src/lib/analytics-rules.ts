/* The arithmetic behind the Analytics page, kept apart from the queries
   so it can be tested without a database. */

export const ANALYTICS_RANGES = {
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  // Metric samples are pruned after 30 days, so there is no longer window to offer.
  "30d": 30 * 24 * 3600_000,
} as const;
export type AnalyticsRange = keyof typeof ANALYTICS_RANGES;

export interface SessionSpan {
  username: string;
  serverName: string;
  joinedAt: Date;
  leftAt: Date | null;
}

/** Minutes of a session that fall inside the window; an open session runs to `to`. */
export function overlapMinutes(session: SessionSpan, from: Date, to: Date): number {
  const start = Math.max(session.joinedAt.getTime(), from.getTime());
  const end = Math.min((session.leftAt ?? to).getTime(), to.getTime());
  return end > start ? (end - start) / 60_000 : 0;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Playtime per player name inside the window, longest first. */
export function topPlayers(sessions: SessionSpan[], from: Date, to: Date, take = 8) {
  const totals = new Map<string, { minutes: number; servers: Set<string> }>();
  for (const s of sessions) {
    const minutes = overlapMinutes(s, from, to);
    if (minutes <= 0) continue;
    const entry = totals.get(s.username) ?? { minutes: 0, servers: new Set<string>() };
    entry.minutes += minutes;
    entry.servers.add(s.serverName);
    totals.set(s.username, entry);
  }
  return [...totals.entries()]
    .map(([username, t]) => ({ username, minutes: Math.round(t.minutes), servers: [...t.servers].sort() }))
    .sort((a, b) => b.minutes - a.minutes || a.username.localeCompare(b.username))
    .slice(0, take);
}

/* Joins by weekday and hour, in UTC. Rows run Monday to Sunday.

   UTC because the page is rendered on the server, which does not know
   the viewer's time zone — and a heatmap silently shifted by a few hours
   would say players come at the wrong time. The labels say UTC. */
export function joinHeatmap(joins: Date[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const at of joins) {
    const weekday = (at.getUTCDay() + 6) % 7;
    grid[weekday]![at.getUTCHours()]!++;
  }
  return grid;
}

export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0 min";
  if (minutes < 1) return "under 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
