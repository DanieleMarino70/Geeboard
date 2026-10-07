import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Cpu, FlaskConical, Globe, TriangleAlert, Users } from "lucide-react";
import clsx from "clsx";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { LiveRefresh } from "@/components/live-refresh";
import { NodeAway } from "@/components/node-away";
import { ServerControls } from "@/components/server-actions";
import { ServerTabs } from "@/components/server-tabs";
import { StatePill } from "@/components/state-pill";
import { Badge, Card, Cover } from "@/components/ui";
import { allowanceFor, can } from "@/domain/access/permissions";
import { awayReasonForControls, nodeAway } from "@/domain/nodes/away";
import { findGame, isCommunityId, isOffered } from "@/domain/games/registry";
import { redactSecrets } from "@/domain/games/types";
import { outlookFor } from "@/domain/games/versions";
import { quotesConsole } from "@/domain/servers/health";
import { isUp } from "@/domain/servers/state";
import { requireUser } from "@/lib/auth";
import { storedCatalog } from "@/lib/catalog-read";
import { DNS_PROVIDERS } from "@/domain/dns/rules";
import { dnsProviderFacts, serverDnsView } from "@/lib/dns-ops";
import { formatBytes, timeAgo } from "@/lib/format";
import { rebuildNeededFor, updateOfferFor } from "@/lib/update-ops";
import { settleStale } from "@/lib/daemon-sim";
import { METRIC_RANGES, isMetricRange, type MetricRange } from "@/domain/metrics/ranges";
import { UsageChart } from "@/components/usage-chart";
import { serverChart } from "@/lib/chart-panels";
import { serverSeries } from "@/lib/metrics";
import { STATE_META, UNKNOWN_META, getServerBySlug, relativeTime, uptimeFrom } from "@/lib/queries";
import { ConsoleTail } from "./console-tail";
import { RebuildAction } from "./rebuild-action";
import { UpdateActions } from "./update-actions";
import { VersionPanel } from "./version-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: (await params).id };
}

export default async function ServerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireUser();
  await settleStale();
  const { id } = await params;
  const { range: requestedRange } = await searchParams;
  const server = await getServerBySlug(id, user);
  if (!server) notFound();

  const range: MetricRange = isMetricRange(requestedRange) ? requestedRange : "1h";
  /* The reads that do not wait on each other, together: the chart's series, the catalog (read from the stored tables, so drawing this page
     never waits on Steam or Mojang; the sync is what keeps them current) and the DNS provider. They were nine round trips one after another. */
  const [series, catalog, dnsFacts] = await Promise.all([
    serverSeries(server.id, range),
    server.gameId ? storedCatalog(server.gameId) : Promise.resolve(null),
    dnsProviderFacts(),
  ]);
  const game = server.gameId ? findGame(server.gameId) : undefined;
  // Whether this game's console says who joins; if not, a count of 0 means nothing.
  const readsPlayers = Boolean(game?.console.players);

  const outlook = catalog
    ? outlookFor(catalog, {
        versionId: server.gameVersionRef?.slug ?? null,
        buildId: server.installedBuildId,
      })
    : null;

  /* What an update would move to, and whether the last one left a way
     back. Both read from stored rows, so drawing this page never waits
     on Steam or Mojang. */
  const offer = await updateOfferFor(server, catalog);
  const rebuildNeeded = rebuildNeededFor(server);
  /* The poller skips a node it cannot reach, so what this row says is what it said before it went quiet. Shown as unknown, with since when,
     and the controls say why they do nothing (domain/nodes/away.ts). */
  const away = nodeAway(server.node);
  const meta = away ? UNKNOWN_META : STATE_META[server.state];
  const uptime = uptimeFrom(server.startedAt);
  /* A server on a node with no agent is a record the simulator moves
     between states. Said on the page, next to the state it is faking,
     rather than only in a toast somebody may not have read. */
  const simulated = !server.node.daemonUrl || !server.node.daemonToken;
  /* A real node and no workload, after something went wrong — not a
     server mid-install, whose workload does not exist yet on purpose. */
  const workloadMissing = !simulated && !server.runtimeId && server.state === "ERROR";
  const canUpdate = can(user, "server.update", server.ownerId);
  /* Everybody who may open this page sees the state; not everybody may
     read the console, and a crash is reported as the console line that
     showed it. Those who may not are told where the reason is instead. */
  const canReadConsole = can(user, "server.console.read", server.ownerId);
  const healthReason = !server.healthDetail
    ? null
    : canReadConsole
      ? redactSecrets(game, server.healthDetail)
      : game && quotesConsole(game, server.healthDetail)
        ? "It printed a line that means it crashed. The line is in its console, which is open to the server's owner, to moderators and to admins."
        : server.healthDetail;

  const dns = serverDnsView(server, server.node, dnsFacts);
  // A webhook's receiver accepts a record; Cloudflare and DuckDNS write it. The page says which.
  const accepted = dnsFacts !== null && DNS_PROVIDERS[dnsFacts.kind].took === "accepted";
  const facts = [
    ["Node", server.node.name, `${server.node.city} · ${server.node.pingMs} ms`],
    ["Address", server.host, dns.byName ? `port ${server.port} · found by SRV` : `port ${server.port}`],
    ["Version", server.version, server.game],
    ["Uptime", uptime, server.startedAt ? `since ${server.startedAt.toLocaleDateString("en-GB")}` : "not running"],
    [
      "World size",
      server.worldSizeBytes !== null ? formatBytes(server.worldSizeBytes) : "not measured yet",
      server.worldSizeAt
        ? `of ${server.diskQuota} GB · ${timeAgo(server.worldSizeAt)}`
        : `${server.diskQuota} GB quota`,
    ],
    ["Owner", server.owner.name, `${server.memoryLimit} GB · ${server.cpuLimit}% CPU`],
    /* The DNS record behind the address, when a provider keeps it. Left
       out with no provider: nothing to say that the address does not. */
    ...(dns.state === "none"
      ? []
      : [
          [
            "DNS",
            dns.state === "set"
              ? accepted
                ? `${dns.address} accepted`
                : `points at ${dns.address}`
              : dns.state === "failed"
                ? accepted
                  ? "not taken"
                  : "not written"
                : dns.state === "no-address"
                  ? "waiting for an address"
                  : "yours to keep",
            dns.state === "failed"
              ? (dns.error ?? "")
              : dns.state === "no-address"
                ? `${server.node.name} has no public address yet`
                : dns.state === "outside"
                  ? `not under ${dnsFacts?.zone}`
                  : `${dns.records.filter((r) => r.content).map((r) => r.kind).join(" · ")} · ${accepted ? "accepted by the receiver" : "kept by the panel"}`,
          ] as const,
        ]),
  ] as const;

  return (
    <AppShell crumbs={[{ label: "Servers", href: "/servers" }, server.name]} user={shellUser(user)}>
      <LiveRefresh active={!away && STATE_META[server.state].pulse} />
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row">
          <Cover tag={server.art} game={server.gameId} size={52} radius={13} />
          <div className="min-w-0">
            <div className="flex items-center gap-[10px]">
              <h1 className="text-[clamp(22px,2.8vw,26px)] font-semibold tracking-[-0.025em]">
                {server.name}
              </h1>
              <StatePill slug={server.slug} tone={meta.tone} label={meta.label} pulse={meta.pulse} />
              {simulated && <Badge tone="warning">simulated</Badge>}
              {game && isCommunityId(game.id) && <Badge tone="warning">{isOffered(game.id) ? "community" : "community · retired"}</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-[14px] gap-y-2 font-mono text-[11px] text-ink-4">
              <span className="flex items-center gap-[6px]">
                <Globe size={13} strokeWidth={1.7} />
                {dns.byName ? server.host : `${server.host}:${server.port}`}
              </span>
              <span className="flex items-center gap-[6px]">
                <Cpu size={13} strokeWidth={1.7} />
                {server.node.name}
              </span>
              <span className="flex items-center gap-[6px]">
                <Clock size={13} strokeWidth={1.7} />
                {away ? "uptime unknown" : `up ${uptime}`}
              </span>
              <span className="flex items-center gap-[6px]">
                <Users size={13} strokeWidth={1.7} />
                {away
                  ? "players unknown"
                  : readsPlayers
                    ? `${server.playersOn} / ${server.playersMax} online`
                    : "players not counted for this game"}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 lg:ml-auto">
            <ServerControls
              slug={server.slug}
              running={isUp(server.state)}
              allow={allowanceFor(user, server.ownerId)}
              unavailable={away ? awayReasonForControls(server.node.name, away) : null}
            />
          </div>
        </div>

        {away && (
          <div role="status" className="flex items-start gap-[10px] rounded-[11px] border border-warning-line bg-warning-soft px-4 py-3 text-[12px] leading-relaxed">
            <TriangleAlert size={15} strokeWidth={1.9} className="mt-[2px] shrink-0 text-warning-fg" />
            <p className="text-ink-2">
              <strong className="font-semibold text-warning-fg">Unknown.</strong>{" "}
              <NodeAway node={server.node.name} reason={away.reason} since={away.since?.toISOString() ?? null} />. The panel last
              saw this server {server.state === "RUNNING" || server.state === "UNHEALTHY" ? "running" : server.state.toLowerCase().replace("_", " ")}
              ; what is shown below is from then, and nothing can be done to it from here until the node answers again. The
              node&apos;s page says why and what to check.
            </p>
          </div>
        )}

        {/* Why a server is not well, where somebody looking at it will see
            it. The reason was recorded and shown nowhere on this page. */}
        {/* And why one stopped by itself, when its game said: only the
            watchdog writes a reason for a stop, and a start clears it. */}
        {!workloadMissing && (server.state === "ERROR" || server.state === "CRASHED" || server.state === "STOPPED") && server.lastError && (
          <div role="alert" className="flex items-start gap-[10px] rounded-[11px] border border-danger-line bg-danger-soft px-4 py-3 text-[12px] leading-relaxed">
            <TriangleAlert size={15} strokeWidth={1.9} className="mt-[2px] shrink-0 text-danger-fg" />
            <p className="text-ink-2">
              <strong className="font-semibold text-danger-fg">{meta.label}.</strong> {server.lastError}
            </p>
          </div>
        )}
        {server.state === "UNHEALTHY" && server.healthDetail && (
          <div className="flex items-start gap-[10px] rounded-[11px] border border-warning-line bg-warning-soft px-4 py-3 text-[12px] leading-relaxed">
            <TriangleAlert size={15} strokeWidth={1.9} className="mt-[2px] shrink-0 text-warning-fg" />
            <p className="text-ink-2">
              <strong className="font-semibold text-warning-fg">Not healthy.</strong> {healthReason}
            </p>
          </div>
        )}

        {workloadMissing &&
          (canUpdate ? (
            <RebuildAction
              slug={server.slug}
              serverName={server.name}
              nodeName={server.node.name}
              versionLabel={server.version}
              missing
              reason={server.lastError}
            />
          ) : (
            <div className="rounded-[11px] border border-danger-line bg-danger-soft px-4 py-3 text-[12px] leading-relaxed text-danger-fg">
              Nothing to start on {server.node.name}. {server.lastError ?? "Its workload is gone."} Somebody
              who can update this server has to rebuild it.
            </div>
          ))}

        {simulated && (
          <div className="flex items-start gap-[10px] rounded-[11px] border border-warning-line bg-warning-soft px-4 py-3 text-[12px] leading-relaxed text-warning-fg">
            <FlaskConical size={15} strokeWidth={1.8} className="mt-[2px] shrink-0" />
            <p>
              <strong className="font-semibold">Nothing is running.</strong> {server.node.name} has no
              agent attached, so start, stop and restart only move this record between states, and the
              figures on this page are sample data. Servers on a{" "}
              <Link href="/nodes" className="underline">
                registered node
              </Link>{" "}
              are real.
            </p>
          </div>
        )}

        <ServerTabs slug={server.slug} active="overview" gameId={server.gameId} viewer={user} ownerId={server.ownerId} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="flex flex-col p-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-[13.5px] font-semibold">Resource usage</h2>
                <nav aria-label="Time range" className="ml-auto inline-flex gap-px rounded-lg bg-(--border) p-px">
                  {METRIC_RANGES.map((t) => (
                    <Link
                      key={t}
                      href={`/servers/${server.slug}?range=${t}`}
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
                  {...serverChart(series)}
                  label={`CPU, memory and network over the last ${range}`}
                  empty={
                    <div className="grid h-[200px] place-items-center rounded-[10px] border border-dashed border-line-2 text-center">
                      <div>
                        <div className="text-[13px] font-semibold">No usage in the last {range}</div>
                        <p className="mx-auto mt-2 max-w-[40ch] text-[11.5px] leading-relaxed text-ink-4">
                          {simulated
                            ? "A simulated server has no usage to record."
                            : isUp(server.state)
                              ? "The poller records a sample every few seconds while the server runs — it appears here shortly."
                              : "Usage is recorded while the server runs. Start it, or pick a longer range."}
                        </p>
                      </div>
                    </div>
                  }
                />
              </div>
            </Card>

            <ConsoleTail slug={server.slug} server={server} node={server.node} allowed={canReadConsole} />
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
                <span className="font-mono text-[10.5px] text-ink-4 tnum">{readsPlayers ? server.players.length : ""}</span>
                <Link href={`/players?server=${server.slug}`} className="ml-auto text-[11.5px] text-accent-fg hover:underline">
                  History
                </Link>
              </div>
              {!readsPlayers ? (
                <p className="py-3 text-[11.5px] leading-relaxed text-ink-4">
                  {game?.name ?? "This game"} does not say in its console who joins, so players are not
                  counted for it.
                </p>
              ) : server.players.length === 0 ? (
                <p className="py-3 text-[11.5px] leading-relaxed text-ink-4">
                  {isUp(server.state)
                    ? "Nobody is connected. Players appear here within a few seconds of joining."
                    : "The server is not running, so nobody is connected."}
                </p>
              ) : (
                server.players.map((p, i) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-[10px] py-2 ${i < server.players.length - 1 ? "border-b border-line" : ""}`}
                  >
                    <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-success" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{p.username}</span>
                    <span className="font-mono text-[10px] text-ink-4">since {timeAgo(p.joinedAt).replace(" ago", "")}</span>
                  </div>
                ))
              )}
            </Card>

            <Card className="px-5 py-[18px]">
              <div className="mb-1 flex items-baseline gap-[10px]">
                <h2 className="text-[13.5px] font-semibold">Recent backups</h2>
                <Link href={`/backups?server=${server.slug}`} className="ml-auto text-[11.5px] text-accent-fg hover:underline">
                  All
                </Link>
              </div>
              {/* The page is open to every account, a server's backups to
                  its owner and admins: they were listed here to all. */}
              {!can(user, "server.backup.read", server.ownerId) ? (
                <p className="py-3 text-[11.5px] leading-relaxed text-ink-4">
                  Its backups are listed to the server&apos;s owner and to admins.
                </p>
              ) : server.backups.length === 0 ? (
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
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={b.error ?? undefined}>
                      {b.name}
                    </span>
                    <span className={clsx("font-mono text-[10px]", b.state === "FAILED" ? "text-danger-fg" : "text-ink-4")}>
                      {b.state === "FAILED" ? "failed" : formatBytes(b.sizeBytes)}
                    </span>
                    <span className="w-[56px] text-right text-[10.5px] text-ink-4">
                      {relativeTime(b.createdAt)}
                    </span>
                  </div>
                ))
              )}
            </Card>

            <VersionPanel
              outlook={outlook}
              versionLabel={server.version}
              actions={
                <>
                  {/* The definition, or this server's own limits, have moved
                      on from what its workload was made from. Said here,
                      beside the button that applies it. */}
                  {rebuildNeeded && rebuildNeeded.length > 0 && (
                    <div className="mt-3 rounded-[10px] border border-warning-line bg-warning-soft px-3 py-[10px] text-[11.5px] leading-snug text-ink-2">
                      <strong className="font-semibold text-warning-fg">A rebuild is pending.</strong> This server is
                      still running what it was built with. Rebuilding on this version would change{" "}
                      {rebuildNeeded.join("; ")}. Its world is kept.
                    </div>
                  )}
                  <UpdateActions
                    slug={server.slug}
                    serverName={server.name}
                    offer={offer}
                    canUpdate={canUpdate}
                  />
                  {canUpdate && !simulated && server.runtimeId && (
                    <RebuildAction
                      slug={server.slug}
                      serverName={server.name}
                      nodeName={server.node.name}
                      versionLabel={server.version}
                      missing={false}
                    />
                  )}
                </>
              }
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
