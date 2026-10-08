/* Whether an error is the database not answering, as opposed to something being wrong with what was asked of it.

   A database that is stopped, restarting, out of connections or unreachable is not the panel's bug and not the caller's mistake, and it passes: the
   same request a minute later works. It used to be said as "Something went wrong on our side (reference …)", 500, the same as a fault in the code,
   so a client that retries on a 5xx it understands (503, Retry-After) had no way to know, and a person reading the page was sent to the log for a
   thing the log would say in one line. Seen on a real machine with the database container paused for three minutes: every page and every API call
   answered 500 after five seconds.

   Duck-typed, and Postgres' own: the codes Prisma and Postgres give, and the words the pg client uses. A connection that is refused or reset is only
   called this when it says where it was going (Postgres' port or its name): a bare ECONNREFUSED is as likely to be a node as the database, and a
   node has its own sentence. Pure; walks the chain of causes. */

const CODES = new Set([
  // Prisma: cannot reach the server, timed out, the server closed the connection.
  "P1001", "P1002", "P1008", "P1017",
  // Postgres: an administrator's shutdown, a crash, the cluster starting up, connection failures, too many connections.
  "57P01", "57P02", "57P03", "08000", "08001", "08003", "08006", "53300",
]);

const WORDS = /connection terminated|timeout exceeded when trying to connect|can't reach database server|terminating connection|database system is (?:starting up|shutting down|in recovery mode)|server closed the connection unexpectedly|remaining connection slots are reserved|too many clients already/i;
const PLACE = /:5432\b|postgres|\bdb\b/i; // `db` is what the compose file calls it
const NETWORK = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN"]);

export function databaseAway(error: unknown, depth = 0): boolean {
  if (depth > 6 || typeof error !== "object" || error === null) return false;
  const { code, message, cause, errors } = error as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
  if (typeof code === "string" && CODES.has(code)) return true;
  const text = typeof message === "string" ? message : "";
  if (WORDS.test(text)) return true;
  if (typeof code === "string" && NETWORK.has(code) && PLACE.test(text)) return true;
  if (Array.isArray(errors) && errors.some((one) => databaseAway(one, depth + 1))) return true;
  return databaseAway(cause, depth + 1);
}
