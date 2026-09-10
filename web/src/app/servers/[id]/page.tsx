import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Cpu, Globe, Terminal, Users } from "lucide-react";
import { AppShell } from "@/components/shell";
import { ServerControls } from "@/components/server-actions";
import { Card, Cover, Pill } from "@/components/ui";
import { outlookFor } from "@/domain/games/versions";
import { requireUser } from "@/lib/auth";
import { storedCatalog } from "@/lib/catalog-read";
import { settleStale } from "@/lib/daemon-sim";
import { CONSOLE_LOG, LOG_COLOUR } from "@/lib/console-fixture";
import {
  STATE_META,
  formatBytes,
  getServerBySlug,
  getUsageSeries,
  relativeTime,
  uptimeFrom,
} from "@/lib/queries";
import { VersionPanel } from "./version-panel";

export const dynamic = "force-dynamic";

const TABS = [
  "Overview",
  "Console",
  "Files",
  "Backups",
  "Scheduler",
  "Players",
  "Plugins",
  "Settings",
];

export default async function ServerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  await settleStale();
  const { id } = await params;
  const server = await getServerBySlug(id);
  if (!server) notFound();

  const usage = await getUsageSeries(server.id);

  /* Read from the catalog tables, so drawing this page never waits on
     Steam or Mojang. The sync is what keeps them current. */
  const catalog = server.gameId ? await storedCatalog(server.gameId) : null;
  const outlook = catalog
    ? outlookFor(catalog, {
        versionId: server.gameVersionRef?.slug ?? null,
        buildId: server.installedBuildId,
      })
    : null;
  const meta = STATE_META[server.state];
  const uptime = uptimeFrom(server.startedAt);

  const facts = [
    ["Node", server.node.name, `${server.node.city} · ${server.node.pingMs} ms`],
    ["Address", server.host, `port ${server.port}`],
    ["Version", server.version, server.game],
    ["Uptime", uptime, server.startedAt ? `since ${server.startedAt.toLocaleDateString("en-GB")}` : "not running"],
    ["World size", server.worldSize, `${server.diskQuota} GB quota`],
    ["Owner", server.owner.name, `${server.memoryLimit} GB · ${server.cpuLimit}% CPU`],
  ] as const;

  return (
    <AppShell crumbs={["Ashfold", "Servers", server.name]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row">
          <Cover tag={server.art} size={52} radius={13} />
          <div className="min-w-0">
            <div className="flex items-center gap-[10px]">
              <h1 className="text-[clamp(22px,2.8vw,26px)] font-semibold tracking-[-0.025em]">
                {server.name}
              </h1>
              <Pill tone={meta.tone} pulse={meta.pulse}>
                {meta.label}
              </Pill>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-[14px] gap-y-2 font-mono text-[11px] text-ink-4">
              <span className="flex items-center gap-[6px]">
                <Globe size={13} strokeWidth={1.7} />
                {server.host}:{server.port}
              </span>
              <span className="flex items-center gap-[6px]">
                <Cpu size={13} strokeWidth={1.7} />
                {server.node.name}
              </span>
              <span className="flex items-center gap-[6px]">
                <Clock size={13} strokeWidth={1.7} />
                up {uptime}
              </span>
              <span className="flex items-center gap-[6px]">
                <Users size={13} strokeWidth={1.7} />
                {server.playersOn} / {server.playersMax} online
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 lg:ml-auto">
            <ServerControls
              slug={server.slug}
              running={server.state === "RUNNING" || server.state === "STARTING"}
            />
          </div>
        </div>

        <div
          role="tablist"
          className="-mx-5 flex gap-[2px] overflow-x-auto border-b border-line px-5 sm:-mx-8 sm:px-8"
        >
          {TABS.map((t, i) => {
            const on = i === 0;
            const cls = `relative shrink-0 px-[15px] pt-[11px] pb-[13px] text-[12.5px] transition-colors duration-150 ${
              on ? "font-medium text-ink" : "text-ink-3 hover:text-ink-2"
            }`;
            const underline = (
              <span
                className={`absolute inset-x-2 -bottom-px h-[2px] rounded-[2px] ${on ? "bg-accent" : "bg-transparent"}`}
              />
            );
            return t === "Console" ? (
              <Link key={t} href={`/console?server=${server.slug}`} className={cls}>
                {t}
                {underline}
              </Link>
            ) : (
              <button key={t} type="button" role="tab" aria-selected={on} className={cls}>
                {t}
                {underline}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="flex flex-col p-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-[13.5px] font-semibold">Resource usage</h2>
                <div className="ml-auto flex flex-wrap items-center gap-[14px]">
                  <span className="flex items-center gap-[6px] font-mono text-[10px] text-ink-3">
                    <span className="h-[2px] w-2 rounded-[2px] bg-accent" />
                    CPU {usage?.latest.cpuPct ?? server.cpuPct}%
                  </span>
                  <span className="flex items-center gap-[6px] font-mono text-[10px] text-ink-3">
                    <span className="h-[2px] w-2 rounded-[2px] bg-info" />
                    Memory {usage?.ramGb ?? "—"} GB
                  </span>
                  <div className="inline-flex gap-px rounded-lg bg-(--border) p-px">
                    {["1h", "6h", "24h", "7d"].map((t, i) => (
                      <button
                        key={t}
                        type="button"
                        className={`rounded-[7px] px-[10px] py-1 font-mono text-[10px] transition-colors duration-150 ${
                          i === 0 ? "bg-card-2 text-ink" : "text-ink-4 hover:text-ink-2"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-3 h-[200px]">
                {usage ? (
                  <svg
                    viewBox="0 0 600 170"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label="CPU and memory over the last hour"
                    className="block h-full w-full"
                  >
                    <defs>
                      <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="hsl(80 72% 60%)" stopOpacity="0.22" />
                        <stop offset="1" stopColor="hsl(80 72% 60%)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {[34, 68, 102, 136].map((y) => (
                      <line
                        key={y}
                        x1="0"
                        y1={y}
                        x2="600"
                        y2={y}
                        stroke="var(--border)"
                        strokeWidth="1"
                      />
                    ))}
                    <polygon points={`0,170 ${usage.cpu} 600,170`} fill="url(#cpuFill)" />
                    <polyline
                      points={usage.cpu}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <polyline
                      points={usage.ram}
                      fill="none"
                      stroke="var(--info)"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                ) : (
                  <div className="grid h-full place-items-center rounded-[10px] border border-dashed border-line-2 text-center">
                    <div>
                      <div className="text-[13px] font-semibold">No metrics yet</div>
                      <p className="mx-auto mt-2 max-w-[36ch] text-[11.5px] leading-relaxed text-ink-4">
                        The daemon reports usage once the server has been running for a minute.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {usage ? (
                <div className="mt-2 flex justify-between font-mono text-[9.5px] text-ink-4">
                  {usage.labels.map((t, i) => (
                    <span key={`${t}-${i}`}>{t}</span>
                  ))}
                </div>
              ) : null}
            </Card>

            <div className="overflow-hidden rounded-[14px] border border-line bg-con-bg">
              <div className="flex items-center gap-[9px] border-b border-line bg-bg-2 px-4 py-[10px]">
                <Terminal size={14} strokeWidth={1.7} className="text-ink-4" />
                <span className="font-mono text-[10.5px] text-ink-3">console · tail</span>
                <span className="ml-auto flex items-center gap-[6px] font-mono text-[9.5px] text-success">
                  <span className="h-[5px] w-[5px] animate-(--animate-pulse-dot) rounded-full bg-current" />
                  live
                </span>
                <Link
                  href={`/console?server=${server.slug}`}
                  className="text-[11px] text-accent hover:underline"
                >
                  Open console
                </Link>
              </div>
              <div className="px-4 py-3 font-mono text-[11px] leading-[1.85]">
                {CONSOLE_LOG.slice(-4).map((l) => {
                  const c = LOG_COLOUR[l.level];
                  return (
                    <div key={l.time} className="flex gap-3">
                      <span className="shrink-0 pt-px text-[10.5px] text-con-dim">{l.time}</span>
                      <span
                        className={`w-[46px] shrink-0 text-[10.5px] tracking-[0.04em] ${c.level}`}
                      >
                        {l.level}
                      </span>
                      <span className={`min-w-0 truncate ${c.message}`}>{l.message}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <Card className="px-5 py-[18px]">
              <h2 className="mb-1 text-[13.5px] font-semibold">Details</h2>
              <div className="grid grid-cols-2 gap-x-[18px]">
                {facts.map(([k, v, sub]) => (
                  <div key={k} className="border-b border-line py-3">
                    <div className="mb-[6px] font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-4">
                      {k}
                    </div>
                    <div className="truncate text-[12.5px] font-medium">{v}</div>
                    <div className="mt-[3px] truncate font-mono text-[10px] text-ink-4">{sub}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="px-5 py-[18px]">
              <div className="mb-1 flex items-baseline gap-[10px]">
                <h2 className="text-[13.5px] font-semibold">Players online</h2>
                <span className="ml-auto font-mono text-[10.5px] text-ink-4 tnum">
                  {server.players.length}
                </span>
              </div>
              {server.players.length === 0 ? (
                <p className="py-3 text-[11.5px] leading-relaxed text-ink-4">
                  Nobody is connected. Players appear here the moment they join.
                </p>
              ) : (
                server.players.map((p, i) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-[10px] py-2 ${i < server.players.length - 1 ? "border-b border-line" : ""}`}
                  >
                    <Cover tag="SKIN" size={24} radius={6} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                      {p.username}
                    </span>
                    <span className="font-mono text-[10px] text-ink-4 tnum">{p.pingMs} ms</span>
                  </div>
                ))
              )}
            </Card>

            <Card className="px-5 py-[18px]">
              <div className="mb-1 flex items-baseline gap-[10px]">
                <h2 className="text-[13.5px] font-semibold">Recent backups</h2>
                <Link href="/backups" className="ml-auto text-[11.5px] text-accent hover:underline">
                  All
                </Link>
              </div>
              {server.backups.length === 0 ? (
                <p className="py-3 text-[11.5px] leading-relaxed text-ink-4">
                  No snapshots yet. Take one now, or set a schedule and forget about it.
                </p>
              ) : (
                server.backups.map((b, i) => (
                  <div
                    key={b.id}
                    className={`flex items-center gap-[10px] py-2 ${i < server.backups.length - 1 ? "border-b border-line" : ""}`}
                  >
                    <span
                      className={`h-[5px] w-[5px] shrink-0 rounded-full ${
                        b.state === "COMPLETE"
                          ? "bg-success"
                          : b.state === "FAILED"
                            ? "bg-danger"
                            : "bg-ink-4"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{b.name}</span>
                    <span className="font-mono text-[10px] text-ink-4">
                      {formatBytes(b.sizeBytes)}
                    </span>
                    <span className="w-[56px] text-right text-[10.5px] text-ink-4">
                      {relativeTime(b.createdAt)}
                    </span>
                  </div>
                ))
              )}
            </Card>

            <VersionPanel outlook={outlook} versionLabel={server.version} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
