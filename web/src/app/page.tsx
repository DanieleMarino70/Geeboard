import Link from "next/link";
import { Activity, AlertTriangle, HardDrive, Plus, Server as ServerIcon, Users } from "lucide-react";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { Card, Cover, Label, LinkButton, Meter, Pill, Spark } from "@/components/ui";
import { ServerCardActions } from "@/components/server-actions";
import { isUp } from "@/domain/servers/state";
import { requireUser } from "@/lib/auth";
import { settleStale } from "@/lib/daemon-sim";
import {
  STATE_META,
  TONE_MAP,
  getActivity,
  getDashboardStats,
  getNodes,
  getRecentCpu,
  getServers,
  relativeTime,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const DOT: Record<string, string> = {
  info: "bg-info",
  accent: "bg-accent",
  muted: "bg-ink-4",
  warning: "bg-warning",
  danger: "bg-danger",
  success: "bg-success",
};

export default async function DashboardPage() {
  const user = await requireUser();
  await settleStale();
  const [servers, stats, activity, nodes] = await Promise.all([
    getServers(),
    getDashboardStats(),
    getActivity(3),
    getNodes(),
  ]);
  const cpu = await getRecentCpu(servers.map((s) => s.id));

  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const strained = nodes.find((n) => n.ramPct > 85 || n.cpuPct > 85);

  /* Every figure here is read from somewhere. The design's tiles carried
     trend chips — "+21% vs last Saturday", "7 days without an incident" —
     that were written into this file, and they said the same thing on an
     empty workspace as on a full one. A sub-line now states a fact or
     says what is not measured. */
  const simulated = servers.filter((s) => s.simulated).length;
  const tiles = [
    {
      icon: ServerIcon,
      label: "Servers online",
      value: String(stats.up),
      unit: `of ${stats.total}`,
      sub:
        simulated > 0
          ? `${simulated} simulated, on nodes with no agent`
          : stats.total === 0
            ? "none created yet"
            : "as the poller last saw them",
    },
    {
      icon: Users,
      label: "Players now",
      value: String(stats.playersOnline),
      unit: `of ${stats.playersMax} slots`,
      sub: "read from consoles of games that log joins",
    },
    {
      icon: Activity,
      label: "Nodes",
      value: String(stats.nodesInService),
      unit: "in service",
      sub:
        stats.nodesPending > 0
          ? `${stats.nodesPending} waiting for approval`
          : stats.nodesInService === 0
            ? "add one to create servers"
            : `${stats.nodesHealthy} healthy · ${stats.nodesWithAgent} with an agent`,
    },
    {
      icon: HardDrive,
      label: "Storage",
      value: String(stats.storageGb),
      unit: "GB committed",
      sub: "promised to servers, not used",
    },
  ];

  return (
    <AppShell crumbs={["Dashboard"]} user={shellUser(user)}>
      {/* Clipped: the decorative glow below is wider than a phone, and
          without this it pushed the page 120px sideways. */}
      <div className="relative flex flex-col gap-5 overflow-x-clip px-5 py-[26px] sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-[180px] -right-[120px] h-[360px] w-[520px] rounded-full"
          style={{ background: "radial-gradient(closest-side, var(--accent-soft), transparent)" }}
        />

        <div className="relative flex flex-col items-start gap-5 md:flex-row md:items-end">
          <div className="min-w-0">
            <h1 className="text-[clamp(24px,3.4vw,30px)] leading-[1.1] font-semibold tracking-[-0.025em]">
              Good {partOfDay}, {user.name.split(" ")[0]}
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
              {stats.total === 0
                ? stats.nodesInService === 0
                  ? "Nothing here yet. Attach a machine as a node, then create a server on it."
                  : "No servers yet. Your nodes are ready for one."
                : `${stats.up} of ${stats.total} server${stats.total === 1 ? " is" : "s are"} up.`}
              {strained ? ` ${strained.city || strained.name} is the one to watch.` : ""}
            </p>
          </div>
          {/* No "Import a server": nothing adopts a server that was not
              created here, and the button did nothing. */}
          <div className="flex shrink-0 gap-2 md:ml-auto">
            <LinkButton href="/servers/new" icon={Plus}>Create server</LinkButton>
          </div>
        </div>

        <div className="relative grid grid-cols-2 gap-4 xl:grid-cols-4">
          {tiles.map((t) => (
            <Card key={t.label} hover className="p-5">
              <div className="mb-[14px] flex items-center gap-2">
                <span className="grid place-items-center text-ink-4">
                  <t.icon size={14} strokeWidth={1.7} />
                </span>
                <Label>{t.label}</Label>
              </div>
              <div className="flex items-end gap-2">
                <div className="text-[30px] leading-none font-semibold tracking-[-0.03em] tnum">
                  {t.value}
                </div>
                <div className="pb-[3px] text-xs text-ink-4">{t.unit}</div>
              </div>
              <div className="mt-3 text-[11.5px] text-ink-4">{t.sub}</div>
            </Card>
          ))}
        </div>

        <div className="relative grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_348px]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Your servers</h2>
              <span className="font-mono text-[11px] text-ink-4">
                {stats.total} total · {stats.up} up
              </span>
              <Link href="/servers" className="ml-auto text-[12.5px] text-accent hover:underline">
                Manage all
              </Link>
            </div>
            {servers.length === 0 && (
              <Card className="flex flex-col items-start gap-3 p-5">
                <p className="text-[12.5px] leading-relaxed text-ink-3">
                  {stats.nodesInService === 0
                    ? "A server runs on a node, and there is no node yet."
                    : "Pick a game and a node, and the panel installs it there."}
                </p>
                <LinkButton
                  href={stats.nodesInService === 0 ? "/nodes" : "/servers/new"}
                  size="sm"
                  icon={Plus}
                >
                  {stats.nodesInService === 0 ? "Add a node" : "Create server"}
                </LinkButton>
              </Card>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {servers.map((s) => {
                const meta = STATE_META[s.state];
                const colour =
                  meta.tone === "danger"
                    ? "hsl(0 72% 62%)"
                    : meta.tone === "warning"
                      ? "hsl(38 94% 58%)"
                      : isUp(s.state)
                        ? "hsl(80 72% 60%)"
                        : "hsl(228 10% 56%)";
                // The last hour's CPU, 0% at the bottom of the 28-unit box and 100% near its top.
                const series = cpu.get(s.id);
                const spark = series?.map((pct) => 26 - (pct / 100) * 22);

                return (
                  <Card key={s.id} hover className="overflow-hidden">
                    <div className="flex items-start gap-[13px] p-[18px]">
                      <Cover tag={s.art} game={s.gameId} />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/servers/${s.slug}`}
                          className="block truncate text-[14.5px] font-semibold tracking-[-0.015em] hover:text-accent"
                        >
                          {s.name}
                        </Link>
                        <div className="mt-1 font-mono text-[10px] text-ink-4">{s.version}</div>
                        <div className="mt-[9px] flex items-center gap-[7px]">
                          <Pill tone={meta.tone} pulse={meta.pulse}>
                            {meta.label}
                          </Pill>
                          <span className="font-mono text-[10.5px] text-ink-3 tnum">
                            {s.playersOn} / {s.playersMax}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="px-[18px] pb-3" title="CPU over the last hour">
                      {spark ? (
                        <Spark points={spark} colour={colour} id={`sp-${s.slug}`} />
                      ) : (
                        <div className="flex h-7 items-center font-mono text-[10px] text-ink-4">
                          no usage recorded in the last hour
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-px border-t border-line bg-(--border)">
                      {(
                        [
                          ["CPU", s.cpuPct, "var(--accent)"],
                          ["RAM", s.ramPct, "var(--info)"],
                          ["DISK", s.diskPct, "var(--ink-4)"],
                        ] as const
                      ).map(([k, v, c]) => (
                        <div key={k} className="bg-card px-[13px] py-[11px]">
                          <div className="mb-[6px] flex justify-between">
                            <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-ink-4">
                              {k}
                            </span>
                            <span className="font-mono text-[10px] text-ink-2 tnum">{v}%</span>
                          </div>
                          <Meter value={v} colour={c} height={3} />
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 border-t border-line bg-bg-2 px-[18px] py-[10px]">
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-4">
                        {s.host}:{s.port}
                      </span>
                      <ServerCardActions
                        slug={s.slug}
                        name={s.name}
                        running={isUp(s.state)}
                      />
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <Card className="px-5 py-[18px]">
              <div className="mb-4 flex items-baseline gap-[10px]">
                <h2 className="text-[13.5px] font-semibold">Activity</h2>
                <Link href="/activity" className="ml-auto text-[11.5px] text-accent hover:underline">
                  All events
                </Link>
              </div>
              {activity.length === 0 && (
                <p className="text-[11.5px] leading-relaxed text-ink-4">Nothing has happened yet.</p>
              )}
              {activity.map((a, i) => (
                <div key={a.id} className="flex gap-[13px] pb-3 last:pb-0">
                  <div className="relative flex w-[9px] shrink-0 justify-center pt-[5px]">
                    <span
                      className={`z-1 h-[7px] w-[7px] shrink-0 rounded-full shadow-[0_0_0_3px_var(--card)] ${DOT[TONE_MAP[a.tone]]}`}
                    />
                    {i < activity.length - 1 && (
                      <span className="absolute top-3 -bottom-3 w-px bg-(--border)" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] leading-snug text-ink-2">
                      <span className="font-medium text-ink">{a.actor}</span> {a.action}
                      {a.target ? <span className="text-ink-3"> · {a.target}</span> : null}
                    </div>
                    <div className="mt-[3px] font-mono text-[10px] text-ink-4">
                      {relativeTime(a.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </Card>

            <Card className="px-5 py-[18px]">
              <div className="mb-1 flex items-baseline gap-[10px]">
                <h2 className="text-[13.5px] font-semibold">Node health</h2>
                <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                  {nodes.length} node{nodes.length === 1 ? "" : "s"}
                </span>
              </div>
              {nodes.length === 0 && (
                <p className="py-2 text-[11.5px] leading-relaxed text-ink-4">
                  No nodes.{" "}
                  <Link href="/nodes" className="text-accent hover:underline">
                    Add one
                  </Link>
                  .
                </p>
              )}
              {nodes.map((n) => {
                const healthy = n.state === "HEALTHY";
                return (
                  <div key={n.id} className="flex flex-col gap-[9px] border-b border-line py-3">
                    <div className="flex items-center gap-[9px]">
                      <span
                        className={`h-[6px] w-[6px] shrink-0 rounded-full ${
                          healthy
                            ? "bg-success"
                            : "animate-(--animate-pulse-dot) bg-warning text-warning"
                        }`}
                      />
                      <span className="font-mono text-[11.5px] font-medium">{n.name}</span>
                      <span className="text-[11px] text-ink-4">{n.city}</span>
                      <span className="ml-auto font-mono text-[10.5px] text-ink-3 tnum">
                        {n.pingMs} ms
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-[10px]">
                      {(
                        [
                          ["CPU", n.cpuPct],
                          ["RAM", n.ramPct],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k}>
                          <div className="mb-[5px] flex justify-between font-mono text-[9.5px] text-ink-4">
                            <span>{k}</span>
                            <span className="text-ink-2 tnum">{v}%</span>
                          </div>
                          <Meter
                            value={v}
                            colour={v > 80 ? "var(--warning)" : "var(--accent)"}
                            height={3}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {strained ? (
                <div className="flex items-center gap-2 pt-3">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-warning-soft text-warning">
                    <AlertTriangle size={12} strokeWidth={2} />
                  </span>
                  <span className="text-[11.5px] leading-snug text-ink-3">
                    {strained.city} at {Math.max(strained.ramPct, strained.cpuPct)}% — consider
                    draining.
                  </span>
                </div>
              ) : null}
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
