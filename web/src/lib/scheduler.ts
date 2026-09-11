import "server-only";
import { asPlatformError } from "@/domain/errors";
import { nextRun } from "./cron";
import { db } from "./db";
import { runTask } from "./server-ops";

/* Running scheduled tasks.

   The model, the cron reader and the UI have existed since before any
   of this could actually happen; what was missing was something to
   notice that 03:00 had arrived. This is that.

   It runs inside the poller process rather than as a fourth service.
   The alternative — a timer in the Next app — would fire once per
   replica, which for a backup means every instance archiving the same
   world at the same moment. */

export interface ScheduleReport {
  due: number;
  ran: number;
  failed: number;
  /** Tasks that were due while a previous run was still going. */
  skipped: number;
  errors: string[];
}

/* A task whose time has passed by more than this is not run late — it
   is skipped and rescheduled.

   Catching up matters for some jobs and is actively wrong for others: a
   panel that was down overnight should not wake up and fire six hours
   of restarts in a row. */
const LATE_TOLERANCE_MS = 15 * 60_000;

/* The actor a scheduled run is attributed to.

   Not the person who created the task: they did not press anything at
   03:00, and an audit log that says they did is one nobody can trust.
   A system account with no session and no password. */
const SYSTEM_EMAIL = "scheduler@geeboard.local";

async function systemActor() {
  const existing = await db.user.findUnique({ where: { email: SYSTEM_EMAIL } });
  if (existing) return existing;

  return db.user.create({
    data: {
      email: SYSTEM_EMAIL,
      name: "Scheduler",
      initials: "SC",
      role: "ADMIN",
      /* Never signed in to. bcrypt cannot produce this string, so no
         password matches it — which is a stronger statement than an
         unguessable one. */
      passwordHash: "!scheduler-cannot-sign-in",
    },
  });
}

export async function runDueTasks(now = new Date()): Promise<ScheduleReport> {
  const report: ScheduleReport = { due: 0, ran: 0, failed: 0, skipped: 0, errors: [] };

  const due = await db.scheduledTask.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    include: { server: { select: { slug: true, name: true } } },
    orderBy: { nextRunAt: "asc" },
  });

  const actor = due.length > 0 ? await systemActor() : null;

  for (const task of due) {
    report.due++;

    const lateBy = task.nextRunAt ? now.getTime() - task.nextRunAt.getTime() : 0;
    if (lateBy > LATE_TOLERANCE_MS) {
      report.skipped++;
      await db.scheduledTask.update({
        where: { id: task.id },
        data: { lastResult: "SKIPPED", nextRunAt: nextRun(task.cron, now) },
      });
      await db.activityEvent.create({
        data: {
          actor: "Scheduler",
          action: "task.skipped",
          target: task.name,
          tone: "MUTED",
          serverId: task.serverId,
          changes: {
            Reason: { from: "—", to: `${Math.round(lateBy / 60_000)} minutes late` },
          },
        },
      });
      continue;
    }

    try {
      const result = await runTask(actor!, task.id);
      if (result.ok) report.ran++;
      else {
        report.failed++;
        report.errors.push(`${task.name}: ${result.body}`);
      }
    } catch (error) {
      /* One task falling over must not stop the rest. A backup that
         failed is a problem; a backup that failed and then prevented
         every other server's backup is a much larger one. */
      report.failed++;
      report.errors.push(`${task.name}: ${asPlatformError(error).message}`);
      await db.scheduledTask
        .update({
          where: { id: task.id },
          data: { lastRunAt: now, lastResult: "FAILED", nextRunAt: nextRun(task.cron, now) },
        })
        .catch(() => {});
    }
  }

  return report;
}

/* Fills in a next run for any task that has none.

   A task created before the scheduler existed, or one whose expression
   was edited, would otherwise sit at null and never fire — silently,
   which is the worst way for a backup schedule to fail. */
export async function scheduleOrphans(now = new Date()): Promise<number> {
  const orphans = await db.scheduledTask.findMany({
    where: { enabled: true, nextRunAt: null },
    select: { id: true, cron: true },
  });

  let fixed = 0;
  for (const task of orphans) {
    const next = nextRun(task.cron, now);
    if (!next) continue;
    await db.scheduledTask.update({ where: { id: task.id }, data: { nextRunAt: next } });
    fixed++;
  }
  return fixed;
}
