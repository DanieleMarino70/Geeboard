import assert from "node:assert/strict";
import { test } from "node:test";
import { LATE_AFTER_INTERVALS, judgeWatchdog, watchdogFix, type WatchdogRow } from "../src/domain/watchdog.ts";

/* What the pages and the container say about the watchdog, and when: "last pass 6 s ago", a warning past three of the poller's own
   intervals, and a different warning for a pass that began and has not ended (something in it is slow: scheduled tasks run beside it). */

const NOW = Date.parse("2026-10-07T10:00:00Z");
const ago = (ms: number) => new Date(NOW - ms);
const INTERVAL = 15_000;

const row = (over: Partial<WatchdogRow> = {}): WatchdogRow => ({
  startedAt: ago(3_600_000),
  lastPassAt: ago(6_000),
  lastPassMs: 1_200,
  passStartedAt: ago(7_200),
  intervalMs: INTERVAL,
  version: "0.9.0",
  ...over,
});

test("a poller that has never reported is waiting, not broken", () => {
  const view = judgeWatchdog(null, NOW, "0.9.0", true);
  assert.equal(view.state, "waiting");
  assert.equal(view.fix, null);
});

test("a recent pass is said as how long ago it was, in the poller's own words", () => {
  const view = judgeWatchdog(row(), NOW, "0.9.0", true);
  assert.equal(view.state, "ok");
  assert.equal(view.line, "Watchdog: last pass 6 s ago.");
  assert.equal(view.fix, null);
});

test("late is more than three intervals, judged against the interval the poller was told", () => {
  assert.equal(LATE_AFTER_INTERVALS, 3);
  const edge = judgeWatchdog(row({ lastPassAt: ago(INTERVAL * 3), passStartedAt: ago(INTERVAL * 3 + 1_000) }), NOW, "0.9.0", true);
  assert.equal(edge.state, "ok", "exactly three intervals is not yet late");
  const late = judgeWatchdog(row({ lastPassAt: ago(INTERVAL * 3 + 1_000), passStartedAt: ago(INTERVAL * 3 + 2_000) }), NOW, "0.9.0", true);
  assert.equal(late.state, "late");
  assert.match(late.line, /Servers are not being watched, nothing restarts and no backup runs/);
  // Another interval, another threshold: a poller told to pass every minute is not late at a minute and a half.
  assert.equal(judgeWatchdog(row({ intervalMs: 60_000, lastPassAt: ago(90_000), passStartedAt: ago(91_000) }), NOW, "0.9.0", true).state, "ok");
});

test("a dead poller says how to find out why, in the form that fits where the panel runs", () => {
  const dead = row({ lastPassAt: ago(10 * 60_000), passStartedAt: ago(10 * 60_000 + 1_000) });
  const inImage = judgeWatchdog(dead, NOW, "0.9.0", true);
  assert.equal(inImage.state, "late");
  assert.match(inImage.line, /last pass 10 min ago/);
  assert.match(inImage.fix ?? "", /docker compose -f deploy\/panel\/docker-compose\.yml ps/);
  assert.match(inImage.fix ?? "", /logs poller/);
  assert.match(judgeWatchdog(dead, NOW, "0.9.0", false).fix ?? "", /npm run poll/);
  assert.equal(watchdogFix(true), inImage.fix);
});

test("a pass that began and has not ended is told apart from a poller that is gone", () => {
  // A pass that goes on and on is slow and not dead: late, but there is nothing to restart.
  const busy = judgeWatchdog(row({ lastPassAt: ago(9 * 60_000), passStartedAt: ago(8 * 60_000) }), NOW, "0.9.0", true);
  assert.equal(busy.state, "late");
  assert.match(busy.line, /a pass has been running for 8 min/);
  assert.match(busy.line, /Something in it is slow/);
  assert.equal(busy.fix, null, "there is nothing to restart");
  // And one that began a moment ago is simply a pass in progress.
  const running = judgeWatchdog(row({ lastPassAt: ago(50_000), passStartedAt: ago(5_000) }), NOW, "0.9.0", true);
  assert.equal(running.state, "ok");
  assert.match(running.line, /a pass is running/);
});

test("a poller that started and has not finished a pass is given time, then not", () => {
  const fresh = judgeWatchdog(row({ lastPassAt: null, passStartedAt: ago(10_000), startedAt: ago(20_000) }), NOW, "0.9.0", true);
  assert.equal(fresh.state, "waiting");
  const stuck = judgeWatchdog(row({ lastPassAt: null, passStartedAt: ago(5 * 60_000), startedAt: ago(5 * 60_000 + 1_000) }), NOW, "0.9.0", true);
  assert.equal(stuck.state, "late");
  assert.match(stuck.line, /has not finished a pass/);
});

test("a poller and a panel of different releases say so, once they both know what they are", () => {
  const view = judgeWatchdog(row({ version: "0.8.1" }), NOW, "0.9.0", true);
  assert.equal(view.versionMismatch, true);
  assert.match(view.line, /The poller is 0\.8\.1 and this panel is 0\.9\.0/);
  assert.equal(view.state, "ok", "a mismatch is not lateness");
  assert.equal(judgeWatchdog(row({ version: "unknown" }), NOW, "0.9.0", true).versionMismatch, false);
  assert.equal(judgeWatchdog(row(), NOW, "unknown", true).versionMismatch, false);
});
