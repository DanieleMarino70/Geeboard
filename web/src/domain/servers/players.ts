import type { ConsoleDialect } from "../games/types";

/* Who is on a server, read from what its console says.

   No game here is asked — there is no query protocol on the node — so
   this is the console's own account of arrivals and departures, replayed
   in order. It can only be as right as the lines it is given: a server
   that has been up longer than the node keeps logs for, or a player who
   joined before the panel first looked, is not known about until they
   leave and join again. */

export interface PlayerEvent {
  kind: "join" | "leave";
  name: string;
  at: Date;
}

/** A line as the runtime returned it, with the time it was recorded. */
export interface StampedLine {
  line: string;
  at?: string;
}

/* The joins and leaves in some lines, oldest first. Lines with no time
   are skipped: without one there is no way to put an event in order or
   to know it has not already been counted. */
export function playerEvents(dialect: ConsoleDialect, lines: StampedLine[]): PlayerEvent[] {
  if (!dialect.players) return [];
  const join = new RegExp(dialect.players.join);
  const leave = new RegExp(dialect.players.leave);

  const events: PlayerEvent[] = [];
  for (const { line, at } of lines) {
    if (!at) continue;
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) continue;

    const text = line.trimEnd();
    const joined = join.exec(text)?.groups?.name;
    if (joined) {
      events.push({ kind: "join", name: joined.trim(), at: when });
      continue;
    }
    const left = leave.exec(text)?.groups?.name;
    if (left) events.push({ kind: "leave", name: left.trim(), at: when });
  }
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/* The lines not yet counted: strictly after the cursor. Docker's `since`
   is whole seconds, so a read hands back some of the second the cursor
   is in, and those have been seen. */
export function unreadLines(lines: StampedLine[], cursor: Date | null): StampedLine[] {
  if (!cursor) return lines;
  return lines.filter((l) => l.at !== undefined && new Date(l.at).getTime() > cursor.getTime());
}

/** The newest time among some lines, or the cursor it started from. */
export function advanceCursor(lines: StampedLine[], cursor: Date | null): Date | null {
  let latest = cursor;
  for (const { at } of lines) {
    if (!at) continue;
    const when = new Date(at);
    if (!Number.isNaN(when.getTime()) && (!latest || when > latest)) latest = when;
  }
  return latest;
}

/* Where a read should start. A cursor from an earlier run of the server
   is no use — everyone connected then has gone — so a new run is read
   from its own start. */
export function readFrom(cursor: Date | null, runStartedAt: Date | null): Date | null {
  if (!runStartedAt) return cursor;
  if (!cursor || cursor < runStartedAt) return runStartedAt;
  return cursor;
}
