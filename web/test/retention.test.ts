import assert from "node:assert/strict";
import { test } from "node:test";
import { FAILED_KEPT_DAYS, planRetention, type RetentionRow } from "../src/lib/retention";

const NOW = new Date("2026-10-07T03:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const daysAgo = (d: number) => hoursAgo(d * 24);
const row = (id: string, state: RetentionRow["state"], createdAt: Date): RetentionRow => ({ id, state, createdAt });
const ids = (rows: RetentionRow[]) => rows.map((r) => r.id).sort();

test("seven days of failed backups do not push the good ones out", () => {
  // The case that lost data: five good backups, then a week of failures, keep 7.
  const rows = [
    ...[8, 9, 10, 11, 12].map((d) => row(`good-${d}`, "COMPLETE", daysAgo(d))),
    ...[1, 2, 3, 4, 5, 6, 7].map((d) => row(`failed-${d}`, "FAILED", daysAgo(d - 0.5))),
  ];
  const plan = planRetention(rows, 7, NOW);
  assert.deepEqual(ids(plan.surplus), [], "all five good backups are within the seven the policy keeps");
});

test("only the newest `keep` complete backups stay, counting nothing else", () => {
  const rows = [
    row("c1", "COMPLETE", hoursAgo(1)),
    row("f1", "FAILED", hoursAgo(2)),
    row("c2", "COMPLETE", hoursAgo(3)),
    row("r1", "RUNNING", hoursAgo(4)),
    row("c3", "COMPLETE", hoursAgo(5)),
    row("c4", "COMPLETE", hoursAgo(6)),
    row("l1", "LOCKED", hoursAgo(7)),
  ];
  const plan = planRetention(rows, 2, NOW);
  assert.deepEqual(ids(plan.surplus), ["c3", "c4"]);
  assert.deepEqual(ids(plan.stale), [], "failed yesterday is still evidence");
});

test("the newest complete backup is never in the surplus while keep is at least one", () => {
  const rows = [row("only", "COMPLETE", daysAgo(30)), row("f", "FAILED", hoursAgo(1))];
  assert.deepEqual(planRetention(rows, 1, NOW).surplus, []);
});

test("a failed row goes by age, and a running or locked one never goes", () => {
  const rows = [
    row("old-failed", "FAILED", daysAgo(FAILED_KEPT_DAYS + 1)),
    row("fresh-failed", "FAILED", daysAgo(FAILED_KEPT_DAYS - 1)),
    row("old-running", "RUNNING", daysAgo(30)),
    row("old-locked", "LOCKED", daysAgo(30)),
  ];
  const plan = planRetention(rows, 3, NOW);
  assert.deepEqual(ids(plan.stale), ["old-failed"]);
  assert.deepEqual(plan.surplus, []);
});

test("keep zero is the explicit sweep, and removes every complete backup but nothing else", () => {
  const rows = [row("c1", "COMPLETE", hoursAgo(1)), row("c2", "COMPLETE", hoursAgo(2)), row("l", "LOCKED", hoursAgo(3)), row("r", "RUNNING", hoursAgo(1))];
  assert.deepEqual(ids(planRetention(rows, 0, NOW).surplus), ["c1", "c2"]);
});

test("a count that is not a count removes nothing", () => {
  const rows = [row("c1", "COMPLETE", hoursAgo(1)), row("c2", "COMPLETE", hoursAgo(2))];
  assert.deepEqual(planRetention(rows, -3, NOW).surplus, [], "never a slice from the end");
  assert.deepEqual(planRetention(rows, Number.NaN, NOW).surplus, []);
  assert.deepEqual(ids(planRetention(rows, 1.9, NOW).surplus), ["c2"], "a fraction is rounded down, so it keeps one");
});
