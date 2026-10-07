import { checkEnvironment } from "@/lib/env-check";

/* What the panel needs before it takes a request — see lib/env-check.ts.

   A production panel with a missing, short or example secret does not
   start: it says what is wrong and exits, rather than coming up and
   failing at the first sign-in — or worse, not failing, and signing
   sessions with a secret printed in a public repository. In development
   the same problems are printed and the server carries on, because a
   half-configured checkout should still show its pages. */
const { problems, warnings } = checkEnvironment(process.env);
for (const warning of warnings) console.warn(`geeboard: ${warning}`);

if (problems.length > 0) {
  for (const problem of problems) console.error(`geeboard: ${problem}`);
  if (process.env.NODE_ENV === "production") {
    console.error("geeboard: refusing to start. `npm run setup:env` writes a .env with generated secrets.");
    process.exit(1);
  }
}

/* A database that is not at this release's schema — a release behind because
   nobody ran `migrate`, or ahead because a newer image migrated it and an older
   one was started on it — is not a panel that will fail at a predictable place.
   It fails at the first query that touches what changed, with a page that says
   "trying again usually works". So in production the panel says what is wrong, and
   what to run, and does not start; the layout asks again every half minute for
   the case that the schema moves under a running panel. In development the
   developer is migrating by hand and the panel carries on. */
if (process.env.NODE_ENV === "production") {
  const { db } = await import("@/lib/db");
  const { checkSchema, describeSchema } = await import("@/lib/schema-check");
  const { PANEL_VERSION } = await import("@/lib/version");
  const verdict = await checkSchema(db);
  if (verdict !== "unknown" && !verdict.ok) {
    const { line, fix } = describeSchema(verdict, PANEL_VERSION, process.env.GEEBOARD_IN_IMAGE === "1");
    console.error(`geeboard: ${line}`);
    console.error(`geeboard: refusing to start. ${fix}`);
    process.exit(1);
  }
}

/* Does the key this process has open what the database holds? A restored dump beside another key, an edited .env, a `rekey` finished without
   the new value swapped in: the pages that open a node's token, a bucket's key or a two-factor secret then fail one at a time, in OpenSSL's
   words. Said once, here, with what to do. A database that is not there is the schema check's to report. */
try {
  const { checkSealedSecrets } = await import("@/lib/sealed-check");
  const { describeSealed } = await import("@/domain/sealed");
  const line = describeSealed(await checkSealedSecrets());
  if (line) console.error(`geeboard: ${line}. Put the previous SECRETS_KEY back in deploy/panel/.env and restart; if you were changing the key, finish with rekey (docs/security.md).`);
} catch {
  // Not at the schema yet, or the database is not answering: the first page says so.
}

/* An update, a restore or a backup that this panel was running when it was stopped is not being run by anybody now. Said once, before the first
   request: the server is given back (a backup's server goes back to what it was; anything else is in ERROR with a sentence, which is where the
   page offers a rebuild) and the audit log says so. See lib/operations.ts. A database that is not there is the schema check's to report. */
try {
  const { reapInterrupted } = await import("@/lib/operations");
  for (const one of await reapInterrupted({ afterStartOf: "panel" })) console.warn(`geeboard: ${one.slug}: ${one.sentence}`);
} catch {
  // Not at the schema yet, or the database is not answering: the first page says so.
}

/* The games an owner approved from a manifest are in the database, and the
   registry that every page and action asks for a game is in this process's
   memory (domain/games/registry.ts). So they are read once, before the first
   request, and again whenever the approve and retire operations change them in
   this process — and every few seconds, which is how a change made by another
   process (the poller, a script) arrives. Cheap: one query, and nothing is
   checked again unless a revision changed. A failure is logged and the panel
   starts anyway: a database that is not migrated yet is a panel that shows its
   own message, and the games Geeboard ships do not depend on any of this. */
const COMMUNITY_POLL_MS = 10_000;
const polling = globalThis as unknown as { __geeboardCommunityPoll?: boolean };

async function loadCommunityGames() {
  try {
    const { refreshCommunityGames } = await import("@/lib/community-games");
    const report = await refreshCommunityGames();
    if (report.changed) console.warn(`geeboard: ${report.active.length} community game${report.active.length === 1 ? "" : "s"} loaded${report.retired.length > 0 ? `, ${report.retired.length} retired` : ""}`);
  } catch (error) {
    console.error(`geeboard: community games were not loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (!polling.__geeboardCommunityPoll) {
  polling.__geeboardCommunityPoll = true;
  await loadCommunityGames();
  setInterval(() => void loadCommunityGames(), COMMUNITY_POLL_MS).unref();
}
