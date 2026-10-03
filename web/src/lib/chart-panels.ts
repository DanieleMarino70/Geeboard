import type { ChartPanel, UsageChartProps } from "@/components/usage-chart";
import type { NodePoint, ServerPoint, Series } from "./metrics";

/* What each page draws from a series: which panels, in what order, in which colour. Pure, so that what a page
   puts in front of somebody can be tested without drawing it.

   The colour follows the measure and not its rank: CPU is the accent wherever it is drawn and memory the
   info blue, so a panel that is absent — a server with no network reading yet — never repaints the others.
   Everything else is the quiet ink colour, told apart by its stroke and its title. */

type Chart = Omit<UsageChartProps, "label" | "empty">;

const geometry = (series: Series<{ at: number }>): Pick<Chart, "times" | "from" | "to" | "bucketMs" | "clock"> => ({
  times: series.points.map((p) => p.at),
  from: series.from,
  to: series.to,
  bucketMs: series.bucketSeconds * 1000,
  // A day or less is read in clock times; a week or a month in days.
  clock: series.to - series.from <= 24 * 3600_000,
});

const has = (values: Array<number | null>) => values.some((v) => v !== null);

export function serverChart(series: Series<ServerPoint>): Chart {
  const p = series.points;
  const rx = p.map((x) => x.rxBytesPerSecond);
  const tx = p.map((x) => x.txBytesPerSecond);
  const disk = p.map((x) => x.diskBytes);
  const panels: ChartPanel[] = [
    { id: "cpu", title: "CPU, percent of one core", format: "percent", colour: "accent", floorMax: 100, lines: [{ label: "CPU", values: p.map((x) => x.cpuPct), peaks: p.map((x) => x.cpuPctMax) }] },
    { id: "memory", title: "Memory", format: "megabytes", colour: "info", lines: [{ label: "Memory", values: p.map((x) => x.ramMb), peaks: p.map((x) => x.ramMbMax) }] },
  ];
  if (has(rx) || has(tx)) {
    panels.push({
      id: "network",
      title: "Network",
      format: "rate",
      colour: "ink",
      lines: [
        { label: "Received", values: rx },
        { label: "Sent", values: tx, dashed: true },
      ],
    });
  }
  if (has(disk)) {
    panels.push({ id: "world", title: "World size", format: "bytes", colour: "ink", lines: [{ label: "World", values: disk }] });
  }
  return { ...geometry(series), panels };
}

export function nodeChart(series: Series<NodePoint>): Chart {
  const p = series.points;
  return {
    ...geometry(series),
    panels: [
      { id: "cpu", title: "CPU", format: "percent", colour: "accent", floorMax: 100, lines: [{ label: "CPU", values: p.map((x) => x.cpuPct), peaks: p.map((x) => x.cpuPctMax) }] },
      { id: "memory", title: "Memory", format: "percent", colour: "info", floorMax: 100, lines: [{ label: "Memory", values: p.map((x) => x.ramPct), peaks: p.map((x) => x.ramPctMax) }] },
      { id: "disk", title: "Storage", format: "percent", colour: "ink", floorMax: 100, lines: [{ label: "Storage", values: p.map((x) => x.diskPct) }] },
      { id: "latency", title: "Latency, panel to agent", format: "milliseconds", colour: "ink", lines: [{ label: "Latency", values: p.map((x) => x.pingMs) }] },
    ],
  };
}
