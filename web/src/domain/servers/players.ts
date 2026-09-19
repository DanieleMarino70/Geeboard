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
  /** The connection id the game gave, for a dialect that has one. */
  id?: string;
}

/** A line as the runtime returned it, with the time it was recorded. */
export interface StampedLine {
  line: string;
  at?: string;
}

/* The joins and leaves in some lines, oldest first. Lines with no time
   are skipped: without one there is no way to put an event in order or
   to know it has not already been counted.

   A game that names a connection and its character on different lines
   — Valheim says "Got connection SteamID N", then "Got character ZDOID
   from Bob", and on the way out only "Closing socket N" — is read by
   pairing: a `connect` id waits for the next join without an id of its
   own, and a leave that carries only an id is the leave of whoever that
   id was paired with. Every line given is read for the pairing, and
   only lines after `since` become events, so a connection whose two
   lines fall either side of a poll is still paired on the next one. */
export function playerEvents(dialect: ConsoleDialect, lines: StampedLine[], since: Date | null = null): PlayerEvent[] {
  if (!dialect.players) return [];
  const join = new RegExp(dialect.players.join);
  const leave = new RegExp(dialect.players.leave);
  const connect = dialect.players.connect ? new RegExp(dialect.players.connect) : null;

  const stamped = lines
    .flatMap(({ line, at }) => {
      if (!at) return [];
      const when = new Date(at);
      return Number.isNaN(when.getTime()) ? [] : [{ text: line.trimEnd(), at: when }];
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const pending: string[] = [];
  const nameOf = new Map<string, string>();
  const idOf = new Map<string, string>();
  const events: PlayerEvent[] = [];
  const fresh = (at: Date) => !since || at.getTime() > since.getTime();

  for (const { text, at } of stamped) {
    const connected = connect?.exec(text)?.groups?.id;
    if (connected) {
      pending.push(connected);
      continue;
    }

    const joined = join.exec(text)?.groups;
    if (joined?.name) {
      const name = joined.name.trim();
      /* A name announced again with no new connection before it — a
         respawn — keeps the id it already has. */
      const id = joined.id ?? pending.shift() ?? idOf.get(name);
      if (id) {
        nameOf.set(id, name);
        idOf.set(name, id);
      }
      if (fresh(at)) events.push({ kind: "join", name, at, ...(id ? { id } : {}) });
      continue;
    }

    const left = leave.exec(text)?.groups;
    if (!left) continue;
    const name = left.name?.trim() ?? (left.id ? nameOf.get(left.id) : undefined);
    // An id nobody was paired with: a connection that never became a player.
    if (!name) continue;
    if (fresh(at)) events.push({ kind: "leave", name, at, ...(left.id ? { id: left.id } : {}) });
  }
  return events;
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
