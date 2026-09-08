// A small 5-field cron reader: minute hour day-of-month month day-of-week.
// Supports wildcards, steps, ranges and comma lists — the subset the
// scheduler UI can produce. Deliberately not a general cron library; if
// the panel ever needs @yearly, L or #, swap this for one rather than
// growing it.

const RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week, 0 = Sunday
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseField(field: string, index: number): Set<number> {
  const [lo, hi] = RANGES[index];
  const out = new Set<number>();

  for (const part of field.split(",")) {
    const [spec, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${part}"`);

    let start = lo;
    let end = hi;

    if (spec !== "*") {
      const bounds = spec.split("-");
      start = Number(bounds[0]);
      end = bounds.length > 1 ? Number(bounds[1]) : bounds.length === 1 && stepRaw ? hi : start;
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`bad range in "${part}"`);
      }
      if (start < lo || end > hi || start > end) throw new Error(`out of range in "${part}"`);
    }

    for (let v = start; v <= end; v += step) out.add(index === 4 && v === 7 ? 0 : v);
  }

  return out;
}

export interface Cron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

export function parseCron(expression: string): Cron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`expected 5 fields, got ${fields.length}`);

  return {
    minute: parseField(fields[0], 0),
    hour: parseField(fields[1], 1),
    dom: parseField(fields[2], 2),
    month: parseField(fields[3], 3),
    dow: parseField(fields[4], 4),
    domRestricted: fields[2] !== "*",
    dowRestricted: fields[4] !== "*",
  };
}

/* Standard cron quirk: when both day-of-month and day-of-week are
   restricted the match is a union, not an intersection. */
function dayMatches(c: Cron, date: Date) {
  const domOk = c.dom.has(date.getUTCDate());
  const dowOk = c.dow.has(date.getUTCDay());
  if (c.domRestricted && c.dowRestricted) return domOk || dowOk;
  if (c.domRestricted) return domOk;
  if (c.dowRestricted) return dowOk;
  return true;
}

/** Next firing strictly after `from`, or null if none within a year. */
export function nextRun(expression: string, from: Date = new Date()): Date | null {
  let c: Cron;
  try {
    c = parseCron(expression);
  } catch {
    return null;
  }

  const t = new Date(from);
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);

  const limit = new Date(from.getTime() + 366 * 24 * 3600_000);

  while (t <= limit) {
    if (!c.month.has(t.getUTCMonth() + 1)) {
      // Jump to the first minute of the next month.
      t.setUTCMonth(t.getUTCMonth() + 1, 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(c, t)) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!c.hour.has(t.getUTCHours())) {
      t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!c.minute.has(t.getUTCMinutes())) {
      t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return new Date(t);
  }

  return null;
}

/** The next `count` firings, for the 24-hour timeline. */
export function nextRuns(expression: string, count: number, from: Date = new Date()): Date[] {
  const out: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const next = nextRun(expression, cursor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

/** Plain-English cadence for the table, e.g. "Every day · 03:00". */
export function describeCron(expression: string): string {
  let c: Cron;
  try {
    c = parseCron(expression);
  } catch {
    return "Invalid expression";
  }

  const fields = expression.trim().split(/\s+/);
  const [min, hour, dom, month, dow] = fields;
  const at = () =>
    `${String([...c.hour][0]).padStart(2, "0")}:${String([...c.minute][0]).padStart(2, "0")}`;

  if (min.startsWith("*/") && hour === "*") return `Every ${min.slice(2)} minutes`;
  if (min === "*" && hour === "*") return "Every minute";
  if (hour.startsWith("*/")) return `Every ${hour.slice(2)} hours`;

  if (c.minute.size === 1 && c.hour.size === 1) {
    if (dom === "*" && dow === "*" && month === "*") return `Every day · ${at()}`;
    if (dow !== "*" && dom === "*") {
      const days = [...c.dow].sort().map((d) => DAY_NAMES[d]);
      return days.length === 1 ? `${days[0]}s · ${at()}` : `${days.join(", ")} · ${at()}`;
    }
    if (dom !== "*" && dom === "1") return `First of the month · ${at()}`;
    if (dom !== "*") return `Day ${dom} of the month · ${at()}`;
  }

  return expression;
}
