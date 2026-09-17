import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMinutes, joinHeatmap, median, overlapMinutes, topPlayers } from "../src/lib/analytics-rules";

const from = new Date("2026-09-10T00:00:00Z");
const to = new Date("2026-09-11T00:00:00Z");
const at = (iso: string) => new Date(iso);

test("a session is clipped to the window, and an open one runs to its end", () => {
  const before = { username: "a", serverName: "s", joinedAt: at("2026-09-09T23:30:00Z"), leftAt: at("2026-09-10T00:30:00Z") };
  assert.equal(overlapMinutes(before, from, to), 30);
  const open = { username: "a", serverName: "s", joinedAt: at("2026-09-10T23:00:00Z"), leftAt: null };
  assert.equal(overlapMinutes(open, from, to), 60);
  const outside = { username: "a", serverName: "s", joinedAt: at("2026-09-08T10:00:00Z"), leftAt: at("2026-09-08T11:00:00Z") };
  assert.equal(overlapMinutes(outside, from, to), 0);
});

test("median of odd and even counts, and of nothing", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("playtime adds up per player across servers, longest first", () => {
  const top = topPlayers(
    [
      { username: "steve", serverName: "B", joinedAt: at("2026-09-10T10:00:00Z"), leftAt: at("2026-09-10T10:20:00Z") },
      { username: "alex", serverName: "A", joinedAt: at("2026-09-10T10:00:00Z"), leftAt: at("2026-09-10T10:30:00Z") },
      { username: "steve", serverName: "A", joinedAt: at("2026-09-10T12:00:00Z"), leftAt: at("2026-09-10T12:25:00Z") },
    ],
    from,
    to,
  );
  assert.deepEqual(top, [
    { username: "steve", minutes: 45, servers: ["A", "B"] },
    { username: "alex", minutes: 30, servers: ["A"] },
  ]);
});

test("joins land on their UTC weekday and hour, Monday first", () => {
  // 2026-09-14 is a Monday; 2026-09-13 a Sunday.
  const grid = joinHeatmap([at("2026-09-14T08:15:00Z"), at("2026-09-14T08:45:00Z"), at("2026-09-13T23:59:00Z")]);
  assert.equal(grid[0]![8], 2);
  assert.equal(grid[6]![23], 1);
  assert.equal(grid.flat().reduce((a, b) => a + b, 0), 3);
});

test("minutes read as people say them", () => {
  assert.equal(formatMinutes(0), "0 min");
  assert.equal(formatMinutes(0.4), "under 1 min");
  assert.equal(formatMinutes(42), "42 min");
  assert.equal(formatMinutes(120), "2 h");
  assert.equal(formatMinutes(125), "2 h 5 min");
});
