import path from "node:path";
import process from "node:process";
process.loadEnvFile(path.join(process.cwd(), ".env"));

/* The metrics and reconciliation loop, as its own process.

   Deliberately not a timer inside the Next app: that would run once per
   server instance, restart on every rebuild, and quietly stop mattering
   in production behind more than one replica. One process, one loop. */

const { pollOnce, pruneSamples } = await import("../src/lib/poller");
const { runDueTasks, scheduleOrphans } = await import("../src/lib/scheduler");
const { db } = await import("../src/lib/db");

const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const PRUNE_EVERY = 240; // roughly hourly at the default interval
const ONCE = process.argv.includes("--once");

let stopping = false;
let passes = 0;

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

async function pass() {
  const started = Date.now();
  try {
    const report = await pollOnce();
    passes++;

    const parts = [
      `${report.serversChecked} servers on ${report.nodesChecked} nodes`,
      `${report.samplesWritten} samples`,
    ];
    if (report.driftCorrected > 0) parts.push(`${report.driftCorrected} corrected`);
    if (report.held > 0) parts.push(`${report.held} held mid-operation`);
    if (report.unhealthy > 0) parts.push(`${report.unhealthy} unhealthy`);
    if (report.recovered > 0) parts.push(`${report.recovered} restarted`);
    if (report.gaveUp > 0) parts.push(`${report.gaveUp} gave up`);
    if (report.nodesUnreachable > 0) parts.push(`${report.nodesUnreachable} nodes unreachable`);

    console.log(`${stamp()} poll: ${parts.join(" · ")} (${Date.now() - started}ms)`);
    for (const error of report.errors) console.warn(`${stamp()}   ! ${error}`);

    /* Scheduled tasks run in this process too, rather than as a fourth
       service or a timer inside Next — that would fire once per replica,
       which for a nightly backup means every instance archiving the same
       world at the same moment. */
    const schedule = await runDueTasks();
    if (schedule.due > 0) {
      console.log(
        `${stamp()} tasks: ${schedule.ran} ran` +
          (schedule.failed > 0 ? `, ${schedule.failed} failed` : "") +
          (schedule.skipped > 0 ? `, ${schedule.skipped} skipped as too late` : ""),
      );
      for (const error of schedule.errors) console.warn(`${stamp()}   ! ${error}`);
    }

    if (passes % PRUNE_EVERY === 0) {
      const pruned = await pruneSamples();
      if (pruned > 0) console.log(`${stamp()} pruned ${pruned} old samples`);

      /* A task with no next run never fires, silently — which is the
         worst way for a backup schedule to fail. */
      const fixed = await scheduleOrphans();
      if (fixed > 0) console.log(`${stamp()} scheduled ${fixed} tasks that had no next run`);
    }
  } catch (error) {
    // A failed pass must never end the loop; the next one may succeed.
    console.error(`${stamp()} poll failed:`, error instanceof Error ? error.message : error);
  }
}

async function loop() {
  while (!stopping) {
    await pass();
    if (stopping) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`${stamp()} ${signal} — finishing the current pass`);
  });
}

if (ONCE) {
  await pass();
} else {
  console.log(`geeboard poller: every ${INTERVAL_MS}ms. Ctrl+C to stop.`);
  await loop();
}

await db.$disconnect();
process.exit(0);
