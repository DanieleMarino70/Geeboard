import { readdirSync } from "node:fs";
import path from "node:path";

/* Whether the database is at the schema this release was built for.

   A release brings its own migrations, and `panel migrate` applies them. What
   nothing checked was the other half: that they had been. A panel started on a
   database a release behind found out at the first query that touched a new
   column, and said "something went wrong, trying again usually works"; a
   database a release *ahead* — migrated by a newer image, then rolled back to
   the old one by pointing at the old tag — was worse, because the old code
   reads the new schema without complaint until the day it writes.

   So the migration names this image carries are compared with the ones the
   database says it applied, and the answer is one sentence and the command
   that fixes it. Pure here, so the arithmetic is tested without a database; the
   readers are at the bottom, and the callers are the panel and the poller at
   start, and the layout, which asks again every half minute. */

export interface AppliedMigration {
  name: string;
  /** Prisma writes the row when it starts; `finished` is its finished_at. */
  finished: boolean;
  rolledBack: boolean;
}

export type SchemaVerdict =
  | { ok: true }
  /* This image has migrations the database has not applied. */
  | { ok: false; kind: "behind"; pending: string[]; latestApplied: string | null }
  /* The database applied migrations this image does not have. */
  | { ok: false; kind: "ahead"; unknown: string[] }
  /* A migration started and did not finish, and was not marked resolved. */
  | { ok: false; kind: "failed"; failed: string[] };

export function judgeSchema(known: string[], applied: AppliedMigration[]): SchemaVerdict {
  const failed = applied.filter((m) => !m.finished && !m.rolledBack).map((m) => m.name);
  if (failed.length > 0) return { ok: false, kind: "failed", failed };

  const done = new Set(applied.filter((m) => m.finished && !m.rolledBack).map((m) => m.name));
  const unknown = [...done].filter((name) => !known.includes(name)).sort();
  if (unknown.length > 0) return { ok: false, kind: "ahead", unknown };

  const pending = known.filter((name) => !done.has(name)).sort();
  if (pending.length > 0) {
    const latest = [...done].sort().pop() ?? null;
    return { ok: false, kind: "behind", pending, latestApplied: latest };
  }
  return { ok: true };
}

/* The command that applies a release's migrations, spelled for where this runs:
   a verb of the image in a container, an npm script in a checkout. */
export function migrateCommand(inImage: boolean): string {
  return inImage ? "docker compose -f deploy/panel/docker-compose.yml run --rm panel migrate" : "npm run db:deploy";
}

export function resolveCommand(inImage: boolean, name: string): string {
  return inImage
    ? `docker compose -f deploy/panel/docker-compose.yml run --rm panel resolve --rolled-back ${name}`
    : `npx prisma migrate resolve --rolled-back ${name}`;
}

/** What to say, in one sentence and the one thing to do. */
export function describeSchema(verdict: Exclude<SchemaVerdict, { ok: true }>, release: string, inImage: boolean): { line: string; fix: string } {
  switch (verdict.kind) {
    case "behind": {
      const n = verdict.pending.length;
      return {
        line: `The database is a release behind this one: ${verdict.latestApplied ? `its last migration is ${verdict.latestApplied}, and` : "it has none applied, and"} Geeboard ${release} needs ${n} more (first: ${verdict.pending[0]}).`,
        fix: `Apply them: ${migrateCommand(inImage)}`,
      };
    }
    case "ahead":
      return {
        line: `The database has ${verdict.unknown.length === 1 ? "a migration" : `${verdict.unknown.length} migrations`} this release does not know (${verdict.unknown.slice(0, 3).join(", ")}${verdict.unknown.length > 3 ? ", …" : ""}): it was migrated by a newer Geeboard than ${release}.`,
        fix: "Run the newer release again, or restore the dump taken before that upgrade (docs/upgrading.md, 'Undoing an upgrade'); an older panel on a newer schema is not something to run.",
      };
    case "failed":
      return {
        line: `A migration did not finish: ${verdict.failed.join(", ")}. The database may be partly changed.`,
        fix: `Read what Prisma said when it failed and put the cause right. Then tell it the migration will run again: ${resolveCommand(inImage, verdict.failed[0]!)} — and apply: ${migrateCommand(inImage)}. Or restore the dump taken before the upgrade (docs/upgrading.md, "Undoing an upgrade").`,
      };
  }
}

/* ── Reading ──────────────────────────────────────────────────────── */

/** The migrations this image carries: the directories under prisma/migrations. Null when the directory is not there to read. */
export function knownMigrations(root: string = process.cwd()): string[] | null {
  try {
    return readdirSync(path.join(root, "prisma", "migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return null;
  }
}

export interface SchemaQuery {
  $queryRawUnsafe<T>(query: string): Promise<T>;
}

/* What the database says it applied. A database with no `_prisma_migrations`
   table has never been migrated, which is "behind" by every migration. */
export async function appliedMigrations(client: SchemaQuery): Promise<AppliedMigration[] | "unreadable"> {
  try {
    const rows = await client.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>(
      `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`,
    );
    return rows.map((r) => ({ name: r.migration_name, finished: r.finished_at !== null, rolledBack: r.rolled_back_at !== null }));
  } catch (error) {
    // A missing table is a database nobody has migrated; anything else (down, refused) says nothing about the schema.
    return /_prisma_migrations/.test(String(error)) && /does not exist/i.test(String(error)) ? [] : "unreadable";
  }
}

/* The verdict for this process, or "unknown" when it could not be reached or
   the migrations directory is not here: neither is evidence of a mismatch,
   and a check that blocks a panel for want of a directory is worse than none. */
export async function checkSchema(client: SchemaQuery, root?: string): Promise<SchemaVerdict | "unknown"> {
  const known = knownMigrations(root);
  if (!known || known.length === 0) return "unknown";
  const applied = await appliedMigrations(client);
  if (applied === "unreadable") return "unknown";
  return judgeSchema(known, applied);
}
