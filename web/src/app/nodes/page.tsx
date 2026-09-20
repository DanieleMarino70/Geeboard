import Link from "next/link";
import { ChevronRight, Cpu } from "lucide-react";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { Badge, Card, Meter, Pill } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { can } from "@/domain/access/permissions";
import { allGames } from "@/domain/games/registry";
import { CAPABILITIES, CAPABILITY_LABELS, type CapabilityId } from "@/domain/games/types";
import { MEASURED_CAPABILITIES } from "@/lib/agent-command";
import { db } from "@/lib/db";
import { panelUrl } from "@/lib/panel-url";
import { getNodesWithLoad, relativeTime } from "@/lib/queries";
import type { Tone } from "@/lib/ui-types";
import { AddNodeButton, OpenAddNode, type DeclarableCapability } from "./add-node";
import { DrainButton } from "./drain-button";
import { NodeRegistration } from "./registration";

export const dynamic = "force-dynamic";

const NODE_STATE: Record<string, { tone: Tone; label: string; pulse: boolean }> = {
  PENDING: { tone: "info", label: "Pending approval", pulse: true },
  HEALTHY: { tone: "success", label: "Healthy", pulse: false },
  DEGRADED: { tone: "warning", label: "Degraded", pulse: true },
  UNREACHABLE: { tone: "danger", label: "Unreachable", pulse: true },
  DRAINING: { tone: "info", label: "Draining", pulse: true },
  MAINTENANCE: { tone: "muted", label: "Maintenance", pulse: false },
};

export default async function NodesPage({
  searchParams,
}: {
  searchParams: Promise<{ removed?: string }>;
}) {
  const user = await requireUser();
  const canManage = can(user, "node.manage");
  const { removed } = await searchParams;

  const [nodes, tokens, panel] = await Promise.all([
    getNodesWithLoad(),
    canManage
      ? db.nodeRegistrationToken.findMany({ orderBy: { createdAt: "desc" }, take: 10 })
      : Promise.resolve([]),
    panelUrl(),
  ]);

  /* Which declarations unlock which games, worked out from the
     definitions rather than written into the dialog — a new game that
     needs SteamCMD shows up under that checkbox without anybody editing
     the page. A capability no game asks for is not offered: a checkbox
     that changes nothing is a question with no reason to answer it. */
  const declarable: DeclarableCapability[] = CAPABILITIES.filter(
    (id) => !MEASURED_CAPABILITIES.includes(id),
  )
    .map((id) => ({
      id,
      label: CAPABILITY_LABELS[id],
      games: allGames()
        .filter((g) => g.requirements.capabilities.includes(id))
        .map((g) => g.name),
    }))
    .filter((c) => c.games.length > 0);

  const addNode = () =>
    canManage ? (
      <AddNodeButton
        panelUrl={panel}
        existingNames={nodes.map((n) => n.name)}
        declarable={declarable}
      />
    ) : null;

  const inService = nodes.filter((n) => n.approvedAt !== null);
  const pending = nodes.filter((n) => n.approvedAt === null);
  const totalServers = nodes.reduce((n, x) => n + x.serverCount, 0);
  /* Pending is not unhealthy — it is a node waiting on a person, and
     putting it in the "needs attention" line would read as a fault. */
  const unhealthy = inService.filter((n) => n.state !== "HEALTHY");

  return (
    <AppShell crumbs={["Nodes"]} user={shellUser(user)}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Nodes</h1>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              The machines your servers run on. Committed figures are what has been promised to
              servers, which is what decides whether another server fits.
            </p>
          </div>
          <div className="flex shrink-0 gap-2 lg:ml-auto">{addNode()}</div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[10.5px] text-ink-4">
            {inService.length} in service · {totalServers} servers
            {pending.length > 0 ? ` · ${pending.length} awaiting approval` : ""}
          </span>
          {unhealthy.length > 0 && (
            <span className="font-mono text-[10.5px] text-warning">
              {unhealthy.map((n) => n.name).join(", ")} need{unhealthy.length === 1 ? "s" : ""} attention
            </span>
          )}
        </div>

        {/* After a removal, which navigates here and so loses its toast.
            The part worth saying survives the redirect: the machine is
            still running an agent the panel now refuses. Only shown while
            the node really is gone, so a reused link cannot say otherwise. */}
        {removed && !nodes.some((n) => n.name === removed) && (
          <div className="rounded-[10px] border border-warning-line bg-warning-soft px-3 py-[11px] text-xs leading-snug text-warning">
            <span className="font-mono font-semibold">{removed}</span> was removed, with its agent token.
            If its agent is still running on the machine, stop it — its heartbeats are refused from now
            on.
          </div>
        )}

        {nodes.length === 0 && (
          <Card className="flex flex-col items-start gap-3 p-6">
            <h2 className="text-[15px] font-semibold">No nodes yet</h2>
            <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-ink-3">
              A node is a machine you already have, running Docker and the Geeboard agent. Servers
              are created on nodes, so this is the first step.
            </p>
            {canManage && <OpenAddNode label="Add your first node" />}
          </Card>
        )}

        <div>
          <NodeRegistration
            canManage={canManage}
            pending={pending.map((n) => ({
              name: n.name,
              city: n.city,
              os: n.os,
              arch: n.arch,
              capabilities: n.capabilities,
              cpuCores: n.cpuCores,
              ramTotal: n.ramTotal,
              diskTotal: n.diskTotal,
              daemon: n.daemon,
              registeredAt: n.registeredAt?.toISOString() ?? null,
            }))}
            tokens={tokens.map((t) => ({
              id: t.id,
              prefix: t.prefix,
              label: t.label,
              nodeName: t.nodeName,
              expiresAt: t.expiresAt.toISOString(),
              usedAt: t.usedAt?.toISOString() ?? null,
              usedByNode: t.usedByNode,
              revokedAt: t.revokedAt?.toISOString() ?? null,
            }))}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {inService.map((n) => {
            const meta = NODE_STATE[n.state] ?? NODE_STATE.HEALTHY;
            return (
              <Card key={n.id} hover className="flex flex-col p-5">
                <div className="mb-4 flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-accent-line bg-accent-soft text-accent">
                    <Cpu size={18} strokeWidth={1.6} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/nodes/${n.name}`}
                      className="block truncate font-mono text-[13px] font-medium hover:text-accent"
                    >
                      {n.name}
                    </Link>
                    <div className="mt-[3px] truncate text-[11px] text-ink-4">
                      {[n.city, n.region].filter(Boolean).join(" · ") || "location not set"}
                    </div>
                    <div className="mt-[2px] truncate font-mono text-[10px] text-ink-4">
                      {n.os && n.arch ? `${n.os} · ${n.arch}` : "platform not reported"} · agent {n.daemon}
                    </div>
                  </div>
                  <span className="flex flex-col items-end gap-[6px]">
                    <Pill tone={meta.tone} pulse={meta.pulse}>
                      {meta.label}
                    </Pill>
                    {n.hasAgent ? (
                      <Badge tone="success">agent</Badge>
                    ) : (
                      <Badge tone="warning">no agent</Badge>
                    )}
                  </span>
                </div>

                <div className="flex flex-col gap-[10px]">
                  {(
                    [
                      ["CPU", n.cpuPct, `${n.cpuCores} vCPU`],
                      ["Memory", n.ramPct, `${n.committedRamGb} of ${n.ramTotal} GB committed`],
                      ["Storage", n.diskPct, `${n.committedDiskGb} GB committed`],
                    ] as const
                  ).map(([k, pct, sub]) => (
                    <div key={k}>
                      <div className="mb-[5px] flex justify-between">
                        <span className="font-mono text-[9.5px] text-ink-4">{k}</span>
                        <span className="font-mono text-[10px] text-ink-2 tnum">{pct}%</span>
                      </div>
                      <Meter
                        value={pct}
                        colour={pct > 80 ? "var(--warning)" : "var(--accent)"}
                        height={3}
                      />
                      <div className="mt-[4px] font-mono text-[9px] text-ink-4">{sub}</div>
                    </div>
                  ))}
                </div>

                {/* Which games it can take depends on these, so a card
                    that hid them sent people to the detail page to find
                    out why a game was refused. */}
                <div className="mt-4 flex flex-wrap gap-[5px]">
                  {n.capabilities.length === 0 ? (
                    <span className="text-[10.5px] text-ink-4">No capabilities reported</span>
                  ) : (
                    n.capabilities.map((c) => (
                      <Badge key={c} tone="muted">
                        {CAPABILITY_LABELS[c as CapabilityId] ?? c}
                      </Badge>
                    ))
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3">
                  <span className="font-mono text-[10px] text-ink-4">
                    {n.running} / {n.serverCount} up
                  </span>
                  {n.hasAgent ? (
                    <span className="font-mono text-[10px] text-ink-4" title="Last time the panel heard from its agent">
                      {n.lastSeenAt ? `seen ${relativeTime(n.lastSeenAt)}` : "never seen"}
                      {n.pingMs > 0 ? ` · ${n.pingMs} ms` : ""}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-warning">simulated</span>
                  )}
                  <Link
                    href={`/nodes/${n.name}`}
                    className="ml-auto flex items-center gap-1 text-[11.5px] text-accent hover:underline"
                  >
                    Open
                    <ChevronRight size={12} strokeWidth={2} />
                  </Link>
                </div>

                {canManage && (
                  <div className="mt-3">
                    <DrainButton name={n.name} draining={n.state === "DRAINING"} size="sm" />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
