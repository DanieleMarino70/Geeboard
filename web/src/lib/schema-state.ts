import "server-only";
import { db } from "./db";
import { checkSchema, describeSchema } from "./schema-check";
import { PANEL_VERSION } from "./version";

/* What the layout asks before it draws a page: is the database at the schema
   this panel was built for. See schema-check.ts for why.

   Every half minute rather than every request — a query on a table of a few
   dozen rows is nothing, but it is not nothing times every page and every
   refresh — and not at all outside production, where a developer is migrating
   by hand and the panel they are looking at is meant to carry on. The answer
   "could not tell" (the database down, the migrations directory not there) is
   no problem: a panel that blocks itself for want of a file is worse than none. */
const FRESH_MS = 30_000;
let last: { at: number; problem: { line: string; fix: string } | null } | null = null;

export async function schemaProblem(): Promise<{ line: string; fix: string } | null> {
  if (process.env.NODE_ENV !== "production") return null;
  const now = Date.now();
  if (last && now - last.at < FRESH_MS) return last.problem;

  let problem: { line: string; fix: string } | null = null;
  try {
    const verdict = await checkSchema(db);
    if (verdict !== "unknown" && !verdict.ok) {
      problem = describeSchema(verdict, PANEL_VERSION, process.env.GEEBOARD_IN_IMAGE === "1");
    }
  } catch {
    problem = null;
  }
  last = { at: now, problem };
  return problem;
}
