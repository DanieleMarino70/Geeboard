/* Which unique index a write lost on.

   Prisma reports a violated unique index as P2002, and where it says which
   one depends on how it talks to Postgres. Through the pg driver adapter
   this panel uses, `meta.target` is absent and the name is in
   `meta.driverAdapterError.cause.constraint`; the message carries it too, in
   words. Code that has to tell a lost port from a lost address from a lost
   name — a port is worth trying again, the others are not — asks here rather
   than reading `meta.target`, which read as empty and made every lost race
   look like the same "just taken".

   Duck-typed, so nothing here imports Prisma and a test can hand it the
   shapes the errors really have. */

export function uniqueViolation(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { code?: unknown; message?: unknown; meta?: Record<string, unknown> };
  if (e.code !== "P2002") return null;

  const parts: string[] = [];
  const target = e.meta?.target;
  if (Array.isArray(target)) parts.push(...target.map(String));
  else if (typeof target === "string") parts.push(target);

  const cause = (e.meta?.driverAdapterError as { cause?: { constraint?: { index?: unknown; fields?: unknown } } } | undefined)?.cause;
  const constraint = cause?.constraint;
  if (typeof constraint?.index === "string") parts.push(constraint.index);
  if (Array.isArray(constraint?.fields)) parts.push(...constraint.fields.map(String));

  if (typeof e.message === "string") {
    const named = /constraint: `([^`]+)`/.exec(e.message) ?? /fields: \(([^)]+)\)/.exec(e.message);
    if (named) parts.push(named[1]!);
  }
  // A P2002 that says nothing of which index is still a unique violation: an empty name, not null.
  return parts.join(" ");
}
