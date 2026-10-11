import assert from "node:assert/strict";
import { test } from "node:test";
import { nextRuns } from "../src/lib/cron.ts";
import { slotFirings, utcClock } from "../src/lib/timeline.ts";

const from = new Date("2026-10-11T22:14:00Z");
const day = (cron: string, name: string) =>
  nextRuns(cron, 24 * 60, from)
    .filter((at) => at.getTime() <= from.getTime() + 24 * 3600_000)
    .map((at) => ({ at, name }));

test("a task every thirty minutes is forty-eight runs, all of them counted, in one mark a slot", () => {
  const runs = day("*/30 * * * *", "reminder");
  assert.equal(runs.length, 48);
  for (const count of [8, 12, 24]) {
    const slots = slotFirings(runs, from, 24, count);
    assert.equal(slots.length, count, `${count} slots, every one with runs in it`);
    assert.equal(slots.reduce((n, s) => n + s.firings.length, 0), 48, "no run is lost between slots");
    assert.deepEqual(slots.map((s) => s.index), Array.from({ length: count }, (_, i) => i));
  }
});

test("a nightly task is one slot, the one its hour falls in", () => {
  const slots = slotFirings(day("0 3 * * *", "backup"), from, 24, 8);
  assert.equal(slots.length, 1);
  // 03:00 is 4 h 46 m after 22:14: the second three-hour slot.
  assert.equal(slots[0].index, 1);
  assert.equal(utcClock(slots[0].start), "01:14");
  assert.equal(utcClock(slots[0].end), "04:14");
});

test("runs in a slot are in order, whatever order they came in", () => {
  const a = { at: new Date("2026-10-11T23:00:00Z"), name: "a" };
  const b = { at: new Date("2026-10-11T22:30:00Z"), name: "b" };
  const [slot] = slotFirings([a, b], from, 24, 8);
  assert.deepEqual(slot.firings.map((f) => f.name), ["b", "a"]);
});

test("a run at the very end of the window is in the last slot, and one outside it is in none", () => {
  const end = { at: new Date(from.getTime() + 24 * 3600_000), name: "end" };
  const before = { at: new Date(from.getTime() - 60_000), name: "before" };
  const after = { at: new Date(from.getTime() + 24 * 3600_000 + 60_000), name: "after" };
  const slots = slotFirings([end, before, after], from, 24, 12);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].index, 11);
  assert.deepEqual(slots[0].firings.map((f) => f.name), ["end"]);
});
