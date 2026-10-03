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
