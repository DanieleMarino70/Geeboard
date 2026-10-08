/* Every check `npm run verify` and `npm run verify:all` run, by name and in order.

   It used to be two chains of `&&` in package.json, which stop at the first
   failure — two scripts failed for three pushes, one behind the other, because
   the first hid the second — and which nothing kept complete: a new verify
   script was in the chain only if somebody remembered. test/verify-registry
   fails when a `verify:*` entry of package.json is in no group below, or a
   name below is not a script. */

/* Needs nothing but Postgres. CI runs these. The schema is applied first by
   the caller (`npm run db:deploy`); every script then reseeds the database. */
export const DB_GROUP = [
  "test:unit",
  "verify:cron",
  "verify:ops",
  "verify:authorize",
  "verify:schedule",
  "verify:settings",
  "verify:members",
  "verify:apikeys",
  "verify:hardening",
  "verify:catalog",
  "verify:api",
  "verify:setup",
  "verify:versions",
  "verify:dns",
  "verify:hosts",
  "verify:upgrade",
  "verify:rekey",
  "verify:storage",
  "verify:notify",
  "verify:templates",
  "verify:community",
  "verify:watchdog",
  "verify:operations",
  "verify:pollscale",
  "verify:forget",
  "verify:updatecheck",
  "verify:firsthour",
  "verify:extension",
] as const;

/* Each starts an agent against a real Docker engine, pulls game images or
   binds host ports: a machine with Docker and the demo's ports free. */
export const DOCKER_GROUP = [
  "verify:agent",
  "verify:registration",
  "verify:console",
  "verify:terminal",
  "verify:poller",
  "verify:files",
  "verify:create",
  "verify:pull",
  "verify:mods",
  "verify:backups",
] as const;

/* Each needs a browser on the machine (GEEBOARD_CHROME, or Chrome, Edge or Chromium where they are usually found) and the verification
   database; one with no browser says so and checks nothing. Run by `verify:all`, not by `verify`: CI has no browser. */
export const BROWSER_GROUP = ["verify:a11y"] as const;

/** The entry points themselves: in no group, because they are the groups. */
export const ENTRY_POINTS = ["verify", "verify:all"] as const;
