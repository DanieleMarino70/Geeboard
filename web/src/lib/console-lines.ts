import type { LogLine } from "./console-fixture";

/* What a console shows, out of what a node sent.

   Three things a real server's output did to the page, found on a
   production Terraria server:

   - The same lines twice. The page is drawn with the node's recent lines,
     then the live stream opens and the node sends its recent lines again;
     a reconnect sent them a third time. Each line carries the time Docker
     wrote it down, to the nanosecond, and a line with the same time and
     the same text is the same line.
   - A boot hidden behind its own progress. Terraria prints
     "Resetting game objects 1%" … "100%", then the same for loading the
     world and for every stage of making one: hundreds of lines, which
     pushed the start of the run and the error that mattered out of the
     window. In a run of progress lines, each kind of line (the same
     words, other numbers) is shown once, as its last: saving a world
     alternates "Finalizing world - 0.0%" with "Saving world data: 16%",
     and folding only neighbours folded nothing.
   - A health check read as an attack. What Geeboard asks a game to see
     whether it answers can be printed by the game; a definition names
     those lines, and they are marked as Geeboard's. */

/** The same line twice has the same time and text. Lines with no time of their own are never merged. */
export function mergeLines(...groups: LogLine[][]): LogLine[] {
  const seen = new Set<string>();
  const out: LogLine[] = [];
  for (const line of groups.flat()) {
    if (line.at) {
      const key = `${line.at}|${line.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(line);
  }
  return out;
}

const PROGRESS = /\d+(?:\.\d+)?\s*%/;
const skeleton = (message: string) => message.replace(/\d+(?:\.\d+)?/g, "#");

/** In a run of progress lines, each kind — the same words, other numbers — kept once, as its last, where it first appeared. */
export function collapseProgress(lines: LogLine[]): LogLine[] {
  const out: LogLine[] = [];
  // Where each kind of line in the current run is; any other line ends the run.
  let run = new Map<string, number>();
  for (const line of lines) {
    if (!PROGRESS.test(line.message)) {
      run = new Map();
      out.push(line);
      continue;
    }
    const kind = skeleton(line.message);
    const at = run.get(kind);
    if (at !== undefined) {
      out[at] = line;
      continue;
    }
    run.set(kind, out.length);
    out.push(line);
  }
  return out;
}

/** Whether a line is one a game printed because Geeboard asked it something. */
export function isProbeLine(pattern: string | undefined, message: string): boolean {
  if (!pattern) return false;
  try {
    return new RegExp(pattern).test(message);
  } catch {
    return false;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A time as the reader's own clock shows it. */
export function localTime(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** The same, with the date, for a file that may be read days later. */
export function localDateTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${localTime(at)}`;
}

/** "UTC+02:00", for a file's first line: the times in it are local, and say whose. */
export function localOffset(now = new Date()): string {
  const minutes = -now.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  return `UTC${sign}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}
