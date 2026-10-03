import assert from "node:assert/strict";
import { test } from "node:test";
import { formatValue, hoverIndex, nearest, niceTop } from "../src/components/usage-chart.tsx";
import { nodeChart, serverChart } from "../src/lib/chart-panels.ts";
import type { NodePoint, Series, ServerPoint } from "../src/lib/metrics.ts";

/* What a page puts in front of somebody is decided here and not in the drawing: which panels, in what order, in
   which colour, with what scale. The colour of a measure does not change because another panel is missing. */

const point = (at: number, over: Partial<ServerPoint> = {}): ServerPoint => ({
  at,
  cpuPct: 20,
  cpuPctMax: 60,
  ramMb: 1500,
  ramMbMax: 1600,
  players: 2,
  rxBytesPerSecond: null,
  txBytesPerSecond: null,
  diskBytes: null,
  ...over,
});
const series = <P,>(points: P[], seconds = 3600): Series<P> => ({ range: "1h", bucketSeconds: 30, from: 1_000_000, to: 1_000_000 + seconds * 1000, points });

test("a server with no network reading and no measured world has two panels: CPU, then memory", () => {
  const chart = serverChart(series([point(1_000_000), point(1_030_000)]));
  assert.deepEqual(chart.panels.map((p) => p.id), ["cpu", "memory"]);
  assert.equal(chart.panels[0]!.colour, "accent");
  assert.equal(chart.panels[1]!.colour, "info");
  assert.equal(chart.panels[0]!.floorMax, 100, "a quiet server does not fill the panel");
  assert.deepEqual(chart.panels[0]!.lines[0]!.peaks, [60, 60], "the spike is kept beside the average");
  assert.equal(chart.bucketMs, 30_000);
  assert.deepEqual(chart.times, [1_000_000, 1_030_000]);
});

test("a network panel appears with the first reading, with received solid and sent dashed, and the others keep their colours", () => {
  const chart = serverChart(series([point(1_000_000, { rxBytesPerSecond: 1200, txBytesPerSecond: 90_000 }), point(1_030_000)]));
  assert.deepEqual(chart.panels.map((p) => p.id), ["cpu", "memory", "network"]);
  const network = chart.panels[2]!;
  assert.equal(network.format, "rate");
  assert.equal(network.colour, "ink", "no hue for a measure that has none of its own");
  assert.deepEqual(network.lines.map((l) => [l.label, Boolean(l.dashed)]), [["Received", false], ["Sent", true]]);
  assert.equal(chart.panels[0]!.colour, "accent");
  assert.equal(chart.panels[1]!.colour, "info");
});

test("the world's size is a panel once it has been measured", () => {
  const chart = serverChart(series([point(1_000_000), point(1_030_000, { diskBytes: 3_500_000_000 })]));
  assert.deepEqual(chart.panels.map((p) => p.id), ["cpu", "memory", "world"]);
  assert.equal(chart.panels[2]!.format, "bytes");
});

test("a window of a day or less is read in clock times, and a longer one in days", () => {
  assert.equal(serverChart(series([point(1_000_000)], 24 * 3600)).clock, true);
  assert.equal(serverChart(series([point(1_000_000)], 7 * 24 * 3600)).clock, false);
});

test("a node has four panels on percent scales that reach 100, and latency on its own", () => {
  const p: NodePoint = { at: 1_000_000, cpuPct: 30, cpuPctMax: 55, ramPct: 40, ramPctMax: 42, diskPct: 70, pingMs: 8 };
  const chart = nodeChart(series([p, { ...p, at: 1_030_000 }]));
  assert.deepEqual(chart.panels.map((x) => x.id), ["cpu", "memory", "disk", "latency"]);
  assert.deepEqual(chart.panels.slice(0, 3).map((x) => [x.format, x.floorMax]), [["percent", 100], ["percent", 100], ["percent", 100]]);
  assert.equal(chart.panels[3]!.format, "milliseconds");
});

test("the crosshair snaps to the nearest bucket, whichever side of it the pointer is on", () => {
  const times = [1000, 2000, 3000, 4000];
  assert.equal(nearest(times, 0), 0);
  assert.equal(nearest(times, 1400), 0);
  assert.equal(nearest(times, 1600), 1);
  assert.equal(nearest(times, 2500), 1, "halfway goes to the earlier one");
  assert.equal(nearest(times, 9999), 3);
  assert.equal(nearest([5000], 100), 0);
});

test("a pointer where there is no data reads nothing, rather than the nearest bucket from far away", () => {
  const times = [10_000, 40_000, 70_000];
  assert.equal(hoverIndex(times, 41_000, 30_000), 1);
  assert.equal(hoverIndex(times, 70_000 + 44_000, 30_000), 2, "within a bucket and a half of the last one");
  assert.equal(hoverIndex(times, 70_000 + 46_000, 30_000), null, "past it, it is the gap after the data");
  assert.equal(hoverIndex(times, 10_000 - 46_000, 30_000), null, "or the time before it");
  assert.equal(hoverIndex([], 5, 30_000), null);
});

test("an axis tops out at a round number in the unit it is written in", () => {
  assert.equal(formatValue("rate", niceTop("rate", 121_000)), "200 KB/s");
  assert.equal(formatValue("rate", niceTop("rate", 3_100_000)), "5.0 MB/s");
  assert.equal(formatValue("rate", niceTop("rate", 800)), "1.0 KB/s");
  assert.equal(formatValue("megabytes", niceTop("megabytes", 4300)), "5.0 GB");
  assert.equal(formatValue("megabytes", niceTop("megabytes", 700)), "1000 MB");
  assert.equal(formatValue("bytes", niceTop("bytes", 3_500_000_000)), "5.0 GB");
  assert.equal(niceTop("percent", 150), 200);
  assert.equal(niceTop("percent", 100), 100);
  assert.equal(niceTop("milliseconds", 23), 50);
});

test("values are written with the unit they have, and a rate is a rate", () => {
  assert.equal(formatValue("percent", 33.4), "33%");
  assert.equal(formatValue("megabytes", 800), "800 MB");
  assert.equal(formatValue("megabytes", 1536), "1.5 GB");
  assert.equal(formatValue("bytes", 3_500_000_000), "3.3 GB");
  assert.equal(formatValue("rate", 512), "512 B/s");
  assert.equal(formatValue("rate", 90_000), "87.9 KB/s");
  assert.equal(formatValue("rate", 5_000_000), "4.8 MB/s");
  assert.equal(formatValue("milliseconds", 8.4), "8 ms");
});
