import Link from "next/link";
import { Archive, Clock, GitBranch, History, RotateCw, Send, Trash2, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/shell";
import { ServerSwitcher } from "@/components/server-switcher";
import { Card, Label, LinkButton, Pill } from "@/components/ui";
import { can } from "@/domain/access/permissions";
import { findGame } from "@/domain/games/registry";
import { requireUser } from "@/lib/auth";
import { describeCron, nextRun, nextRuns } from "@/lib/cron";
import { getServers, getTasks, relativeTime, untilTime } from "@/lib/queries";
import { TASK_KIND_LABEL } from "@/lib/task-rules";
import type { Tone } from "@/lib/ui-types";
import { RunNowButton, TaskToggle } from "./task-controls";
import { NewTaskButton, TaskRowActions, type TaskServer } from "./task-editor";

export const dynamic = "force-dynamic";

const KIND = {
  BACKUP: { icon: Archive, colour: "var(--accent)" },
  RESTART: { icon: RotateCw, colour: "var(--warning)" },
  BROADCAST: { icon: Send, colour: "var(--info)" },
  CLEANUP: { icon: Trash2, colour: "var(--ink-4)" },
  COMMAND: { icon: GitBranch, colour: "var(--accent-2)" },
} as const;

const RESULT: Record<string, { tone: Tone; label: string }> = {
  SUCCEEDED: { tone: "success", label: "Succeeded" },
  FAILED: { tone: "danger", label: "Failed" },
  SKIPPED: { tone: "muted", label: "Skipped" },
  NEVER_RUN: { tone: "muted", label: "Never run" },
};

const COLS = "minmax(0,1fr) 110px minmax(0,150px) 104px 112px 30px 40px 58px";

export default async function SchedulerPage({
  searchParams,
}: {
  searchParams: Promise<{ server?: string }>;
}) {
  const user = await requireUser();
  const { server: requested } = await searchParams;
  const servers = await getServers();
  const selected = servers.find((s) => s.slug === requested) ?? null;
  const tasks = await getTasks(selected?.slug);

  /* The servers this user may schedule on, with each game's console
     dialect — the form refuses a broadcast on a game that cannot
     broadcast before anybody presses save. */
  const schedulable: TaskServer[] = servers
    .filter((s) => can(user, "server.schedule.write", s.ownerId))
    .map((s) => ({ slug: s.slug, name: s.name, dialect: (s.gameId ? findGame(s.gameId)?.console : undefined) ?? null }));
  const writable = new Set(schedulable.map((s) => s.slug));

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

  // In UTC, like the expressions — these used to be local hours under a
  // heading that said UTC.
  const hourLabels = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(now.getTime() + i * 6 * 3600_000);
    return `${String(d.getUTCHours()).padStart(2, "0")}:00`;
  });

  const failing = tasks.filter((t) => t.enabled && t.lastResult === "FAILED");
  const enabledCount = tasks.filter((t) => t.enabled).length;
  const history = "/audit?actor=Scheduler";

  return (
    <AppShell
      crumbs={selected ? [{ label: selected.name, href: `/servers/${selected.slug}` }, "Scheduler"] : ["Scheduler"]}
      user={user}
    >
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Scheduler</h1>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              Backups, restarts, broadcasts and commands on a schedule. Expressions are evaluated in
              UTC, and the preview shows when each will next fire.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 lg:ml-auto">
            {/* There is no separate run log: each run is an event in the
                audit log, attributed to the Scheduler account. */}
            <LinkButton href={history} intent="secondary" icon={History}>
              Run history
            </LinkButton>
            <NewTaskButton servers={schedulable} defaultServer={selected?.slug ?? null} />
          </div>
        </div>

        <ServerSwitcher servers={servers} current={selected?.slug ?? null} basePath="/scheduler" allLabel="All servers" />

        <Card className="px-5 py-[18px]">
          <div className="mb-[18px] flex flex-wrap items-baseline gap-3">
            <h2 className="text-[13.5px] font-semibold">Next 24 hours</h2>
            <span className="font-mono text-[10.5px] text-ink-4">
              {marks.length} firing{marks.length === 1 ? "" : "s"} · UTC
            </span>
            <span className="ml-auto flex flex-wrap gap-[14px]">
              {Object.entries(KIND).map(([key, meta]) => (
                <span key={key} className="flex items-center gap-[6px] font-mono text-[10px] text-ink-4">
                  <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: meta.colour }} />
                  {TASK_KIND_LABEL[key as keyof typeof KIND]}
                </span>
              ))}
            </span>
          </div>

          {marks.length === 0 ? (
            <p className="py-6 text-center text-[11.5px] text-ink-4">Nothing is scheduled to run in the next 24 hours.</p>
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
              <div className="absolute top-0 left-0 font-mono text-[9px] tracking-[0.06em] text-accent uppercase">now</div>
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
              {tasks.length} task{tasks.length === 1 ? "" : "s"} · {enabledCount} enabled
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
              <p className="mx-auto mt-2 max-w-[40ch] text-xs leading-relaxed text-ink-4">
                {servers.length === 0 ? (
                  <>
                    A task runs on a server, and there is none yet.{" "}
                    <Link href="/servers/new" className="text-accent hover:underline">
                      Create one
                    </Link>
                    .
                  </>
                ) : (
                  "Nightly backups and a restart before peak hours are what most servers want. New task adds one."
                )}
              </p>
            </div>
          ) : (
            <>
              <div
                className="hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid"
                style={{ gridTemplateColumns: COLS }}
              >
                {["Task", "Cron", "Cadence", "Next run", "Last result", "", "On", ""].map((h, i) => (
                  <Label key={`${h}-${i}`} className={i === 6 ? "text-right" : undefined}>
                    {h}
                  </Label>
                ))}
              </div>

              {tasks.map((t, i) => {
                const meta = KIND[t.kind];
                const Icon = meta.icon;
                const result = RESULT[t.lastResult];
                const next = t.enabled ? nextRun(t.cron) : null;
                const editable = writable.has(t.server.slug);

                return (
                  <div
                    key={t.id}
                    className={`px-[18px] py-[14px] transition-colors duration-150 hover:bg-card-2 lg:py-[12px] ${
                      i < tasks.length - 1 ? "border-b border-line" : ""
                    }`}
                  >
                    {/* A phone gets the same row stacked, not squeezed into eight columns. */}
                    <div className="grid grid-cols-2 items-center gap-x-[14px] gap-y-2 lg:hidden">
                      <TaskTitle t={t} Icon={Icon} colour={meta.colour} />
                      <span className="justify-self-end">
                        <Pill tone={result.tone}>{result.label}</Pill>
                      </span>
                      <span className="col-span-2 font-mono text-[10.5px] text-ink-4">
                        {describeCron(t.cron)} · {t.enabled ? `next ${untilTime(next)}` : "paused"}
                      </span>
                      <span className="col-span-2 flex items-center justify-end gap-2">
                        <RunNowButton id={t.id} name={t.name} />
                        <TaskToggle id={t.id} name={t.name} enabled={t.enabled} />
                        {editable && <TaskRowActions servers={schedulable} task={editableOf(t)} />}
                      </span>
                    </div>

                    <div className="hidden items-center gap-x-[14px] lg:grid" style={{ gridTemplateColumns: COLS }}>
                      <TaskTitle t={t} Icon={Icon} colour={meta.colour} />
                      <span className="font-mono text-[10.5px] text-ink-4">{t.cron}</span>
                      <span className="truncate text-[11.5px] text-ink-3">{describeCron(t.cron)}</span>
                      <span className={`font-mono text-[10.5px] ${t.enabled ? "text-ink-2" : "text-ink-4"}`}>
                        {untilTime(next)}
                      </span>
                      <div>
                        <Pill tone={result.tone}>{result.label}</Pill>
                      </div>
                      <RunNowButton id={t.id} name={t.name} />
                      <span className="justify-self-end">
                        <TaskToggle id={t.id} name={t.name} enabled={t.enabled} />
                      </span>
                      {editable ? <TaskRowActions servers={schedulable} task={editableOf(t)} /> : <span />}
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

type TaskRow = Awaited<ReturnType<typeof getTasks>>[number];

function editableOf(t: TaskRow) {
  return { id: t.id, serverSlug: t.server.slug, name: t.name, kind: t.kind, cron: t.cron, payload: t.payload };
}

function TaskTitle({ t, Icon, colour }: { t: TaskRow; Icon: typeof Archive; colour: string }) {
  return (
    <div className="flex min-w-0 items-center gap-[11px]">
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
        style={{ color: t.enabled ? colour : "var(--ink-4)", background: t.enabled ? "var(--accent-soft)" : "var(--card-2)" }}
      >
        <Icon size={14} strokeWidth={1.7} />
      </span>
      <div className="min-w-0">
        <div className={`truncate text-[12.5px] font-medium ${t.enabled ? "text-ink" : "text-ink-3"}`}>{t.name}</div>
        <Link href={`/servers/${t.server.slug}`} className="truncate font-mono text-[9.5px] text-ink-4 hover:text-accent">
          {t.server.name} · {TASK_KIND_LABEL[t.kind]}
        </Link>
      </div>
    </div>
  );
}
