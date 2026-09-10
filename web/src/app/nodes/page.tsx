import Link from "next/link";
import { ChevronRight, Cpu, Plus } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Badge, Card, Meter, Pill } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { can } from "@/domain/access/permissions";
import { db } from "@/lib/db";
import { getNodesWithLoad } from "@/lib/queries";
import type { Tone } from "@/lib/ui-types";
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

export default async function NodesPage() {
  const user = await requireUser();
  const canManage = can(user, "node.manage");

  const [nodes, tokens] = await Promise.all([
    getNodesWithLoad(),
    canManage
      ? db.nodeRegistrationToken.findMany({ orderBy: { createdAt: "desc" }, take: 10 })
      : Promise.resolve([]),
  ]);

  const inService = nodes.filter((n) => n.approvedAt !== null);
  const pending = nodes.filter((n) => n.approvedAt === null);
  const totalServers = nodes.reduce((n, x) => n + x.serverCount, 0);
  /* Pending is not unhealthy — it is a node waiting on a person, and
     putting it in the "needs attention" line would read as a fault. */
  const unhealthy = inService.filter((n) => n.state !== "HEALTHY");

  return (
    <AppShell crumbs={["Ashfold", "Nodes"]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Nodes</h1>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              The machines your servers run on. Committed figures are what has been promised to
              servers, which is what decides whether another server fits.
            </p>
          </div>
          <div className="flex shrink-0 gap-2 lg:ml-auto">
            <a
              href="#add-a-node"
              className="inline-flex items-center gap-[7px] rounded-[9px] bg-accent px-4 py-[9px] text-[13px] font-semibold text-accent-ink transition-opacity hover:opacity-90"
            >
              <Plus size={14} strokeWidth={1.9} />
              Add a node
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[10.5px] text-ink-4">
            {inService.length} in service · {totalServers} servers
            {pending.length > 0 ? ` · ${pending.length} awaiting approval` : ""}
          </span>
          {unhealthy.length > 0 && (
            <span className="font-mono text-[10.5px] text-warning">
              {unhealthy.map((n) => n.name).join(", ")} need attention
            </span>
          )}
        </div>

        <div id="add-a-node" className="scroll-mt-6">
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
                    <div className="mt-[3px] text-[11px] text-ink-4">
                      {n.city} · {n.region}
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

                <div className="mt-4 flex items-center gap-3 border-t border-line pt-3">
                  <span className="font-mono text-[10px] text-ink-4">
                    {n.running} / {n.serverCount} running
                  </span>
                  <span className="font-mono text-[10px] text-ink-4">{n.pingMs} ms</span>
                  {!n.hasAgent && (
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

                <div className="mt-3">
                  <DrainButton name={n.name} draining={n.state === "DRAINING"} size="sm" />
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
