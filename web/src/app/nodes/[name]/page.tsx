import clsx from "clsx";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Cpu, Globe, Network, Package, SquareTerminal } from "lucide-react";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { Avatar, Badge, Card, Cover, Label, LinkButton, Meter, Pill } from "@/components/ui";
import { can, holds } from "@/domain/access/permissions";
import { Refused } from "@/components/refused";
import { terminalDecision } from "@/domain/access/terminal";
import { terminalOf } from "@/lib/node-ops";
import { nodeAddressView } from "@/lib/dns-ops";
import { CAPABILITY_LABELS, type CapabilityId } from "@/domain/games/types";
import { versionMessage } from "@/domain/nodes/agent-version";
import { retirementOf } from "@/domain/nodes/retirement";
import { nodeAway, nodeSilent } from "@/domain/nodes/away";
import { METRIC_RANGES, isMetricRange, type MetricRange } from "@/domain/metrics/ranges";
import { isUp } from "@/domain/servers/state";
import { UsageChart } from "@/components/usage-chart";
import { nodeChart } from "@/lib/chart-panels";
import { nodeSeries } from "@/lib/metrics";
import { requireUser } from "@/lib/auth";
import { STATE_META, UNKNOWN_META, getNodeByName, relativeTime } from "@/lib/queries";
import type { Tone } from "@/lib/ui-types";
import { PANEL_VERSION } from "@/lib/version";
import { DrainButton } from "../drain-button";
import { ConfigureNode } from "./configure-node";
import { RetireNode } from "./retire-node";
import { RotateAgentToken } from "./rotate-token";

export const dynamic = "force-dynamic";

const NODE_STATE: Record<string, { tone: Tone; label: string; pulse: boolean }> = {
  PENDING: { tone: "info", label: "Pending approval", pulse: true },
  HEALTHY: { tone: "success", label: "Healthy", pulse: false },
  DEGRADED: { tone: "warning", label: "Degraded", pulse: true },
  UNREACHABLE: { tone: "danger", label: "Unreachable", pulse: true },
  DRAINING: { tone: "info", label: "Draining", pulse: true },
  MAINTENANCE: { tone: "muted", label: "Maintenance", pulse: false },
};

/* Sized to fit beside the side panel at an ordinary laptop width. Below
   that the row stacks into two columns: at phone width these six columns
   squeezed the server's name down to nothing. */
const COLS =
  "grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_100px_minmax(56px,110px)_52px_48px]";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  return { title: (await params).name };
}

export default async function NodeDetailPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const { name } = await params;
  const { range: requestedRange } = await searchParams;
  if (!holds(user.role, "node.read")) {
    return <Refused user={shellUser(user)} crumbs={[{ label: "Nodes", href: "/nodes" }, name]} section={name} who="whoever reads the fleet: owners, admins and moderators" />;
  }
  const node = await getNodeByName(decodeURIComponent(name));
  if (!node) notFound();
  const range: MetricRange = isMetricRange(requestedRange) ? requestedRange : "24h";
  const series = await nodeSeries(node.id, range);

  const meta = NODE_STATE[node.state] ?? NODE_STATE.HEALTHY;
  const canManage = can(user, "node.manage");
  const retirement = retirementOf({ name: node.name, state: node.state, servers: node.servers.length });
  const committedRam = node.servers.reduce((n, s) => n + s.memoryLimit, 0);
  const committedDisk = node.servers.reduce((n, s) => n + s.diskQuota, 0);
  const committedCpu = node.servers.reduce((n, s) => n + s.cpuLimit, 0);
  const running = node.servers.filter((s) => isUp(s.state)).length;
  /* The banner above says a node the panel cannot reach shows its servers as unknown, and this table drew the last thing the poller wrote:
     "Running", and a CPU figure from before it went. The servers and the dashboard use the same rule (domain/nodes/away.ts). */
  const seen = { state: node.state, lastReachedAt: node.lastReachedAt };
  // Away by the state, or silent by the clock: a node that was drained and then died stays "draining", and its servers are not known either.
  const away = nodeAway(seen) ?? (nodeSilent(seen) ? { reason: "unreachable" as const, since: node.lastReachedAt } : null);
  const hasAgent = Boolean(node.daemonUrl && node.daemonToken);
  // Null when the two speak the same thing, or when the node has not said.
  const versionWarning = hasAgent ? versionMessage(PANEL_VERSION, node.daemon, node.contract) : null;
  /* The node terminal: what the machine last said, and whether this
     person may open one here — owners only, see permissions.ts. */
  const terminal = terminalOf(node);
  const terminalAllowed = terminalDecision(user, { ...node, terminal }).ok;
  const terminalLine = !hasAgent
    ? "no agent"
    : !terminal
      ? "none — agent before 0.3.5"
      : terminal.state === "on"
        ? `on · ${terminal.user} · ${terminal.shell}${terminal.scope === "container" ? " (agent container)" : ""}`
        : terminal.state === "off"
          ? "off — switched on at the machine"
          : `unavailable — ${terminal.reason ?? "no reason given"}`;
  const location = [node.city, node.region].filter(Boolean).join(" · ") || "location not set";
  /* Where players reach it, for DNS records: set by hand, or as the
     panel sees the node — which from the same LAN is a private address,
     said as such so somebody sets a public one. */
  const reach = nodeAddressView(node);
  const addressLine =
    reach.source !== null
      ? `${[reach.v4, reach.v6].filter(Boolean).join(" and ")} · ${reach.source === "set" ? "set by hand" : "as the panel sees it"}`
      : reach.reason === "private"
        ? `the panel sees it from ${node.observedAddress}, which is not a public address — set one`
        : "not known yet — set one, or wait for a heartbeat";

  const gauges = [
    {
      k: "CPU",
      value: `${node.cpuPct}%`,
      pct: node.cpuPct,
      sub: `${node.cpuCores} vCPU · ${committedCpu}% committed`,
    },
    {
      k: "Memory",
      value: `${node.ramPct}%`,
      pct: node.ramPct,
      sub: `${committedRam} GB of ${node.ramTotal} GB committed`,
    },
    {
      k: "Storage",
      value: `${node.diskPct}%`,
      pct: node.diskPct,
      sub: `${committedDisk} GB of ${node.diskTotal} GB committed`,
    },
    {
      k: "Latency",
      value: hasAgent && node.pingMs > 0 ? `${node.pingMs} ms` : "—",
      pct: hasAgent ? Math.min(100, Math.round((node.pingMs / 250) * 100)) : 0,
      // Panel to agent, measured by the poller's health check. Not what a player sees.
      sub: hasAgent ? "panel to agent, last poll" : "no agent, not measured",
    },
  ];

  /* Derived from the servers actually placed here — there is no separate
     allocation table, so what is bound is what is in use. */
  const allocations = node.servers
    .map((s) => ({ port: s.port, server: s.name, slug: s.slug, kind: "primary" as const }))
    .sort((a, b) => a.port - b.port);

  return (
    <AppShell crumbs={[{ label: "Nodes", href: "/nodes" }, node.name]} user={shellUser(user)}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row">
          <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-xl border border-accent-line bg-accent-soft text-accent-fg">
            <Cpu size={24} strokeWidth={1.6} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-[10px]">
              <h1 className="font-mono text-[clamp(20px,2.6vw,26px)] font-semibold tracking-[-0.025em]">
                {node.name}
              </h1>
              <Pill tone={meta.tone} pulse={meta.pulse}>
                {meta.label}
              </Pill>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-[14px] gap-y-2 font-mono text-[11px] text-ink-4">
              <span className="flex items-center gap-[6px]">
                <Globe size={13} strokeWidth={1.7} />
                {location}
              </span>
              <span className="flex items-center gap-[6px]" title="Public address, where players reach this machine">
                <Network size={13} strokeWidth={1.7} />
                {addressLine}
              </span>
              {hasAgent && node.pingMs > 0 && (
                <span className="flex items-center gap-[6px]">
                  <Network size={13} strokeWidth={1.7} />
                  {node.pingMs} ms
                </span>
              )}
              <span className="flex items-center gap-[6px]">
                <Package size={13} strokeWidth={1.7} />
                daemon {node.daemon}
              </span>
              <span className="flex items-center gap-[6px]">
                <Clock size={13} strokeWidth={1.7} />
                added {node.createdAt.toLocaleDateString("en-GB")}
              </span>
            </div>
          </div>
          {canManage && (
            <div className="flex shrink-0 flex-wrap gap-2 lg:ml-auto">
              {terminalAllowed && (
                <LinkButton href={`/terminal?node=${encodeURIComponent(node.name)}`} intent="secondary" icon={SquareTerminal}>
                  Open terminal
                </LinkButton>
              )}
              <ConfigureNode
                name={node.name}
                initial={{ city: node.city, region: node.region, publicAddress: node.publicAddress ?? "", publicAddress6: node.publicAddress6 ?? "" }}
                observed={node.observedAddress}
              />
              {node.approvedAt && <DrainButton name={node.name} draining={node.state === "DRAINING"} />}
            </div>
          )}
        </div>

        {/* The panel cannot see this node. The row said "Not reached" and nothing else: the three things to check were in the Add a node dialog while
            a token was open, and in the docs. */}
        {hasAgent && (node.state === "UNREACHABLE" || node.state === "DEGRADED") && (
          <div role="status" className="rounded-[10px] border border-warning-line bg-warning-soft px-3 py-[11px] text-xs leading-relaxed text-warning-fg">
            <strong className="font-semibold">{node.state === "UNREACHABLE" ? "The panel cannot reach this node." : "This node is slow to answer."}</strong>{" "}
            {node.reachDetail ?? "It has not been heard from."} Check, in this order: that the agent is running on that machine
            (<span className="font-mono">systemctl status geeboard-agent</span> on Linux, the Scheduled Task on Windows); that{" "}
            <span className="font-mono">{node.daemonUrl}</span> is an address the panel can use from where it runs (join again with{" "}
            <span className="font-mono">--advertise</span> if it is not); and that the port is open to the panel. Its servers are shown as
            unknown until it answers again, and nothing is lost meanwhile: they go on running there.
          </div>
        )}

        {node.state === "DRAINING" && (
          <div className="rounded-[10px] border border-info-line bg-info-soft px-3 py-[11px] text-xs leading-snug text-info-fg">
            This node is draining. No new servers will be placed here.
            {node.servers.length > 0
              ? ` The ${running} running of its ${node.servers.length} keep running. Move them to another node from each server's Settings, or delete them; the node can be removed once none is left.`
              : " It has no servers, so it can be removed."}
          </div>
        )}

        {/* A node whose agent does not speak the panel's contract. It keeps what it
            runs — cutting it off would turn an upgrade into an outage —
            and takes nothing new. See domain/nodes/agent-version.ts. */}
        {versionWarning && (
          <div className="rounded-[10px] border border-warning-line bg-warning-soft px-3 py-[11px] text-xs leading-snug text-warning-fg">
            {versionWarning} Upgrade the agent on that machine the way it was installed, then
            restart it; the next heartbeat clears this.
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {gauges.map((g) => (
            <Card key={g.k} className="p-5">
              <Label className="mb-[14px] block">{g.k}</Label>
              <div className="text-[26px] leading-none font-semibold tracking-[-0.03em] tnum">
                {g.value}
              </div>
              <div className="mt-[14px] mb-[9px]">
                <Meter
                  label={`${node.name} ${g.k.toLowerCase()}`}
                  value={g.pct}
                  colour={g.pct > 80 ? "var(--warning)" : "var(--accent)"}
                  height={4}
                />
              </div>
              <div className="font-mono text-[10px] text-ink-4">{g.sub}</div>
            </Card>
          ))}
        </div>

        <Card className="flex flex-col p-5">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-[13.5px] font-semibold">History</h2>
            <span className="font-mono text-[10.5px] text-ink-4">what the node reported about itself, every fifteen seconds</span>
            <nav aria-label="Time range" className="ml-auto inline-flex gap-px rounded-lg bg-(--border) p-px">
              {METRIC_RANGES.map((t) => (
                <Link
                  key={t}
                  href={`/nodes/${encodeURIComponent(node.name)}?range=${t}`}
                  scroll={false}
                  aria-current={t === range ? "true" : undefined}
                  className={clsx(
                    "rounded-[7px] px-[10px] py-1 font-mono text-[10px] transition-colors duration-150",
                    t === range ? "bg-card-2 font-medium text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-ink-3 hover:text-ink-2",
                  )}
                >
                  {t}
                </Link>
              ))}
            </nav>
          </div>
          <div className="mt-3">
            <UsageChart
              {...nodeChart(series)}
              label={`CPU, memory, storage and latency of ${node.name} over the last ${range}`}
              empty={
                <div className="grid h-[160px] place-items-center rounded-[10px] border border-dashed border-line-2 text-center">
                  <div>
                    <div className="text-[13px] font-semibold">Nothing recorded in the last {range}</div>
                    <p className="mx-auto mt-2 max-w-[44ch] text-[11.5px] leading-relaxed text-ink-4">
                      The poller writes a sample each time it reaches the node. A node it cannot reach has no new values to write, and the chart shows a gap where it was silent.
                    </p>
                  </div>
                </div>
              }
            />
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-[10px] border-b border-line px-[18px] py-[13px]">
              <h2 className="text-[13.5px] font-semibold">Servers on this node</h2>
              {/* Counted, not "of N slots": nothing enforces a slot count.
                  What limits placement is committed memory, CPU and disk. */}
              <span className="font-mono text-[10.5px] text-ink-4">
                {node.servers.length} server{node.servers.length === 1 ? "" : "s"} · {away ? "state unknown" : `${running} up`}
              </span>
            </div>

            {node.servers.length === 0 ? (
              <div className="px-6 py-[52px] text-center">
                <div className="text-[13.5px] font-semibold">Nothing placed here yet</div>
                <p className="mx-auto mt-2 max-w-[40ch] text-xs leading-relaxed text-ink-4">
                  {node.state === "DRAINING" || !node.approvedAt
                    ? "It is not taking new servers."
                    : `${node.ramTotal} GB of memory and ${node.diskTotal} GB of storage are free to commit.`}
                </p>
              </div>
            ) : (
              <>
                <div className={`hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid ${COLS}`}>
                  {["Server", "Owner", "State", "CPU", "Memory", "Port"].map((h, i) => (
                    <Label key={h} className={i === 5 ? "text-right" : undefined}>
                      {h}
                    </Label>
                  ))}
                </div>

                {node.servers.map((s, i) => {
                  const state = away ? UNKNOWN_META : STATE_META[s.state];
                  return (
                    <Link
                      key={s.id}
                      href={`/servers/${s.slug}`}
                      className={`block px-[18px] py-[13px] transition-colors duration-150 hover:bg-card-2 lg:py-[11px] ${
                        i < node.servers.length - 1 ? "border-b border-line" : ""
                      }`}
                    >
                      <div className={`grid items-center gap-x-[14px] gap-y-2 ${COLS}`}>
                        <div className="col-span-2 flex min-w-0 items-center gap-[11px] lg:col-span-1">
                          <Cover tag={s.art} game={s.gameId} size={28} radius={8} />
                          <span className="truncate text-[12.5px] font-medium">{s.name}</span>
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar initials={s.owner.initials} size={20} />
                          <span className="truncate text-[11px] text-ink-4">{s.owner.name}</span>
                        </div>
                        <div>
                          <Pill tone={state.tone} pulse={state.pulse}>
                            {state.label}
                          </Pill>
                        </div>
                        {away ? (
                          <span className="font-mono text-[10px] text-ink-4" title="The panel cannot reach this node, so it does not know">
                            —
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="flex-1">
                              <Meter
                                label={`${s.name} CPU`}
                                value={s.cpuPct}
                                colour={s.cpuPct > 60 ? "var(--warning)" : "var(--accent)"}
                                height={3}
                              />
                            </span>
                            <span className="w-[28px] text-right font-mono text-[10px] text-ink-3 tnum">
                              {s.cpuPct}%
                            </span>
                          </div>
                        )}
                        <span className="font-mono text-[10.5px] text-ink-3 tnum">
                          {s.memoryLimit} GB
                        </span>
                        <span className="text-right font-mono text-[10.5px] text-ink-4 tnum">
                          <span className="text-ink-4 lg:hidden">port </span>
                          {s.port}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </>
            )}
          </Card>

          <div className="flex flex-col gap-4">
            <Card className="px-5 py-[18px]">
              <h2 className="mb-3 text-[13.5px] font-semibold">Bound ports</h2>
              {allocations.length === 0 ? (
                <p className="py-2 text-[11.5px] leading-relaxed text-ink-4">
                  No ports are bound on this node.
                </p>
              ) : (
                allocations.map((a) => (
                  <div
                    key={a.port}
                    className="flex items-center gap-[10px] border-b border-line py-2 last:border-b-0"
                  >
                    <span className="w-[52px] shrink-0 font-mono text-[11.5px] tnum">{a.port}</span>
                    <Link
                      href={`/servers/${a.slug}`}
                      className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3 hover:text-accent-fg"
                    >
                      {a.server}
                    </Link>
                  </div>
                ))
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-ink-4">
                Derived from the servers placed here — a port is bound because a server holds it.
              </p>
            </Card>

            <Card className="px-5 py-[18px]">
              <h2 className="mb-3 text-[13.5px] font-semibold">The machine</h2>
              {(
                [
                  ["Agent", node.contract === null ? node.daemon : `${node.daemon} · contract ${node.contract}`],
                  ["Runtime", node.runtime.toLowerCase()],
                  ["Platform", node.os && node.arch ? `${node.os} · ${node.arch}` : "not reported"],
                  ["Region", node.region || "not set"],
                  ["Hardware", `${node.cpuCores} vCPU · ${node.ramTotal} GB · ${node.diskTotal} GB`],
                  ["Last seen", node.lastSeenAt ? relativeTime(node.lastSeenAt) : "never"],
                  /* The other direction, and the one placement needs: a
                     node can heartbeat from behind a closed port. */
                  ["Reached", node.lastReachedAt ? relativeTime(node.lastReachedAt) : "never"],
                  /* Why not, when the last call did not get through — what
                     the agent's own log said, now beside the node. */
                  ...(node.reachDetail ? ([["Not reached", node.reachDetail]] as const) : []),
                  /* Decided at the machine, never here: docs/nodes.md, "Node terminal". */
                  ["Terminal", terminalLine],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-[10px] border-b border-line py-2 last:border-b-0">
                  <span className="w-[74px] shrink-0 text-[11.5px] text-ink-4">{k}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{v}</span>
                </div>
              ))}
              <p className="mt-3 text-[11px] leading-relaxed text-ink-4">
                {hasAgent
                  ? "CPU, memory and disk are what its agent last reported; it reports every 15 seconds."
                  : "No agent is attached, so these figures are not measured."}
              </p>
            </Card>

            {/* What this node can offer, and therefore which games can be
                placed on it. Empty until the node reports — which is not
                the same as a node that can do nothing, and says so. */}
            <Card className="px-5 py-[18px]">
              <h2 className="mb-3 text-[13.5px] font-semibold">Capabilities</h2>
              {node.capabilities.length === 0 ? (
                <p className="text-[11.5px] leading-relaxed text-ink-4">
                  This node has not reported its capabilities. Games that require one are treated
                  as unconfirmed here rather than refused.
                </p>
              ) : (
                <div className="flex flex-wrap gap-[5px]">
                  {node.capabilities.map((capability) => (
                    <Badge key={capability} tone={capability === "community-games" ? "warning" : "muted"}>
                      {CAPABILITY_LABELS[capability as CapabilityId] ?? capability}
                    </Badge>
                  ))}
                </div>
              )}
              {node.capabilities.includes("community-games") && (
                <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
                  The operator of this machine has said, on the machine, that games somebody wrote may run here once an owner has approved them. Their images run as root in
                  their containers and reach what this machine&apos;s network reaches. The panel cannot turn this on or off; only the machine can, and this page follows it within a minute.
                </p>
              )}
            </Card>

            {canManage && node.approvedAt && hasAgent && <RotateAgentToken name={node.name} />}

            {canManage && node.approvedAt && (
              <RetireNode
                name={node.name}
                servers={retirement.servers}
                serverLinks={node.servers.map((s) => ({ name: s.name, slug: s.slug }))}
                outOfRotation={retirement.outOfRotation}
                hasAgent={hasAgent}
                gone={hasAgent && nodeSilent({ state: node.state, lastReachedAt: node.lastReachedAt })}
              />
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
