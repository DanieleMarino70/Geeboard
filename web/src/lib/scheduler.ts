import "server-only";
import { asPlatformError } from "@/domain/errors";
import { nextRun } from "./cron";
import { db } from "./db";
import { uniqueViolation } from "./db-errors";
import { runTask } from "./server-ops";
import { SCHEDULER_EMAIL } from "./system-user";

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
const SYSTEM_EMAIL = SCHEDULER_EMAIL;

async function systemActor() {
  const existing = await db.user.findUnique({ where: { email: SYSTEM_EMAIL } });
  if (existing) return existing;

  try {
    return await db.user.create({
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
  } catch (error) {
    /* Two of them looking for it at once, the first time: the other made it. Tasks used to be run one at a time, and this could not happen. */
    if (!uniqueViolation(error)) throw error;
    return db.user.findUniqueOrThrow({ where: { email: SYSTEM_EMAIL } });
  }
}

/* Running what is due, beside the poller's watch and not in it.

   It ran in the pass, one task after another, and the pass did not end until the last had: every server's nightly backup was due in the same
   minute, so for as long as they took (two minutes each is twenty for ten servers) nothing was watched. No samples, no crashed server
   restarted, a false "node unreachable" when the first ping after it failed against twenty minutes of silence, and a task that fell due in
   the meantime was skipped as late. Now a task is **claimed** before it is run, by moving its next run on in one compare-and-set, so that
   nothing can start it twice, and the claimed ones are run a few at a time: one at a time on a node, whose disk and network a second archive
   would share, and two over all. Each worker asks for the next due task when it is free, so one that falls due while the others are
   running is picked up in its turn, and judged late by the clock at that moment.

   `shouldStop` is asked before each task: a poller told to stop starts no new one (a backup that began is finished, and gets its time). */
export interface RunOptions {
  shouldStop?: () => boolean;
  /** Tasks being run at once, over all servers. One, as it always was, unless the caller says. */
  concurrency?: number;
  /** Tasks being run at once on one node. */
  perNode?: number;
}

interface Claimed {
  task: { id: string; name: string; kind: string; cron: string; serverId: string; nextRunAt: Date | null; node: string | null };
  /** Minutes late, for one that is past the tolerance and is skipped and not run. */
  tooLateMs: number | null;
}

export async function runDueTasks(now = new Date(), options: RunOptions = {}): Promise<ScheduleReport> {
  const report: ScheduleReport = { due: 0, ran: 0, failed: 0, skipped: 0, errors: [] };
  const perNode = Math.max(1, options.perNode ?? 1);
  const onNode = new Map<string, number>();
  const seen = new Set<string>();
  // Found or made once for the run, by whichever worker needs it first: the others wait for the same answer.
  let actorOnce: ReturnType<typeof systemActor> | null = null;
  const actorOf = () => (actorOnce ??= systemActor());
  // The first claim is judged by the clock the caller gave, the later ones by the clock: a queue that waited is as late as it is.
  let first = true;

  const claimNext = async (): Promise<Claimed | null> => {
    const at = first ? now : new Date();
    first = false;
    const candidates = await db.scheduledTask.findMany({
      where: { enabled: true, nextRunAt: { lte: at } },
      include: { server: { select: { nodeId: true } } },
      orderBy: { nextRunAt: "asc" },
      take: 100,
    });
    for (const task of candidates) {
      if (seen.has(task.id)) continue;
      const node = task.server.nodeId;
      if (node && (onNode.get(node) ?? 0) >= perNode) continue;
      const lateBy = task.nextRunAt ? at.getTime() - task.nextRunAt.getTime() : 0;
      const tooLate = lateBy > LATE_TOLERANCE_MS;
      /* The claim. Its next run moves on from the time it was due, in this statement and only if nobody has moved it: of two pollers that
         ever looked at the same minute, one gets the task. A task too late for its time is rescheduled in the same statement. */
      const { count } = await db.scheduledTask.updateMany({
        where: { id: task.id, nextRunAt: task.nextRunAt },
        data: tooLate ? { lastResult: "SKIPPED", nextRunAt: nextRun(task.cron, at) } : { nextRunAt: nextRun(task.cron, at) },
      });
      if (count !== 1) {
        seen.add(task.id);
        continue;
      }
      seen.add(task.id);
      if (node) onNode.set(node, (onNode.get(node) ?? 0) + 1);
      return { task: { id: task.id, name: task.name, kind: task.kind, cron: task.cron, serverId: task.serverId, nextRunAt: task.nextRunAt, node }, tooLateMs: tooLate ? lateBy : null };
    }
    return null;
  };

  const work = async () => {
    for (;;) {
      if (options.shouldStop?.()) return;
      const claimed = await claimNext();
      if (!claimed) return;
      const { task } = claimed;
      report.due++;
      try {
        if (claimed.tooLateMs !== null) {
          report.skipped++;
          await db.activityEvent.create({
            data: {
              actor: "Scheduler",
              action: "task.skipped",
              target: task.name,
              tone: "MUTED",
              serverId: task.serverId,
              changes: {
                Reason: { from: "—", to: `${Math.round(claimed.tooLateMs / 60_000)} minutes late` },
              },
            },
          });
          continue;
        }

        const actor = await actorOf();
        try {
          const result = await runTask(actor, task.id);
          if (result.ok) report.ran++;
          else {
            report.failed++;
            report.errors.push(`${task.name}: ${result.body}`);
            await taskFailed(task, result.body);
          }
        } catch (error) {
          /* One task falling over must not stop the rest. A backup that
             failed is a problem; a backup that failed and then prevented
             every other server's backup is a much larger one. */
          report.failed++;
          report.errors.push(`${task.name}: ${asPlatformError(error).message}`);
          await taskFailed(task, asPlatformError(error).message);
          await db.scheduledTask
            .update({
              where: { id: task.id },
              data: { lastRunAt: new Date(), lastResult: "FAILED", nextRunAt: nextRun(task.cron, new Date()) },
            })
            .catch(() => {});
        }
      } finally {
        if (task.node) onNode.set(task.node, Math.max(0, (onNode.get(task.node) ?? 1) - 1));
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 1) }, () => work()));
  return report;
}

/* A task that failed with nobody watching leaves a line in the audit log, with the reason. A backup writes its own (backup.failed); a
   restart, a console command and a broadcast wrote nothing, so the page said "failed on the last run" and the reason was only ever in the
   poller's log. */
async function taskFailed(task: { name: string; kind: string; serverId: string }, reason: string) {
  if (task.kind === "BACKUP") return;
  await db.activityEvent
    .create({
      data: {
        actor: "Scheduler",
        action: "task.failed",
        target: task.name,
        tone: "WARNING",
        serverId: task.serverId,
        changes: { Kind: { from: "—", to: task.kind.toLowerCase() }, Reason: { from: "—", to: reason } },
      },
    })
    .catch(() => {});
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
