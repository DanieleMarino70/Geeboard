import "server-only";
import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { db } from "@/lib/db";
import {
  restartServerOp,
  startServerOp,
  stopServerOp,
  type OpResult,
} from "@/lib/server-ops";
import { resolveServer } from "./_resolve";

/* The lifecycle routes, which are three lines each once this is here.

   Note what they do not do: reimplement anything. The operations in
   server-ops.ts already know how to start a server, what to refuse and
   what to write to the audit log, and the API calling the same functions
   as the panel's buttons is the only way the two can be relied on to
   behave the same way. */

const ACTIONS = {
  start: { op: startServerOp, permission: "server.start" },
  stop: { op: stopServerOp, permission: "server.stop" },
  restart: { op: restartServerOp, permission: "server.restart" },
} as const;

export type Action = keyof typeof ACTIONS;

export async function lifecycle(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
  action: Action,
) {
  try {
    /* Lifecycle actions reach a machine and cost it something, so they
       get a tighter budget than a read. */
    const principal = await begin(req, 30);
    const { id } = await ctx.params;
    const server = await resolveServer(id);

    const { op, permission } = ACTIONS[action];
    mustAllow(principal, permission, server.ownerId);

    // The operations take a user row, so the principal has to become one.
    const user = await db.user.findUnique({ where: { id: principal.id } });
    if (!user) throw new PlatformError("UNAUTHENTICATED", "That account no longer exists.");

    const result: OpResult = await op(user, server.slug);
    if (!result.ok) {
      /* A refused operation is the caller's problem, not a fault. The
         message is already written for a person; the code is what a
         program switches on. */
      throw new PlatformError("SERVER_STATE_INVALID", `${result.title}. ${result.body}`, {
        details: { action, server: server.slug },
      });
    }

    return ok({ action, server: server.slug, message: `${result.title}. ${result.body}` }, 202);
  } catch (error) {
    return fail(error);
  }
}
