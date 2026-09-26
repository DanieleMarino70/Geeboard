import type { Role } from "@prisma/client";
import { accountGate } from "./account";
import { can, type Permission } from "./permissions";

/* Who may go on reading a stream.

   A page is authorised once, when it is drawn, and that is enough: the
   next thing the person does is another request, asked again. A stream
   is one request that lasts as long as the tab stays open — a console
   left on a second screen for a week — so a check made only when it
   opened outlives a role taken away and a session ended from the account
   page. The console was exactly
   that until September 2026, and it skipped the account gate as well: an
   owner who had not enrolled two-factor, sent to the account page by
   every page, could still open the stream by its URL.

   So a stream asks this when it opens and again every STREAM_RECHECK_MS
   while it runs, against the database rather than anything it read at
   the start. The answer is a reason rather than a boolean, because the
   person watching is told why the stream stopped. */

/** How often an open stream asks again whether its reader may still read it. */
export const STREAM_RECHECK_MS = 10_000;

export type StreamRefusal =
  /** The session is gone: signed out, ended from the account page, reset, or expired. */
  | "signed-out"
  /** The account has to choose its own password before anything else. */
  | "password"
  /** An owner or admin who has not enrolled two-factor. */
  | "two-factor"
  /** The role does not reach this resource, or no longer does. */
  | "forbidden";

export function streamRefusal(
  user: { id: string; role: Role; twoFactor: boolean; passwordSetAt: Date | null } | null,
  permission: Permission,
  ownerId: string | null | undefined,
): StreamRefusal | null {
  if (!user) return "signed-out";
  // The same door every page and the API ask, in the same order.
  const gate = accountGate(user);
  if (gate) return gate;
  return can(user, permission, ownerId) ? null : "forbidden";
}
