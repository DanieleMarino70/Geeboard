import { onUnexpected } from "@/domain/errors";
import { currentRequestId, logger, newRequestId } from "./log";

/* The line an unexpected error leaves, and the reference that finds it.

   domain/errors.ts calls this whenever it turns something nobody foresaw (a Prisma error, a TypeError, a decrypt that threw) into the
   generic sentence. The reference in that sentence is the request's id when there is one, so that the toast, the audit row and the log are
   one string to grep; a server action or a script that has none gets a new one. The cause and the first lines of its stack are here and
   nowhere a person is shown. Imported by lib/db.ts, which everything that makes such an error already imports, so no process that reads the
   database is without it. */
onUnexpected((error, context) => {
  const reference = currentRequestId() ?? newRequestId();
  const cause = error instanceof Error ? error : new Error(typeof error === "string" ? error : "a value that is not an error was thrown");
  logger.error("unexpected error", {
    reference,
    ...(context ? { context } : {}),
    type: cause.name,
    detail: cause.message,
    stack: cause.stack
      ?.split("\n")
      .slice(1, 7)
      .map((line) => line.trim())
      .join(" | "),
  });
  return reference;
});
