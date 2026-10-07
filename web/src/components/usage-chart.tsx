"use client";

import { useRef, useState } from "react";
import { useHydrated } from "./local-time";
import { niceCeil } from "@/domain/metrics/ranges";

/* A history chart as small multiples: one panel for each measure, each with its own scale and its own
   labelled axis, sharing one time axis and one crosshair.

   Not one chart with two vertical axes. CPU in percent, memory in gigabytes and a network rate share
   nothing a single scale could say, and a second axis makes whichever line the reader looked at second
   mean whatever the first one's numbers say. Stacked, each line has a scale that is the line's own, and a
   hover reads all of them at one moment.

   Marks are thin and quiet: a 2px line, a hairline grid, a wash of ten per cent under a lone series, an end
   dot with a ring of the surface colour. Text wears the ink tokens and never the series colour. A line is
   broken where there is no data, not drawn across it. Every value the tooltip shows is in the table under
   the chart, so nothing needs a pointer. */

export type ChartFormat = "percent" | "megabytes" | "bytes" | "rate" | "milliseconds";

export interface ChartLine {
  label: string;
  values: Array<number | null>;
  /** The highest value in each bucket, when the line is an average and a spike should not be lost. */
  peaks?: Array<number | null>;
  /** A second line in the same panel is told apart by its stroke as well as by what the legend says. */
  dashed?: boolean;
}

export interface ChartPanel {
  id: string;
  title: string;
  format: ChartFormat;
  colour: "accent" | "info" | "ink";
  lines: ChartLine[];
  /** The top of the axis is at least this: 100 for a percentage, so a quiet server does not fill the panel. */
  floorMax?: number;
}

export interface UsageChartProps {
  label: string;
  /** The start of each bucket, in milliseconds. */
  times: number[];
  from: number;
  to: number;
  bucketMs: number;
  /** How the time axis is written: clock times for a day or less, days beyond. */
  clock: boolean;
  panels: ChartPanel[];
  /** Shown instead of the chart when there is nothing in the window. */
  empty?: React.ReactNode;
}

const COLOUR = { accent: "var(--accent)", info: "var(--info)", ink: "var(--ink-2)" } as const;
const W = 600;
const H = 64;
/* The width of the axis labels to the left of the plots, in pixels. The pointer, the crosshair and the time axis are
   all measured from its right-hand edge, so that what the reader points at is what the chart reads. */
const GUTTER = 60;

function size(bytes: number, unit: string): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? Math.round(v) : v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}${unit}`;
}

export function formatValue(format: ChartFormat, v: number): string {
  switch (format) {
    case "percent":
      return `${Math.round(v)}%`;
    case "megabytes":
      return v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${Math.round(v)} MB`;
    case "bytes":
      return size(v, "");
    case "rate":
      return size(v, "/s");
    case "milliseconds":
      return `${Math.round(v)} ms`;
  }
}

const time = (t: number, clock: boolean) =>
  clock
    ? new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** The index of the bucket nearest a time. `times` is ascending. */
export function nearest(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(times[lo - 1]! - t) <= Math.abs(times[lo]! - t) ? lo - 1 : lo;
}

/* Which bucket a pointer at time `t` is reading, or none. The crosshair snaps to the nearest bucket, but not from
   anywhere: a pointer in a stretch with no data — the hour before a server was made, the minutes it was stopped — has
   nothing to read, and a tooltip with the nearest bucket's values would say something about a time it is not at. */
export function hoverIndex(times: number[], t: number, bucketMs: number): number | null {
  if (times.length === 0) return null;
  const i = nearest(times, t);
  return Math.abs(times[i]! - t) <= bucketMs * 1.5 ? i : null;
}

/* The top of an axis: a round number *in the unit it is written in*. 200 KB/s and not 195 KB/s, which is what a round
   number of bytes comes to — the labels on an axis are read as numbers, and a round one is read at a glance. */
export function niceTop(format: ChartFormat, max: number): number {
  if (format === "percent" || format === "milliseconds") return niceCeil(max);
  if (format === "megabytes") {
    const unit = max >= 1024 ? 1024 : 1;
    return niceCeil(max / unit) * unit;
  }
  let unit = 1;
  while (max / unit >= 1024 && unit < 1024 ** 4) unit *= 1024;
  return niceCeil(max / unit) * unit;
}

function topOf(panel: ChartPanel): number {
  let max = 0;
  for (const line of panel.lines) {
    for (const v of line.peaks ?? line.values) if (v !== null && v > max) max = v;
  }
  return niceTop(panel.format, Math.max(max, panel.floorMax ?? 0));
}

export function UsageChart({ label, times, from, to, bucketMs, clock, panels, empty }: UsageChartProps) {
  const [at, setAt] = useState<number | null>(null);
  /* A time is the reader's: drawn on the server it was the server's, which on a VPS in UTC is not the hour of a reader in Rome, and React
     reported the difference as a hydration mismatch. The axis and the table say nothing until the browser has taken over. */
  const hydrated = useHydrated();
  const plots = useRef<HTMLDivElement>(null);
  if (times.length === 0) return <>{empty}</>;

  const span = Math.max(1, to - from);
  const x = (t: number) => ((t - from) / span) * W;
  const hovered = at === null ? null : at;

  const move = (clientX: number) => {
    const box = plots.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (clientX - box.left - GUTTER) / Math.max(1, box.width - GUTTER)));
    setAt(hoverIndex(times, from + fraction * span, bucketMs));
  };

  const hoverFraction = hovered === null ? 0 : x(times[hovered]!) / W;
  // Measured from the plots' left edge, past the labels: a share of what is left of the width.
  const hoverLeft = `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${hoverFraction})`;

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <div className="relative">
        <div className="relative min-w-0" ref={plots} onPointerMove={(e) => move(e.clientX)} onPointerLeave={() => setAt(null)}>
          <div className="flex flex-col gap-[14px]">
            {panels.map((panel) => (
              <Panel key={panel.id} panel={panel} times={times} x={x} bucketMs={bucketMs} hovered={hovered} />
            ))}
          </div>

          {hovered !== null && (
            <>
              {/* The crosshair: a hairline at the nearest bucket, down through every panel. */}
              <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 w-px bg-line-2" style={{ left: hoverLeft }} />
              <div
                role="status"
                className="pointer-events-none absolute top-0 z-10 min-w-[170px] rounded-[9px] border border-line-2 bg-card-2 px-3 py-[9px] shadow-lg"
                style={{ left: hoverLeft, transform: hoverFraction > 0.6 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}
              >
                <div className="mb-[6px] font-mono text-[10px] text-ink-4">
                  {new Date(times[hovered]!).toLocaleString("en-GB", clock ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
                <ul className="flex flex-col gap-[5px]">
                  {panels.flatMap((panel) =>
                    panel.lines.map((line) => {
                      const v = line.values[hovered];
                      const peak = line.peaks?.[hovered];
                      return (
                        <li key={`${panel.id}-${line.label}`} className="flex items-baseline gap-2">
                          <svg width="12" height="6" aria-hidden className="shrink-0 self-center">
                            <line x1="0" y1="3" x2="12" y2="3" stroke={COLOUR[panel.colour]} strokeWidth="2" strokeDasharray={line.dashed ? "3 2" : undefined} strokeLinecap="round" />
                          </svg>
                          <span className="font-mono text-[12px] font-medium text-ink tnum">{v === null || v === undefined ? "—" : formatValue(panel.format, v)}</span>
                          <span className="text-[10.5px] text-ink-3">{line.label}</span>
                          {peak !== undefined && peak !== null && v !== null && peak > v && (
                            <span className="font-mono text-[10px] text-ink-4">peak {formatValue(panel.format, peak)}</span>
                          )}
                        </li>
                      );
                    }),
                  )}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Time, shared by every panel. */}
      <div className="flex justify-between font-mono text-[9.5px] text-ink-4" style={{ paddingLeft: GUTTER }}>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i}>{i === 4 ? "now" : hydrated ? time(from + (span * i) / 4, clock) : ""}</span>
        ))}
      </div>

      <details className="mt-1 text-[11.5px]">
        <summary className="cursor-pointer text-ink-3 hover:text-ink-2">As a table</summary>
        <div className="mt-2 max-h-[240px] overflow-auto rounded-[9px] border border-line">
          <table className="w-full border-collapse text-left font-mono text-[10.5px] text-ink-3">
            <thead className="sticky top-0 bg-card-2 text-ink-4">
              <tr>
                <th className="px-3 py-[6px] font-normal">Time</th>
                {panels.flatMap((p) => p.lines.map((l) => <th key={`${p.id}-${l.label}`} className="px-3 py-[6px] font-normal">{l.label}</th>))}
              </tr>
            </thead>
            <tbody>
              {[...times.keys()].reverse().map((i) => (
                <tr key={times[i]} className="border-t border-line">
                  <td className="px-3 py-[5px] whitespace-nowrap text-ink-4">{hydrated ? new Date(times[i]!).toLocaleString("en-GB", clock ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</td>
                  {panels.flatMap((p) =>
                    p.lines.map((l) => (
                      <td key={`${p.id}-${l.label}`} className="px-3 py-[5px] whitespace-nowrap tnum">
                        {l.values[i] === null || l.values[i] === undefined ? "—" : formatValue(p.format, l.values[i]!)}
                      </td>
                    )),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Panel({ panel, times, x, bucketMs, hovered }: { panel: ChartPanel; times: number[]; x: (t: number) => number; bucketMs: number; hovered: number | null }) {
  const top = topOf(panel);
  const y = (v: number) => H - 2 - (Math.min(v, top) / top) * (H - 4);
  const colour = COLOUR[panel.colour];
  const lone = panel.lines.length === 1;

  /* Runs of consecutive points; a gap of more than two buckets, or a missing value, ends one. */
  const segments = (values: Array<number | null>) => {
    const runs: Array<Array<[number, number]>> = [];
    let run: Array<[number, number]> = [];
    let last = -Infinity;
    values.forEach((v, i) => {
      if (v === null || v === undefined) {
        if (run.length) runs.push(run);
        run = [];
        last = -Infinity;
        return;
      }
      if (times[i]! - last > bucketMs * 2.5 && run.length) {
        runs.push(run);
        run = [];
      }
      run.push([x(times[i]!), y(v)]);
      last = times[i]!;
    });
    if (run.length) runs.push(run);
    return runs;
  };

  const latest = panel.lines[0]!.values.findLastIndex((v) => v !== null);
  const latestValue = latest >= 0 ? panel.lines[0]!.values[latest]! : null;

  return (
    <div>
      <div className="mb-[3px] flex flex-wrap items-baseline gap-x-3 gap-y-1" style={{ paddingLeft: GUTTER }}>
        <span className="text-[11px] font-medium text-ink-2">{panel.title}</span>
        {latestValue !== null && <span className="font-mono text-[10.5px] text-ink-3 tnum">{formatValue(panel.format, latestValue)} now</span>}
        {/* A legend where there is more than one line: the title names a lone one. */}
        {!lone &&
          panel.lines.map((line) => (
            <span key={line.label} className="flex items-center gap-[5px] text-[10.5px] text-ink-3">
              <svg width="14" height="6" aria-hidden>
                <line x1="0" y1="3" x2="14" y2="3" stroke={colour} strokeWidth="2" strokeDasharray={line.dashed ? "3 2" : undefined} strokeLinecap="round" />
              </svg>
              {line.label}
            </span>
          ))}
      </div>
      <div className="relative" style={{ height: H }}>
        {/* The axis: the top of the scale and zero, level with the top and the foot of the plot. */}
        <div className="absolute top-0 left-0 flex flex-col justify-between text-right font-mono text-[9.5px] leading-none text-ink-4 tnum" style={{ width: GUTTER - 8, height: H }}>
          <span>{formatValue(panel.format, top)}</span>
          <span>0</span>
        </div>
        <div className="relative" style={{ height: H, marginLeft: GUTTER }}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${panel.title}, ${panel.lines.map((l) => l.label).join(" and ")}`} className="block h-full w-full">
            {[0, 0.5, 1].map((f) => (
              <line key={f} x1="0" x2={W} y1={H - 2 - f * (H - 4)} y2={H - 2 - f * (H - 4)} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {panel.lines.map((line) =>
              segments(line.values).map((run, i) => (
                <g key={`${line.label}-${i}`}>
                  {lone && run.length > 1 && <polygon points={`${run[0]![0]},${H} ${run.map(([px, py]) => `${px},${py}`).join(" ")} ${run[run.length - 1]![0]},${H}`} fill={colour} opacity="0.1" />}
                  {run.length > 1 ? (
                    <polyline points={run.map(([px, py]) => `${px},${py}`).join(" ")} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={line.dashed ? "5 4" : undefined} vectorEffect="non-scaling-stroke" />
                  ) : null}
                </g>
              )),
            )}
          </svg>
          {/* Dots are drawn in HTML: in an SVG stretched to fit they would be ovals. */}
          {panel.lines.map((line) => {
            const i = hovered ?? line.values.findLastIndex((v) => v !== null);
            const v = i >= 0 ? line.values[i] : null;
            if (i < 0 || v === null || v === undefined) return null;
            return (
              <span
                key={`dot-${line.label}`}
                aria-hidden
                className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${(x(times[i]!) / W) * 100}%`, top: `${(y(v) / H) * 100}%`, background: colour, boxShadow: "0 0 0 2px var(--card)" }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
