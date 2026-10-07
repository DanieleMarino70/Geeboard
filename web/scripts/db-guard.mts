/* Which database a command is about to touch, and whether it may.

   Two kinds of script wipe the database in DATABASE_URL: the verify scripts,
   which reseed the one they are given, and the destructive prisma commands
   behind `db:reset` and `db:seed`. The file `.env` that a developer's checkout
   carries names the database a demo is running on, and "a variable already
   set wins over the file" is the only thing that points a run elsewhere. On
   2026-09-20 `npm run verify` from the wrong directory replaced the live demo
   with the sample workspace. This is what stands in the way now.

   Pure, so that a test can hold it: the scripts that use it are in
   load-env.mts and guard-db.mts. */

export interface DatabaseTarget {
  name: string;
  /** host, and port when there is one: enough to tell two machines' databases apart, no credentials. */
  where: string;
}

export function databaseOf(url: string | undefined): DatabaseTarget | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return {
      name: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
      where: parsed.hostname + (parsed.port ? `:${parsed.port}` : ""),
    };
  } catch {
    return null;
  }
}

/** A database made for being wiped says so in its name: `geeboard_verify`, `geeboard_verify_setup`. */
export function isVerifyDatabase(name: string): boolean {
  return /verify/i.test(name);
}

/* The sentence a verify script is refused with, or null when it may run.
   No URL is no refusal: the script has nothing to wipe and says what is
   missing itself. */
export function refuseVerify(script: string, url: string | undefined, anyDatabase: boolean): string | null {
  if (anyDatabase) return null;
  const target = databaseOf(url);
  if (!target || isVerifyDatabase(target.name)) return null;
  return (
    `refusing: ${script} reseeds the database it is given, and "${target.name}" on ${target.where} is not named for verification. ` +
    `Point DATABASE_URL at a database whose name contains "verify" (see docs/development.md), ` +
    `or set GEEBOARD_VERIFY_ANY_DB=1 if you mean to wipe this one.`
  );
}

/* What a destructive prisma command is allowed to do to this database:
   "run" for one made for it, "confirm" for any other. A confirmation is the
   database's own name, typed or given in GEEBOARD_CONFIRM_DB, so that
   agreeing means having read which one it is. */
export type Verdict = { verdict: "run" } | { verdict: "confirm"; target: DatabaseTarget };

export function judgeDestructive(url: string | undefined): Verdict {
  const target = databaseOf(url);
  if (!target || isVerifyDatabase(target.name)) return { verdict: "run" };
  return { verdict: "confirm", target };
}
