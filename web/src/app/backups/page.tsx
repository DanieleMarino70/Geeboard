import Link from "next/link";
import { Archive, Clock, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/shell";
import { ServerSwitcher } from "@/components/server-switcher";
import { ServerTabs } from "@/components/server-tabs";
import { Badge, Card, Label, Meter, Pill } from "@/components/ui";
import { can } from "@/domain/access/permissions";
import { requireUser } from "@/lib/auth";
import { nextRun } from "@/lib/cron";
import { settleStale } from "@/lib/daemon-sim";
import { formatBytes } from "@/lib/format";
import { getBackupStorage, getBackups, getServers, getTasks, relativeTime, untilTime } from "@/lib/queries";
import { storageStatus } from "@/lib/storage-ops";
import type { Tone } from "@/lib/ui-types";
import { BackupRowActions } from "./backup-row-actions";
import { BackupNowButton } from "./backup-now";
import { StorageSettings } from "./storage-settings";

export const dynamic = "force-dynamic";

const STATE_META: Record<string, { tone: Tone; label: string }> = {
  COMPLETE: { tone: "success", label: "Complete" },
  RUNNING: { tone: "warning", label: "Running" },
  // Any failure to make the archive, not only a verification — the one
  // found on a real node failed while writing it.
  FAILED: { tone: "danger", label: "Failed" },
  LOCKED: { tone: "info", label: "Locked" },
};
// Read back where it lies, and not what was written.
const DAMAGED: { tone: Tone; label: string } = { tone: "danger", label: "Damaged" };

// A pre-update backup used to be labelled "Manual", which nobody took.
const TRIGGER: Record<string, { tone: Tone; label: string }> = {
  SCHEDULED: { tone: "accent", label: "Scheduled" },
  MANUAL: { tone: "muted", label: "Manual" },
  PRE_UPDATE: { tone: "info", label: "Before update" },
  PRE_DELETE: { tone: "warning", label: "Before delete" },
};

/* Sized to fit beside the side panel at an ordinary laptop width. The
   fixed widths before left the snapshot name no room at all. */
const COLS = "minmax(0,1.3fr) minmax(0,1fr) 96px 64px 72px 84px 112px";

export default async function BackupsPage({ searchParams }: { searchParams: Promise<{ server?: string }> }) {
  const user = await requireUser();
  await settleStale();
  const { server: requested } = await searchParams;

  const servers = await getServers();
  const selected = servers.find((s) => s.slug === requested) ?? null;
  const [allBackups, storage, tasks, offsite] = await Promise.all([
    getBackups(selected?.slug),
    getBackupStorage(),
    getTasks(selected?.slug),
    storageStatus(),
  ]);
  const canManageStorage = user.role === "OWNER" || user.role === "ADMIN";
  // A deleted server's backups are shown to whoever could read them before.
  const backups = allBackups.filter((b) => b.server !== null || can(user, "server.backup.read", b.originOwnerId));

  // Only the servers this person may back up are offered.
  const backupable = (selected ? [selected] : servers)
    .filter((s) => can(user, "server.backup.write", s.ownerId))
    .map((s) => ({ slug: s.slug, name: s.name }));

  const backupTask = tasks.find((t) => t.kind === "BACKUP" && t.enabled);
  const untilNext = untilTime(backupTask ? nextRun(backupTask.cron) : null, "not scheduled");

  /* What actually prunes old archives. The same rule the task itself uses:
     a number in the payload, falling back to seven rather than to zero —
     a cleanup that misreads its own configuration must not delete
     everything. See pruneBackups in server-ops.ts. */
  const cleanupTask = tasks.find((t) => t.kind === "CLEANUP" && t.enabled);
  const verifyTask = tasks.find((t) => t.kind === "VERIFY" && t.enabled);
  const keepCount = Number(/\d+/.exec(cleanupTask?.payload ?? "")?.[0] ?? 7);
  const schedulerHref = selected ? `/scheduler?server=${selected.slug}` : "/scheduler";
  const scope = selected ? selected.name : "any server";

  return (
    <AppShell
      crumbs={selected ? [{ label: selected.name, href: `/servers/${selected.slug}` }, "Backups"] : ["Backups"]}
      user={user}
    >
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Backups</h1>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              The world is flushed to disk, archived on its node, and hashed as it is written. A
              restore checks that hash before it replaces anything.
              {offsite.configured
                ? " Off-site archives go to your bucket and can be restored onto any node."
                : " Archives stay on the node that made them until a bucket is configured."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:ml-auto lg:shrink-0">
            <BackupNowButton servers={backupable} offsite={offsite.configured} />
          </div>
        </div>

        {selected && <ServerTabs slug={selected.slug} active="backups" />}
        <ServerSwitcher servers={servers} current={selected?.slug ?? null} basePath="/backups" allLabel="All servers" />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-[10px] border-b border-line px-[18px] py-[13px]">
              <h2 className="text-[13.5px] font-semibold">Snapshots</h2>
              <span className="font-mono text-[10.5px] text-ink-4">
                {backups.length} shown
                {selected ? "" : ` · ${storage.count} kept · ${storage.usedGb.toFixed(1)} GB`}
              </span>
            </div>

            {backups.length === 0 ? (
              <div className="px-6 py-[52px] text-center">
                <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
                  <Archive size={20} strokeWidth={1.6} />
                </div>
                <div className="text-[13.5px] font-semibold">No snapshots yet</div>
                <p className="mx-auto mt-2 max-w-[38ch] text-xs leading-relaxed text-ink-4">
                  {servers.length === 0 ? (
                    <>
                      Backups belong to a server, and there is none yet.{" "}
                      <Link href="/servers/new" className="text-accent hover:underline">
                        Create one
                      </Link>
                      .
                    </>
                  ) : (
                    "Take one now, or schedule them and forget about it."
                  )}
                </p>
              </div>
            ) : (
              <>
                <div
                  className="hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid"
                  style={{ gridTemplateColumns: COLS }}
                >
                  {["Snapshot", "Server", "Trigger", "Size", "Taken", "State", ""].map((h, i) => (
                    <Label key={`${h}-${i}`} className={i === 6 ? "text-right" : undefined}>
                      {h}
                    </Label>
                  ))}
                </div>

                {backups.map((b, i) => {
                  /* An archive found damaged says so in place of its state:
                     "Locked" is no comfort about a backup that will not
                     restore. */
                  const damaged = Boolean(b.verifyError);
                  const meta = damaged ? DAMAGED : (STATE_META[b.state] ?? STATE_META.COMPLETE);
                  const trigger = TRIGGER[b.trigger] ?? TRIGGER.MANUAL;
                  const failed = b.state === "FAILED";
                  /* Its server was deleted and it is still in the bucket.
                     It can go into any server of the game it came from. */
                  const orphan = b.server === null;
                  const serverName = b.server?.name ?? b.originServerName ?? "a deleted server";
                  const actions = (
                    <BackupRowActions
                      id={b.id}
                      name={b.name}
                      serverName={serverName}
                      locked={b.state === "LOCKED"}
                      failed={failed}
                      offsite={b.store === "S3"}
                      targets={
                        orphan
                          ? servers
                              .filter((s) => s.gameId !== null && s.gameId === b.originGameId)
                              .filter((s) => can(user, "server.backup.write", s.ownerId))
                              .map((s) => ({ slug: s.slug, name: s.name }))
                          : undefined
                      }
                    />
                  );
                  return (
                    <div
                      key={b.id}
                      className={`grid grid-cols-1 items-center gap-x-[14px] gap-y-2 px-[18px] py-[14px] transition-colors duration-150 hover:bg-card-2 lg:py-[11px] ${
                        i < backups.length - 1 ? "border-b border-line" : ""
                      }`}
                    >
                      <div className="contents lg:hidden">
                        <div className="flex items-center gap-[10px]">
                          <Archive size={15} strokeWidth={1.7} className="shrink-0 text-ink-4" />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{b.name}</span>
                          <Pill tone={meta.tone}>{meta.label}</Pill>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 font-mono text-[10.5px] text-ink-4">
                          <span>{orphan ? `${serverName} · deleted` : serverName}</span>
                          <span>{trigger.label}</span>
                          {!failed && <span>{formatBytes(b.sizeBytes)}</span>}
                          <span>{relativeTime(b.createdAt)}</span>
                          {actions}
                        </div>
                      </div>

                      <div className="hidden gap-[14px] lg:grid lg:items-center" style={{ gridTemplateColumns: COLS, gridColumn: "1 / -1" }}>
                        <div className="flex min-w-0 items-center gap-[10px]">
                          <Archive size={15} strokeWidth={1.7} className="shrink-0 text-ink-4" />
                          <span className="min-w-0 truncate font-mono text-xs">{b.name}</span>
                        </div>
                        {b.server ? (
                          <Link href={`/servers/${b.server.slug}`} className="truncate text-[11.5px] text-ink-3 hover:text-accent">
                            {serverName}
                          </Link>
                        ) : (
                          <span className="truncate text-[11.5px] text-ink-4" title="The server was deleted; this archive is still in the bucket">
                            {serverName} <span className="font-mono text-[9.5px]">· deleted</span>
                          </span>
                        )}
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={trigger.tone}>{trigger.label}</Badge>
                          {/* Where the bytes are. Off-site outlives the node. */}
                          {b.store === "S3" && <Badge tone="info">off-site</Badge>}
                        </div>
                        <span className="font-mono text-[10.5px] text-ink-3 tnum">{failed ? "—" : formatBytes(b.sizeBytes)}</span>
                        <span className="text-[11.5px] text-ink-4">{relativeTime(b.createdAt)}</span>
                        <div>
                          <Pill tone={meta.tone}>{meta.label}</Pill>
                          {/* Only when somebody has looked. No date is not
                              "never damaged", it is "never checked". */}
                          {b.verifiedAt && !damaged && (
                            <div className="mt-1 font-mono text-[9.5px] text-ink-4" title="Read back and compared with the checksum taken when it was written">
                              verified {relativeTime(b.verifiedAt)}
                            </div>
                          )}
                        </div>
                        {actions}
                      </div>

                      {damaged && (
                        <p className="text-[11px] leading-snug text-danger lg:pl-[25px]" style={{ gridColumn: "1 / -1" }}>
                          {b.verifyError} Found {relativeTime(b.verifiedAt ?? b.createdAt)}. A restore from it will be refused.
                        </p>
                      )}

                      {/* Why it failed, on the row. It used to be only in the activity log. */}
                      {failed && (
                        <p className="text-[11px] leading-snug text-danger lg:pl-[25px]" style={{ gridColumn: "1 / -1" }}>
                          {b.error ?? "No reason was recorded for this failure."}
                        </p>
                      )}
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
                <Link href={schedulerHref} className="ml-auto text-[11.5px] text-accent hover:underline">
                  {backupTask || cleanupTask ? "Edit in Scheduler" : "Add in Scheduler"}
                </Link>
              </div>

              {backupTask ? (
                <div className="mb-3 flex items-center gap-[10px] rounded-[10px] border border-line bg-bg-2 px-3 py-[11px]">
                  <Clock size={15} strokeWidth={1.7} className="shrink-0 text-accent" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium">
                      {backupTask.name}
                      {!selected && <span className="font-normal text-ink-4"> · {backupTask.server.name}</span>}
                    </div>
                    <div className="mt-[2px] font-mono text-[10px] text-ink-4">
                      {backupTask.cron} · next {untilNext}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mb-3 text-[11.5px] leading-relaxed text-ink-4">
                  No backup task is enabled for {scope}. Nothing is being taken automatically.
                </p>
              )}

              {cleanupTask ? (
                <div className="flex items-center gap-[10px] rounded-[10px] border border-line bg-bg-2 px-3 py-[11px]">
                  <Clock size={15} strokeWidth={1.7} className="shrink-0 text-ink-3" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{cleanupTask.name}</div>
                    <div className="mt-[2px] font-mono text-[10px] text-ink-4">
                      keeps the newest {keepCount} · {cleanupTask.cron}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-[11.5px] leading-relaxed text-ink-4">
                  Nothing deletes old backups for {scope}. A &ldquo;Delete old backups&rdquo; task in the
                  scheduler keeps the newest few.
                </p>
              )}

              {verifyTask ? (
                <div className="mt-3 flex items-center gap-[10px] rounded-[10px] border border-line bg-bg-2 px-3 py-[11px]">
                  <ShieldCheck size={15} strokeWidth={1.7} className="shrink-0 text-success" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{verifyTask.name}</div>
                    <div className="mt-[2px] font-mono text-[10px] text-ink-4">
                      {/\bdownload\b/i.test(verifyTask.payload ?? "") ? "re-hashes every archive" : "re-hashes archives on the node"} ·{" "}
                      {verifyTask.cron}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-[11.5px] leading-relaxed text-ink-4">
                  Nothing re-reads the archives of {scope} while they sit there, so a damaged one is
                  found at the restore. A &ldquo;Verify backups&rdquo; task in the scheduler finds it sooner.
                </p>
              )}

              <p className="mt-3 text-[11px] leading-relaxed text-ink-4">
                A locked backup is never counted or removed by a cleanup — locking is you saying
                &ldquo;this one specifically&rdquo;, and a policy that overrode it would make locking
                meaningless.
              </p>
            </Card>

            <Card className="px-5 py-[18px]">
              <h2 className="mb-1 text-[13.5px] font-semibold">Off-site storage</h2>
              <p className="mb-3 text-[11px] leading-relaxed text-ink-4">
                An S3-compatible bucket. A node streams each archive straight to it on a signed URL and
                never holds the keys; a machine that dies leaves its off-site backups behind, and any node
                can restore them.
              </p>
              <StorageSettings
                canManage={canManageStorage}
                storage={{
                  ...offsite,
                  checkedAt: offsite.configured ? offsite.checkedAt?.toISOString() ?? null : null,
                  offsiteGb: offsite.offsiteBytes / 1024 ** 3,
                }}
              />
            </Card>

            <Card className="px-5 py-[18px]">
              <h2 className="mb-1 text-[13.5px] font-semibold">On the nodes</h2>
              <p className="mb-4 text-[11px] leading-relaxed text-ink-4">
                Archives kept on the node that made them. A machine that dies takes these with it.
              </p>
              <div className="flex items-center gap-[18px]">
                <div className="relative h-[88px] w-[88px] shrink-0">
                  <svg
                    viewBox="0 0 100 100"
                    className="h-[88px] w-[88px] -rotate-90"
                    role="img"
                    aria-label={`Backups take ${storage.pct}% of node disk`}
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
                      ["All snapshots", `${storage.usedGb.toFixed(1)} GB`, "var(--accent)"],
                      ["Node disk", `${storage.diskGb} GB`, "var(--card-2)"],
                    ] as const
                  ).map(([k, v, colour]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: colour }} />
                      <span className="flex-1 text-[11.5px] text-ink-3">{k}</span>
                      <span className="font-mono text-[11px] text-ink-2 tnum">{v}</span>
                    </div>
                  ))}
                  <p className="mt-[6px] text-[11px] leading-snug text-ink-4">
                    Measured against the disks of the nodes in service. Game worlds share them.
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
