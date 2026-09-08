import { describeCron, nextRun, nextRuns } from "../src/lib/cron";

let pass = 0, fail = 0;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 16) + "Z" : "null");

function eq(label: string, got: string, want: string) {
  if (got === want) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got  ${got}\n         want ${want}`); }
}

const base = new Date("2026-09-08T14:26:00Z"); // a Tuesday

console.log("\n== nextRun ==");
eq("daily 03:00 → tomorrow", iso(nextRun("0 3 * * *", base)), "2026-09-09T03:00Z");
eq("daily 17:00 → today", iso(nextRun("0 17 * * *", base)), "2026-09-08T17:00Z");
eq("every 30 min", iso(nextRun("*/30 * * * *", base)), "2026-09-08T14:30Z");
eq("strictly after (14:26 on */2)", iso(nextRun("*/2 * * * *", base)), "2026-09-08T14:28Z");
eq("Sundays 04:00", iso(nextRun("0 4 * * 0", base)), "2026-09-13T04:00Z");
eq("Mondays 05:00", iso(nextRun("0 5 * * 1", base)), "2026-09-14T05:00Z");
eq("1st of month 02:00", iso(nextRun("0 2 1 * *", base)), "2026-10-01T02:00Z");
eq("Feb 29 on a leap year", iso(nextRun("0 0 29 2 *", new Date("2027-06-01T00:00Z"))), "2028-02-29T00:00Z");
eq("list of hours", iso(nextRun("0 6,18 * * *", base)), "2026-09-08T18:00Z");
eq("range of days", iso(nextRun("0 9 * * 1-5", new Date("2026-09-12T10:00Z"))), "2026-09-14T09:00Z");
eq("invalid expression", iso(nextRun("nonsense", base)), "null");
eq("wrong field count", iso(nextRun("0 3 * *", base)), "null");

console.log("\n== dom/dow union (standard cron quirk) ==");
// Day 15 OR a Monday, whichever comes first.
eq("15th or Monday", iso(nextRun("0 0 15 * 1", base)), "2026-09-14T00:00Z");

console.log("\n== nextRuns ==");
eq("three daily runs", nextRuns("0 3 * * *", 3, base).map(iso).join(" "),
   "2026-09-09T03:00Z 2026-09-10T03:00Z 2026-09-11T03:00Z");

console.log("\n== describeCron ==");
eq("daily",       describeCron("0 3 * * *"),   "Every day · 03:00");
eq("every 30m",   describeCron("*/30 * * * *"), "Every 30 minutes");
eq("sundays",     describeCron("0 4 * * 0"),   "Sundays · 04:00");
eq("mondays",     describeCron("0 5 * * 1"),   "Mondays · 05:00");
eq("first of mo", describeCron("0 2 1 * *"),   "First of the month · 02:00");
eq("invalid",     describeCron("nope"),        "Invalid expression");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
