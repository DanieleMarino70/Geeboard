import Link from "next/link";
import {
  Archive,
  Clock,
  GitBranch,
  History,
  Plus,
  RotateCw,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { AppShell } from "@/components/shell";
import { Card, Label, Pill } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { describeCron, nextRun, nextRuns } from "@/lib/cron";
import { getTasks, relativeTime, untilTime } from "@/lib/queries";
import type { Tone } from "@/lib/ui-types";
import { RunNowButton, TaskToggle } from "./task-controls";

export const dynamic = "force-dynamic";

const KIND = {
  BACKUP: { icon: Archive, label: "Backup", colour: "var(--accent)", tone: "accent" as const },
  RESTART: { icon: RotateCw, label: "Restart", colour: "var(--warning)", tone: "warning" as const },
  BROADCAST: { icon: Send, label: "Broadcast", colour: "var(--info)", tone: "info" as const },
  CLEANUP: { icon: Trash2, label: "Cleanup", colour: "var(--ink-4)", tone: "muted" as const },
  COMMAND: { icon: GitBranch, label: "Command", colour: "var(--accent-2)", tone: "accent" as const },
} as const;

const RESULT: Record<string, { tone: Tone; label: string }> = {
  SUCCEEDED: { tone: "success", label: "Succeeded" },
  FAILED: { tone: "danger", label: "Failed" },
  SKIPPED: { tone: "muted", label: "Skipped" },
  NEVER_RUN: { tone: "muted", label: "Never run" },
};

const COLS = "minmax(0,1fr) 118px 150px 116px 124px 34px 46px";

export default async function SchedulerPage() {
  const user = await requireUser();
  const tasks = await getTasks();

  const now = new Date();
  const windowEnd = now.getTime() + 24 * 3600_000;

  /* Every firing of every enabled task inside the next 24 hours,
     positioned as a percentage across the timeline. */
  const marks = tasks
    .filter((t) => t.enabled)
    .flatMap((t) =>
      nextRuns(t.cron, 8, now)
        .filter((d) => d.getTime() <= windowEnd)
        .map((at) => ({
          id: `${t.id}-${at.getTime()}`,
          at,
          kind: t.kind,
          name: t.name,
          pct: ((at.getTime() - now.getTime()) / (24 * 3600_000)) * 100,
        })),
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, 14);

  const hourLabels = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(now.getTime() + i * 6 * 3600_000);
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  });

  const failing = tasks.filter((t) => t.enabled && t.lastResult === "FAILED");
  const enabledCount = tasks.filter((t) => t.enabled).length;

  return (
    <AppShell crumbs={["Ashfold", "Scheduler"]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Scheduler</h1>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              Cron-backed tasks with a real preview of when they will next fire. Expressions are
              evaluated in UTC, the way the servers run.
            </p>
          </div>
          <div className="flex shrink-0 gap-2 lg:ml-auto">
            <button
              type="button"
              disabled
              title="Not wired up yet"
              className="inline-flex items-center gap-[7px] rounded-[9px] border border-line bg-card px-4 py-[9px] text-[13px] font-medium text-ink-2 opacity-45"
            >
              <History size={14} strokeWidth={1.9} />
              Run history
            </button>
            <button
              type="button"
              disabled
              title="Not wired up yet"
              className="inline-flex items-center gap-[7px] rounded-[9px] bg-accent px-4 py-[9px] text-[13px] font-semibold text-accent-ink opacity-45"
            >
              <Plus size={14} strokeWidth={1.9} />
              New task
            </button>
          </div>
        </div>

        <Card className="px-5 py-[18px]">
          <div className="mb-[18px] flex flex-wrap items-baseline gap-3">
            <h2 className="text-[13.5px] font-semibold">Next 24 hours</h2>
            <span className="font-mono text-[10.5px] text-ink-4">
              {marks.length} firings · evaluated in UTC
            </span>
            <span className="ml-auto flex flex-wrap gap-[14px]">
              {Object.entries(KIND).map(([key, meta]) => (
                <span
                  key={key}
                  className="flex items-center gap-[6px] font-mono text-[10px] text-ink-4"
                >
                  <span
                    className="h-[7px] w-[7px] rounded-[2px]"
                    style={{ background: meta.colour }}
                  />
                  {meta.label}
                </span>
              ))}
            </span>
          </div>

          {marks.length === 0 ? (
            <p className="py-6 text-center text-[11.5px] text-ink-4">
              Nothing is scheduled to run in the next 24 hours.
            </p>
          ) : (
            <div className="relative h-[64px]">
              <div className="absolute inset-x-0 top-[30px] h-[2px] rounded-[2px] bg-(--border)" />
              {marks.map((m) => {
                const meta = KIND[m.kind];
                const Icon = meta.icon;
                return (
                  <div
                    key={m.id}
                    className="absolute top-[16px] -translate-x-1/2"
                    style={{ left: `${Math.min(98, Math.max(2, m.pct))}%` }}
                    title={`${m.name} · ${m.at.toUTCString()}`}
                  >
                    <span
                      className="grid h-[30px] w-[30px] place-items-center rounded-[9px] border border-line bg-card-2 shadow-e1"
                      style={{ color: meta.colour }}
                    >
                      <Icon size={14} strokeWidth={1.7} />
                    </span>
                  </div>
                );
              })}
              <div className="absolute top-[10px] bottom-[16px] left-0 w-px bg-accent" />
              <div className="absolute top-0 left-0 font-mono text-[9px] tracking-[0.06em] text-accent uppercase">
                now
              </div>
              <div className="absolute inset-x-0 bottom-0 flex justify-between font-mono text-[9.5px] text-ink-4">
                {hourLabels.map((h, i) => (
                  <span key={`${h}-${i}`}>{h}</span>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-[10px] border-b border-line px-[18px] py-[13px]">
            <h2 className="text-[13.5px] font-semibold">Tasks</h2>
            <span className="font-mono text-[10.5px] text-ink-4">
              {tasks.length} tasks · {enabledCount} enabled
            </span>
            {failing.length > 0 && (
              <span className="ml-auto flex items-center gap-2 text-[11.5px] text-danger">
                <TriangleAlert size={13} strokeWidth={1.9} />
                {failing.map((t) => t.name).join(", ")} failed on the last run
              </span>
            )}
          </div>

          {tasks.length === 0 ? (
            <div className="px-6 py-[52px] text-center">
              <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
                <Clock size={20} strokeWidth={1.6} />
              </div>
              <div className="text-[13.5px] font-semibold">Nothing scheduled</div>
              <p className="mx-auto mt-2 max-w-[34ch] text-xs leading-relaxed text-ink-4">
                Nightly backups and a restart before peak hours are the two most servers want.
              </p>
            </div>
          ) : (
            <>
              <div
                className="hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid"
                style={{ gridTemplateColumns: COLS }}
              >
                {["Task", "Cron", "Cadence", "Next run", "Last result", "", "On"].map((h, i) => (
                  <Label key={h || i} className={i === 6 ? "text-right" : undefined}>
                    {h}
                  </Label>
                ))}
              </div>

              {tasks.map((t, i) => {
                const meta = KIND[t.kind];
                const Icon = meta.icon;
                const result = RESULT[t.lastResult];
                const next = t.enabled ? nextRun(t.cron) : null;

                return (
                  <div
                    key={t.id}
                    className={`px-[18px] py-[14px] transition-colors duration-150 hover:bg-card-2 lg:py-[12px] ${
                      i < tasks.length - 1 ? "border-b border-line" : ""
                    }`}
                  >
                    <div
                      className="grid items-center gap-x-[14px] gap-y-2"
                      style={{ gridTemplateColumns: COLS }}
                    >
                      <div className="flex min-w-0 items-center gap-[11px]">
                        <span
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                          style={{
                            color: t.enabled ? meta.colour : "var(--ink-4)",
                            background: t.enabled ? "var(--accent-soft)" : "var(--card-2)",
                          }}
                        >
                          <Icon size={14} strokeWidth={1.7} />
                        </span>
                        <div className="min-w-0">
                          <div
                            className={`truncate text-[12.5px] font-medium ${t.enabled ? "text-ink" : "text-ink-3"}`}
                          >
                            {t.name}
                          </div>
                          <Link
                            href={`/servers/${t.server.slug}`}
                            className="truncate font-mono text-[9.5px] text-ink-4 hover:text-accent"
                          >
                            {t.server.name}
                          </Link>
                        </div>
                      </div>

                      <span className="font-mono text-[10.5px] text-ink-4">{t.cron}</span>
                      <span className="text-[11.5px] text-ink-3">{describeCron(t.cron)}</span>
                      <span
                        className={`font-mono text-[10.5px] ${t.enabled ? "text-ink-2" : "text-ink-4"}`}
                      >
                        {untilTime(next)}
                      </span>

                      <div className="flex items-center gap-2">
                        <Pill tone={result.tone}>{result.label}</Pill>
                      </div>

                      <RunNowButton id={t.id} name={t.name} />
                      <TaskToggle id={t.id} name={t.name} enabled={t.enabled} />
                    </div>

                    {t.lastRunAt && (
                      <div className="mt-[6px] pl-[38px] font-mono text-[9.5px] text-ink-4">
                        last run {relativeTime(t.lastRunAt)}
                        {t.payload ? ` · ${t.payload}` : ""}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
