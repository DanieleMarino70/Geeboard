import "server-only";
import { randomUUID } from "node:crypto";
import type { ServerState } from "@prisma/client";
import {
  BEAT_MS,
  HELD_BY_OPERATION,
  OPERABLE,
  OPERATION_STATE,
  STALE_MS_DEFAULT,
  busyReason,
  interruption,
  isSilent,
  type Operation,
} from "@/domain/servers/operation";
import { db } from "./db";
import { logger } from "./log";

/* A server that an operation holds: claimed before it begins, kept fresh while it runs, given back when whoever held it is gone.
   The reasons are in domain/servers/operation.ts; this is the database half. */

/* "<panel or poller>:<id of this process>". Kept on globalThis so that a development server's module reloads do not make a new one
   in the middle of an operation. */
const globals = globalThis as unknown as { geeboardInstance?: string };
export const INSTANCE = (globals.geeboardInstance ??= `${process.env.GEEBOARD_COMPONENT ?? "panel"}:${randomUUID().slice(0, 8)}`);

/* The columns are left as the operation wrote them when it ends: only a held state (BACKING_UP, UPDATING, MIGRATING) means they are current, and
   every reader looks at the state first. The next claim writes them again. */
export type Claim =
  | { ok: true; operation: Operation; stateBefore: ServerState; since: Date }
  | { ok: false; sentence: string };

/* Takes the server for an operation, or says why not.

   One statement: it changes the state only if the server is settled, and returns what it was, so that of two operations that begin
   in the same second exactly one finds a server it can take, and the other is told what has it, and since when. (A read, then a
   write, would let both through; that is what the backup, update and restore used to do, and it is how a server came to be left
   "Backing up" for ever by the second of two backups.) */
export async function claimServer(serverId: string, operation: Operation): Promise<Claim> {
  const state = OPERATION_STATE[operation];
  const since = new Date();
  const rows = await db.$queryRaw<{ stateBefore: ServerState }[]>`
    UPDATE "servers"
       SET "stateBefore" = "state",
           "state" = ${state}::"ServerState",
           "operation" = ${operation},
           "operationOwner" = ${INSTANCE},
           "operationStartedAt" = ${since},
           "operationBeat" = ${since}
     WHERE "id" = ${serverId} AND "state" = ANY(${OPERABLE as ServerState[]}::"ServerState"[])
 RETURNING "stateBefore"`;
  if (rows.length === 0) {
    const current = await db.server.findUnique({ where: { id: serverId }, select: { state: true, operation: true, operationStartedAt: true } });
    return { ok: false, sentence: current ? busyReason(current, Date.now()) : "That server no longer exists." };
  }
  beat(serverId, since);
  return { ok: true, operation, stateBefore: rows[0]!.stateBefore, since };
}

/* Says "still here" every thirty seconds, for as long as this claim is the one that holds the server: when the state has moved on, or
   another operation holds it now, the next beat finds nothing to write and the timer ends itself. Unreferenced, so it never keeps a
   process alive; and if the process is gone the beats are, which is what the reaper looks for. */
function beat(serverId: string, since: Date) {
  // OPERATION_BEAT_MS is for the verification, which cannot wait half a minute to see one.
  const every = Number(process.env.OPERATION_BEAT_MS) || BEAT_MS;
  const timer = setInterval(() => {
    db.server
      .updateMany({
        where: { id: serverId, operationStartedAt: since, state: { in: [...HELD_BY_OPERATION] } },
        data: { operationBeat: new Date() },
      })
      .then(
        (result) => {
          if (result.count === 0) clearInterval(timer);
        },
        () => {
          /* A database that did not answer once is not the end of the operation: the next beat tries again. */
        },
      );
  }, every);
  timer.unref();
}

export interface Reaped {
  slug: string;
  operation: string | null;
  sentence: string;
  state: ServerState;
}

/* Gives back the servers whose operation was cut short.

   Two ways to know. The sure one is knowing the process is gone: a panel or a poller that has just started holds no operation yet,
   so whatever the same kind of process left behind (another id of the same component) is dead — one panel and one poller is the rule,
   and the poller's is enforced (lib/poller-lock.ts). The other is silence: no beat for longer than \`staleMs\`, which catches an
   operation that is hung and a process that went without a restart. A live operation is not reaped by the second, because it beats;
   one that is reaped wrongly (the database was away for minutes) writes its own result when it finishes, which is the last word. */
export async function reapInterrupted(options: { staleMs?: number; afterStartOf?: "panel" | "poller" } = {}): Promise<Reaped[]> {
  const staleMs = options.staleMs ?? Number(process.env.OPERATION_STALE_MS ?? STALE_MS_DEFAULT);
  const now = Date.now();
  const held = await db.server.findMany({
    where: { state: { in: [...HELD_BY_OPERATION] } },
    select: {
      id: true,
      slug: true,
      name: true,
      state: true,
      operation: true,
      operationOwner: true,
      operationStartedAt: true,
      operationBeat: true,
      stateBefore: true,
      updatedAt: true,
    },
  });

  const reaped: Reaped[] = [];
  for (const server of held) {
    const ownerGone =
      options.afterStartOf !== undefined &&
      server.operationOwner !== null &&
      server.operationOwner.startsWith(`${options.afterStartOf}:`) &&
      server.operationOwner !== INSTANCE;
    const silent = isSilent(server.operationBeat, server.updatedAt, now, staleMs);
    if (!ownerGone && !silent) continue;

    const outcome = interruption(
      server.operation,
      server.stateBefore,
      ownerGone ? { kind: "restarted", process: options.afterStartOf! } : { kind: "silent", ms: now - (server.operationBeat ?? server.updatedAt).getTime() },
    );

    // Only if it is still what was read: an operation that finished a moment ago has said its own last word.
    const given = await db.server.updateMany({
      where: { id: server.id, state: server.state, operationStartedAt: server.operationStartedAt },
      data: {
        state: outcome.state,
        lastError: outcome.lastError,
        operation: null,
        operationOwner: null,
        operationStartedAt: null,
        operationBeat: null,
        stateBefore: null,
      },
    });
    if (given.count === 0) continue;

    if (server.operation === "backup") {
      await db.backup.updateMany({
        where: { serverId: server.id, state: "RUNNING" },
        data: { state: "FAILED", error: outcome.sentence },
      });
    }
    await db.activityEvent.create({
      data: {
        actor: "Watchdog",
        action: "server.operation.interrupted",
        target: server.name,
        tone: "WARNING",
        serverId: server.id,
        changes: { Operation: { from: server.operation ?? "unknown", to: "interrupted" }, Reason: { from: "—", to: outcome.sentence } },
      },
    });
    logger.warn("an operation was cut short and its server given back", { server: server.slug, operation: server.operation ?? undefined, now: outcome.state, detail: outcome.sentence });
    reaped.push({ slug: server.slug, operation: server.operation, sentence: outcome.sentence, state: outcome.state });
  }
  return reaped;
}
