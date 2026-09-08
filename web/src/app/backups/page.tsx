import Link from "next/link";
import { Archive, Clock, Upload } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Badge, Card, Label, Meter, Pill } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { nextRun } from "@/lib/cron";
import { settleStale } from "@/lib/daemon-sim";
import {
  formatBytes,
  getBackupStorage,
  getBackups,
  getServers,
  getTasks,
  relativeTime,
  untilTime,
} from "@/lib/queries";
import type { Tone } from "@/lib/ui-types";
import { BackupRowActions } from "./backup-row-actions";
import { BackupNowButton } from "./backup-now";

export const dynamic = "force-dynamic";

const STATE_META: Record<string, { tone: Tone; label: string }> = {
  COMPLETE: { tone: "success", label: "Complete" },
  RUNNING: { tone: "warning", label: "Running" },
  FAILED: { tone: "danger", label: "Verify failed" },
  LOCKED: { tone: "info", label: "Locked" },
};

const COLS = "minmax(0,1fr) 108px 104px 92px 140px 128px 104px";

export default async function BackupsPage() {
  const user = await requireUser();
  await settleStale();

  const [backups, storage, tasks, servers] = await Promise.all([
    getBackups(),
    getBackupStorage(),
    getTasks(),
    getServers(),
  ]);

  const backupTask = tasks.find((t) => t.kind === "BACKUP" && t.enabled);
  const untilNext = untilTime(backupTask ? nextRun(backupTask.cron) : null, "not scheduled");

  return (
    <AppShell crumbs={["Ashfold", "Backups"]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Backups</h1>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              Snapshots are taken without pausing ticks and verified against a checksum before the
              retention clock starts.
            </p>
          </div>
          <div className="flex shrink-0 gap-2 lg:ml-auto">
            <button
              type="button"
              disabled
              title="Not wired up yet"
              className="inline-flex shrink-0 items-center gap-[7px] rounded-[9px] border border-line bg-card px-4 py-[9px] text-[13px] font-medium text-ink-2 opacity-45"
            >
              <Upload size={14} strokeWidth={1.9} />
              Restore from file
            </button>
            <BackupNowButton servers={servers.map((s) => ({ slug: s.slug, name: s.name }))} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-[10px] border-b border-line px-[18px] py-[13px]">
              <h2 className="text-[13.5px] font-semibold">Snapshots</h2>
              <span className="font-mono text-[10.5px] text-ink-4">
                {storage.count} kept · {storage.usedGb.toFixed(0)} GB of {storage.poolGb} GB pool
              </span>
            </div>

            {backups.length === 0 ? (
              <div className="px-6 py-[52px] text-center">
                <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
                  <Archive size={20} strokeWidth={1.6} />
                </div>
                <div className="text-[13.5px] font-semibold">No snapshots yet</div>
                <p className="mx-auto mt-2 max-w-[34ch] text-xs leading-relaxed text-ink-4">
                  Take one now, or set a schedule and forget about it.
                </p>
              </div>
            ) : (
              <>
                <div
                  className="hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid"
                  style={{ gridTemplateColumns: COLS }}
                >
                  {["Snapshot", "Server", "Trigger", "Size", "Taken", "State", ""].map((h, i) => (
                    <Label key={h || i} className={i === 6 ? "text-right" : undefined}>
                      {h}
                    </Label>
                  ))}
                </div>

                {backups.map((b, i) => {
                  const meta = STATE_META[b.state] ?? STATE_META.COMPLETE;
                  return (
                    <div
                      key={b.id}
                      className={`grid grid-cols-1 items-center gap-x-[14px] gap-y-2 px-[18px] py-[14px] transition-colors duration-150 hover:bg-card-2 lg:py-[11px] ${
                        i < backups.length - 1 ? "border-b border-line" : ""
                      }`}
                      style={{ gridTemplateColumns: undefined }}
                    >
                      <div className="contents lg:hidden">
                        <div className="flex items-center gap-[10px]">
                          <Archive size={15} strokeWidth={1.7} className="shrink-0 text-ink-4" />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{b.name}</span>
                          <Pill tone={meta.tone}>{meta.label}</Pill>
                        </div>
                        <div className="flex items-center gap-3 font-mono text-[10.5px] text-ink-4">
                          <span>{b.server.name}</span>
                          <span>{formatBytes(b.sizeBytes)}</span>
                          <span>{relativeTime(b.createdAt)}</span>
                          <span className="ml-auto">
                            <BackupRowActions id={b.id} name={b.name} locked={b.state === "LOCKED"} />
                          </span>
                        </div>
                      </div>

                      <div
                        className="hidden gap-[14px] lg:grid lg:items-center"
                        style={{ gridTemplateColumns: COLS, gridColumn: "1 / -1" }}
                      >
                        <div className="flex min-w-0 items-center gap-[10px]">
                          <Archive size={15} strokeWidth={1.7} className="shrink-0 text-ink-4" />
                          <span className="min-w-0 truncate font-mono text-xs">{b.name}</span>
                        </div>
                        <Link
                          href={`/servers/${b.server.slug}`}
                          className="truncate text-[11.5px] text-ink-3 hover:text-accent"
                        >
                          {b.server.name}
                        </Link>
                        <div>
                          <Badge tone={b.trigger === "SCHEDULED" ? "accent" : "muted"}>
                            {b.trigger === "SCHEDULED" ? "Scheduled" : "Manual"}
                          </Badge>
                        </div>
                        <span className="font-mono text-[10.5px] text-ink-3 tnum">
                          {formatBytes(b.sizeBytes)}
                        </span>
                        <span className="text-[11.5px] text-ink-4">{relativeTime(b.createdAt)}</span>
                        <div>
                          <Pill tone={meta.tone}>{meta.label}</Pill>
                        </div>
                        <BackupRowActions id={b.id} name={b.name} locked={b.state === "LOCKED"} />
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </Card>

          <div className="flex flex-col gap-4">
            <Card className="px-5 py-[18px]">
              <div className="mb-[14px] flex items-baseline gap-[10px]">
                <h2 className="text-[13.5px] font-semibold">Schedule</h2>
                <Link href="/scheduler" className="ml-auto text-[11.5px] text-accent hover:underline">
                  Edit
                </Link>
              </div>

              {backupTask ? (
                <div className="mb-3 flex items-center gap-[10px] rounded-[10px] border border-line bg-bg-2 px-3 py-[11px]">
                  <Clock size={15} strokeWidth={1.7} className="shrink-0 text-accent" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{backupTask.name}</div>
                    <div className="mt-[2px] font-mono text-[10px] text-ink-4">
                      {backupTask.cron} · next {untilNext}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mb-3 text-[11.5px] leading-relaxed text-ink-4">
                  No backup task is enabled. Nothing is being taken automatically.
                </p>
              )}

              {(
                [
                  ["Keep daily", "7"],
                  ["Keep weekly", "4"],
                  ["Keep monthly", "6"],
                  ["Verify checksum", "on"],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-[10px] border-b border-line py-2">
                  <span className="flex-1 text-[11.5px] text-ink-4">{k}</span>
                  <span className="font-mono text-[11.5px]">{v}</span>
                </div>
              ))}
            </Card>

            <Card className="px-5 py-[18px]">
              <h2 className="mb-4 text-[13.5px] font-semibold">Storage pool</h2>
              <div className="flex items-center gap-[18px]">
                <div className="relative h-[88px] w-[88px] shrink-0">
                  <svg
                    viewBox="0 0 100 100"
                    className="h-[88px] w-[88px] -rotate-90"
                    role="img"
                    aria-label={`${storage.pct}% of the backup pool used`}
                  >
                    <circle cx="50" cy="50" r="40" fill="none" stroke="var(--card-2)" strokeWidth="12" />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="12"
                      strokeLinecap="round"
                      strokeDasharray={`${(storage.pct / 100) * 251} 251`}
                    />
                  </svg>
                  <div className="absolute inset-0 grid place-items-center">
                    <span className="font-mono text-[15px] font-semibold tnum">{storage.pct}%</span>
                  </div>
                </div>
                <div className="flex min-w-0 flex-col gap-[9px]">
                  {(
                    [
                      ["Snapshots", `${storage.usedGb.toFixed(1)} GB`, "var(--accent)"],
                      ["Free", `${storage.freeGb.toFixed(0)} GB`, "var(--card-2)"],
                    ] as const
                  ).map(([k, v, colour]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-[2px]"
                        style={{ background: colour }}
                      />
                      <span className="flex-1 text-[11.5px] text-ink-3">{k}</span>
                      <span className="font-mono text-[11px] text-ink-2 tnum">{v}</span>
                    </div>
                  ))}
                  <p className="mt-[6px] text-[11px] leading-snug text-ink-4">
                    Retention frees roughly 3.3 GB a day once the daily window fills.
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <Meter value={storage.pct} colour="var(--accent)" height={4} />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
