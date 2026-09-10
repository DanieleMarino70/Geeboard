import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Cpu, Globe, Network, Package, Settings2 } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Avatar, Badge, Card, Cover, Label, Meter, Pill } from "@/components/ui";
import { CAPABILITY_LABELS, type CapabilityId } from "@/domain/games/types";
import { requireUser } from "@/lib/auth";
import { STATE_META, getNodeByName, relativeTime } from "@/lib/queries";
import type { Tone } from "@/lib/ui-types";
import { DrainButton } from "../drain-button";

export const dynamic = "force-dynamic";

const NODE_STATE: Record<string, { tone: Tone; label: string; pulse: boolean }> = {
  PENDING: { tone: "info", label: "Pending approval", pulse: true },
  HEALTHY: { tone: "success", label: "Healthy", pulse: false },
  DEGRADED: { tone: "warning", label: "Degraded", pulse: true },
  UNREACHABLE: { tone: "danger", label: "Unreachable", pulse: true },
  DRAINING: { tone: "info", label: "Draining", pulse: true },
  MAINTENANCE: { tone: "muted", label: "Maintenance", pulse: false },
};

const COLS = "minmax(0,1fr) 116px 128px 132px 84px 76px";

export default async function NodeDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const user = await requireUser();
  const { name } = await params;
  const node = await getNodeByName(decodeURIComponent(name));
  if (!node) notFound();

  const meta = NODE_STATE[node.state] ?? NODE_STATE.HEALTHY;
  const committedRam = node.servers.reduce((n, s) => n + s.memoryLimit, 0);
  const committedDisk = node.servers.reduce((n, s) => n + s.diskQuota, 0);
  const committedCpu = node.servers.reduce((n, s) => n + s.cpuLimit, 0);
  const running = node.servers.filter(
    (s) => s.state === "RUNNING" || s.state === "STARTING",
  ).length;

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
      value: `${node.pingMs} ms`,
      pct: Math.min(100, Math.round((node.pingMs / 250) * 100)),
      sub: "median round trip from the panel",
    },
  ];

  /* Derived from the servers actually placed here — there is no separate
     allocation table, so what is bound is what is in use. */
  const allocations = node.servers
    .map((s) => ({ port: s.port, server: s.name, slug: s.slug, kind: "primary" as const }))
    .sort((a, b) => a.port - b.port);

  return (
    <AppShell crumbs={["Ashfold", "Nodes", node.name]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row">
          <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-xl border border-accent-line bg-accent-soft text-accent">
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
                {node.city} · {node.region}
              </span>
              <span className="flex items-center gap-[6px]">
                <Network size={13} strokeWidth={1.7} />
                {node.pingMs} ms
              </span>
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
          <div className="flex shrink-0 flex-wrap gap-2 lg:ml-auto">
            <button
              type="button"
              disabled
              title="Not wired up yet"
              className="inline-flex items-center gap-[7px] rounded-[9px] border border-line bg-card px-4 py-[9px] text-[13px] font-medium text-ink-2 opacity-45"
            >
              <Settings2 size={14} strokeWidth={1.9} />
              Configure
            </button>
            <DrainButton name={node.name} draining={node.state === "DRAINING"} />
          </div>
        </div>

        {node.state === "DRAINING" && (
          <div className="rounded-[10px] border border-info-line bg-info-soft px-3 py-[11px] text-xs leading-snug text-info">
            This node is draining. No new servers will be placed here, and the {running} still
            running should be moved before it is taken offline.
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
                  value={g.pct}
                  colour={g.pct > 80 ? "var(--warning)" : "var(--accent)"}
                  height={4}
                />
              </div>
              <div className="font-mono text-[10px] text-ink-4">{g.sub}</div>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-[10px] border-b border-line px-[18px] py-[13px]">
              <h2 className="text-[13.5px] font-semibold">Servers on this node</h2>
              <span className="font-mono text-[10.5px] text-ink-4">
                {node.servers.length} of {node.slots} slots used
              </span>
            </div>

            {node.servers.length === 0 ? (
              <div className="px-6 py-[52px] text-center">
                <div className="text-[13.5px] font-semibold">Nothing placed here yet</div>
                <p className="mx-auto mt-2 max-w-[34ch] text-xs leading-relaxed text-ink-4">
                  This node has {node.slots} free slots. New servers can be placed on it.
                </p>
              </div>
            ) : (
              <>
                <div
                  className="hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid"
                  style={{ gridTemplateColumns: COLS }}
                >
                  {["Server", "Owner", "State", "CPU", "Memory", "Port"].map((h, i) => (
                    <Label key={h} className={i === 5 ? "text-right" : undefined}>
                      {h}
                    </Label>
                  ))}
                </div>

                {node.servers.map((s, i) => {
                  const state = STATE_META[s.state];
                  return (
                    <Link
                      key={s.id}
                      href={`/servers/${s.slug}`}
                      className={`block px-[18px] py-[13px] transition-colors duration-150 hover:bg-card-2 lg:py-[11px] ${
                        i < node.servers.length - 1 ? "border-b border-line" : ""
                      }`}
                    >
                      <div
                        className="grid items-center gap-x-[14px] gap-y-2"
                        style={{ gridTemplateColumns: COLS }}
                      >
                        <div className="flex min-w-0 items-center gap-[11px]">
                          <Cover tag={s.art} size={28} radius={8} />
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
                        <div className="flex items-center gap-2">
                          <span className="flex-1">
                            <Meter
                              value={s.cpuPct}
                              colour={s.cpuPct > 60 ? "var(--warning)" : "var(--accent)"}
                              height={3}
                            />
                          </span>
                          <span className="w-[28px] text-right font-mono text-[10px] text-ink-3 tnum">
                            {s.cpuPct}%
                          </span>
                        </div>
                        <span className="font-mono text-[10.5px] text-ink-3 tnum">
                          {s.memoryLimit} GB
                        </span>
                        <span className="text-right font-mono text-[10.5px] text-ink-4 tnum">
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
                      className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3 hover:text-accent"
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
                  ["Agent", node.daemon],
                  ["Runtime", node.runtime.toLowerCase()],
                  ["Platform", node.os && node.arch ? `${node.os} · ${node.arch}` : "not reported"],
                  ["Region", node.region],
                  ["Capacity", `${node.slots} slots`],
                  ["Hardware", `${node.cpuCores} vCPU · ${node.ramTotal} GB · ${node.diskTotal} GB`],
                  ["Last seen", node.lastSeenAt ? relativeTime(node.lastSeenAt) : "never"],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-[10px] border-b border-line py-2 last:border-b-0">
                  <span className="w-[74px] shrink-0 text-[11.5px] text-ink-4">{k}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{v}</span>
                </div>
              ))}
              <p className="mt-3 text-[11px] leading-relaxed text-ink-4">
                Live CPU, memory and disk are the last values recorded for this node. The poller
                refreshes them each pass.
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
                    <Badge key={capability} tone="muted">
                      {CAPABILITY_LABELS[capability as CapabilityId] ?? capability}
                    </Badge>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
