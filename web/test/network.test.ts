import assert from "node:assert/strict";
import { test } from "node:test";
import { SAME_RUN_MS, networkDelta } from "../src/domain/servers/network.ts";
import { POINTS, RANGE_SECONDS, bytesPerSecond, isMetricRange, niceCeil, rangeSpec } from "../src/domain/metrics/ranges.ts";

const T0 = new Date("2026-10-03T10:00:00Z");
const base = (rx: number, tx: number, startedAt: Date | null = T0) => ({ rx, tx, startedAt });

/* The counters Docker keeps are cumulative from the start of a run and begin again at every restart: 5.11 MB, then
   1.17 kB after a restart, measured. The difference between two readings has to know that. */
test("the first reading of a run is no amount, and the next is the difference", () => {
  assert.equal(networkDelta({ rx: null, tx: null, startedAt: null }, { rx: 5_000, tx: 700, startedAt: T0 }), null);
  assert.deepEqual(networkDelta(base(5_000, 700), { rx: 7_500, tx: 900, startedAt: T0 }), { rx: 2_500, tx: 200 });
  assert.deepEqual(networkDelta(base(5_000, 700), { rx: 5_000, tx: 700, startedAt: T0 }), { rx: 0, tx: 0 }, "an idle server");
});

test("a counter that went down is a restart, and the amount is what has gone through since", () => {
  assert.deepEqual(networkDelta(base(5_110_000, 77_700), { rx: 1_170, tx: 126, startedAt: T0 }), { rx: 1_170, tx: 126 });
  // Either direction going down is the run starting again: they are reset together.
  assert.deepEqual(networkDelta(base(5_000, 700), { rx: 9_000, tx: 300, startedAt: T0 }), { rx: 9_000, tx: 300 });
});

test("another start is another run even when the counters have grown past the old ones", () => {
  const restarted = new Date(T0.getTime() + 60_000);
  // A restart, and more than the last reading's worth of traffic since: a plain difference would be too small.
  assert.deepEqual(networkDelta(base(5_000, 700), { rx: 40_000, tx: 4_000, startedAt: restarted }), { rx: 40_000, tx: 4_000 });
  // The same run read with a little jitter in its start is still one run.
  const jitter = new Date(T0.getTime() + SAME_RUN_MS - 1);
  assert.deepEqual(networkDelta(base(5_000, 700), { rx: 6_000, tx: 800, startedAt: jitter }), { rx: 1_000, tx: 100 });
  assert.deepEqual(networkDelta(base(5_000, 700, null), { rx: 6_000, tx: 800, startedAt: restarted }), { rx: 1_000, tx: 100 }, "no start recorded before: only a drop can say");
});

test("what is not a number of bytes is none, and bigint counters from the database are read", () => {
  assert.deepEqual(networkDelta({ rx: BigInt(5_000), tx: BigInt(700), startedAt: T0 }, { rx: 5_300, tx: 710, startedAt: T0 }), { rx: 300, tx: 10 });
  assert.deepEqual(networkDelta(base(5_000, 700), { rx: Number.NaN, tx: -4, startedAt: T0 }), { rx: 0, tx: 0 }, "nothing is a negative or a missing amount");
});

test("every window has at most 120 buckets and none narrower than a sample", () => {
  for (const [range, seconds] of Object.entries(RANGE_SECONDS)) {
    const spec = rangeSpec(range as keyof typeof RANGE_SECONDS);
    assert.equal(spec.seconds, seconds);
    assert.ok(spec.bucketSeconds >= 15, range);
    assert.ok(Math.ceil(seconds / spec.bucketSeconds) <= POINTS, range);
  }
  assert.equal(rangeSpec("1h").bucketSeconds, 30);
  assert.equal(rangeSpec("24h").bucketSeconds, 720);
  assert.equal(rangeSpec("30d").bucketSeconds, 21_600);
  assert.equal(isMetricRange("30d"), true);
  assert.equal(isMetricRange("90d"), false);
  assert.equal(isMetricRange(undefined), false);
});

test("a rate is bytes spread over the bucket, and an axis tops out at a round number", () => {
  assert.equal(bytesPerSecond(30_000, 30), 1_000);
  assert.equal(bytesPerSecond(null, 30), null);
  assert.equal(niceCeil(0), 1);
  assert.equal(niceCeil(0.7), 1);
  assert.equal(niceCeil(1.2), 2);
  assert.equal(niceCeil(3.4), 5);
  assert.equal(niceCeil(5), 5);
  assert.equal(niceCeil(5.1), 10);
  assert.equal(niceCeil(173), 200);
  assert.equal(niceCeil(2_300_000), 5_000_000);
});
