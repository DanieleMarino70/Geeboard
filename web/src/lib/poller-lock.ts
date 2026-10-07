import pg from "pg";

/* One poller per database, enforced.

   The poller is one loop in one process on purpose (scripts/poller.mts says why), and the limit was declared in six places and
   enforced by nothing: `docker compose up -d --scale poller=2`, a `poll:once` from a cron that overlapped a long pass, or a stopped
   background task that left a node process behind, each made two of them, and two of them send every notification twice, run every
   scheduled backup at once, count a crash twice, and write two DNS records at a name, after which the panel refuses that name.

   A Postgres advisory lock, taken at start on a connection of its own: a session lock lives on its connection, so the poller's pool,
   which recycles, would lose it. It is released when the process dies, which is what a restart policy wants, and when the connection
   ends (the database restarting) the poller must go too, so that whatever supervises it starts it again and it takes the lock again. */

export const POLLER_LOCK_NAME = "geeboard-poller";

/** Another poller holds the lock. */
export class PollerLockHeld extends Error {}

export interface PollerLock {
  release(): Promise<void>;
}

export async function acquirePollerLock(connectionString: string, onLost: (why: string) => void): Promise<PollerLock> {
  const client = new pg.Client({ connectionString, keepAlive: true, connectionTimeoutMillis: 10_000 });
  await client.connect();

  let released = false;
  const lost = (why: string) => {
    if (!released) onLost(why);
  };
  client.on("error", (error) => lost(`the connection that holds the poller's lock failed: ${error.message}`));
  client.on("end", () => lost("the connection that holds the poller's lock ended"));

  let held: boolean;
  try {
    const result = await client.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtext($1)) as ok", [POLLER_LOCK_NAME]);
    held = result.rows[0]?.ok === true;
  } catch (error) {
    released = true;
    await client.end().catch(() => {});
    throw error;
  }
  if (!held) {
    released = true;
    await client.end().catch(() => {});
    throw new PollerLockHeld(
      "another poller is already running against this database. Two of them send every notification twice and run every scheduled backup " +
        "at the same moment, so this one will not: stop the other (docker compose ps shows it), or leave this one stopped.",
    );
  }

  return {
    release: async () => {
      released = true;
      await client.end().catch(() => {});
    },
  };
}
