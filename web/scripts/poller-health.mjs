// The poller container's healthcheck: exit 0 when the watchdog has finished a pass within three of its own intervals, 1 when it has not.
//
// Plain node and pg, no tsx and no Prisma: it runs every fifteen seconds inside the container and must cost nothing. The rule is the one
// the panel's pages use (src/domain/watchdog.ts): three intervals is late, and a pass that began and has not ended counts as late once it
// has run that long. A poller that has just started and has not finished a pass yet is healthy for three intervals and a minute, and then not.
//
// The ages are worked out by the database, from the timestamps the poller wrote, against its own clock: the columns are timestamps without
// a zone (Prisma writes them in UTC), which pg reads back as the local time of the machine this runs on, so doing the sum here would be
// out by the time zone's offset, and out by any difference between this clock and the database's besides.
import pg from "pg";

const LATE = 3;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8_000 });
const say = (text) => console.log(text);
const seconds = (ms) => Math.round(ms / 1000);

try {
  await client.connect();
  const { rows } = await client.query(`
    select "intervalMs",
           ("lastPassAt" is null) as never,
           extract(epoch from ((now() at time zone 'UTC') - "lastPassAt")) * 1000 as "ageMs",
           ("passStartedAt" is not null and ("lastPassAt" is null or "passStartedAt" > "lastPassAt")) as busy,
           extract(epoch from ((now() at time zone 'UTC') - "passStartedAt")) * 1000 as "busyMs",
           extract(epoch from ((now() at time zone 'UTC') - "startedAt")) * 1000 as "sinceStartMs"
      from poller_state where id = 1`);
  const row = rows[0];
  if (!row) {
    say("no row yet: the poller has not reported");
    process.exit(1);
  }
  const late = row.intervalMs * LATE;
  if (row.never) {
    const since = Number(row.sinceStartMs);
    const fine = since <= late + 60_000;
    say(fine ? "started, first pass not finished yet" : `started ${seconds(since)} s ago and has not finished a pass`);
    process.exit(fine ? 0 : 1);
  }
  const age = Number(row.ageMs);
  if (age <= late) {
    say(`last pass ${seconds(age)} s ago`);
    process.exit(0);
  }
  if (row.busy && Number(row.busyMs) <= late) {
    say("a pass is running");
    process.exit(0);
  }
  say(`last pass ${seconds(age)} s ago, more than ${LATE} intervals of ${row.intervalMs / 1000} s`);
  process.exit(1);
} catch (error) {
  say(`cannot tell: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
