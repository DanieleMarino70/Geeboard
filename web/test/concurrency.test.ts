import assert from "node:assert/strict";
import { test } from "node:test";
import { gate, mapPool, withDeadline } from "../src/domain/concurrency.ts";
import { STAGGER_MINUTES, nightlyBackupCron, staggerMinute, worldSizeJitterMs, WORLD_SIZE_SPREAD_MS } from "../src/domain/servers/stagger.ts";

/* The shapes the poller walks its nodes and servers with, and the minute a server's nightly backup falls on. */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("mapPool never has more than its limit in flight, and says how each ended", async () => {
  let now = 0;
  let peak = 0;
  const results = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    now++;
    peak = Math.max(peak, now);
    await sleep(5);
    now--;
    if (n === 4) throw new Error("four fell over");
    return n * 10;
  });
  assert.equal(peak, 3);
  assert.deepEqual(
    results.map((r) => (r.status === "fulfilled" ? r.value : (r.reason as Error).message)),
    [10, 20, 30, "four fell over", 50, 60, 70],
  );
});

test("mapPool of nothing is nothing, and a limit of zero still runs the work", async () => {
  assert.deepEqual(await mapPool([], 4, async () => 1), []);
  const done = await mapPool(["a"], 0, async (x) => x);
  assert.deepEqual(done, [{ status: "fulfilled", value: "a" }]);
});

test("a slow item holds its lane and not the others", async () => {
  // One is held until the last of the others is done: the order is the test's, and no clock has a say in it.
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished: number[] = [];
  await mapPool([1, 2, 3, 4], 2, async (n) => {
    if (n === 1) await held;
    finished.push(n);
    if (n === 4) release();
  });
  // Two, three and four go through the other lane while one waits.
  assert.deepEqual(finished, [2, 3, 4, 1]);
});

test("a gate is shared: work from different callers waits for the same turns", async () => {
  const through = gate(2);
  let now = 0;
  let peak = 0;
  const one = async () => {
    now++;
    peak = Math.max(peak, now);
    await sleep(5);
    now--;
  };
  await Promise.all(Array.from({ length: 9 }, () => through(one)));
  assert.equal(peak, 2);
  // A throw gives the place back.
  await assert.rejects(through(async () => Promise.reject(new Error("no"))));
  assert.equal(await through(async () => "still works"), "still works");
});

test("withDeadline answers late without waiting for the work", async () => {
  const slow = sleep(200).then(() => "done");
  const started = Date.now();
  assert.equal(await withDeadline(slow, 10, () => "late"), "late");
  assert.ok(Date.now() - started < 150);
  assert.equal(await withDeadline(Promise.resolve("quick"), 50, () => "late"), "quick");
  // A rejection is the work's own and comes through.
  await assert.rejects(withDeadline(Promise.reject(new Error("broke")), 50, () => "late"), /broke/);
});

test("a server's nightly backup minute is the same every time and falls between 03:00 and 03:45", () => {
  const ids = Array.from({ length: 400 }, (_, i) => `srv_${(i * 7919).toString(36)}${i}`);
  for (const id of ids) {
    const minute = staggerMinute(id);
    assert.ok(Number.isInteger(minute) && minute >= 0 && minute < STAGGER_MINUTES);
    assert.equal(staggerMinute(id), minute);
    assert.equal(nightlyBackupCron(id), `${minute} 3 * * *`);
  }
  // Spread, not piled: most of the 46 minutes are used by 400 ids, and none takes more than a few times its share.
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(staggerMinute(id), (counts.get(staggerMinute(id)) ?? 0) + 1);
  assert.ok(counts.size >= 40, `only ${counts.size} minutes used`);
  assert.ok(Math.max(...counts.values()) <= (400 / STAGGER_MINUTES) * 3);
});

test("the world-size jitter is stable per server and within its spread", () => {
  for (const id of ["a", "b", "c1", "a-long-server-id-0000"]) {
    const jitter = worldSizeJitterMs(id);
    assert.ok(jitter >= 0 && jitter < WORLD_SIZE_SPREAD_MS);
    assert.equal(worldSizeJitterMs(id), jitter);
  }
  assert.notEqual(worldSizeJitterMs("a"), worldSizeJitterMs("b"));
});
