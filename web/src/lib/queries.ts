import "server-only";
import { Prisma } from "@prisma/client";
import type { ServerState as DbServerState, EventTone, Role } from "@prisma/client";
import {
  ANALYTICS_RANGES,
  joinHeatmap,
  median,
  overlapMinutes,
  topPlayers,
  type AnalyticsRange,
  type SessionSpan,
} from "./analytics-rules";
import { isUp } from "@/domain/servers/state";
import { db } from "./db";
import type { Tone } from "./ui-types";

/* Presentation mappings. The database speaks in enums; the design
   speaks in tones and words. This is the only place they meet. */

/* Every state a server can be in, and how it reads. Pulsing means the
   state is transitional — something is happening and the row is about
   to change on its own. */
export const STATE_META: Record<DbServerState, { tone: Tone; label: string; pulse: boolean }> = {
  CREATING: { tone: "info", label: "Creating", pulse: true },
  INSTALLING: { tone: "info", label: "Installing", pulse: true },
  STARTING: { tone: "warning", label: "Starting", pulse: true },
  RUNNING: { tone: "success", label: "Running", pulse: false },
  // The workload is up but the game is not answering, which is a
  // different thing from being down and reads as one.
  UNHEALTHY: { tone: "warning", label: "Unhealthy", pulse: false },
  STOPPING: { tone: "warning", label: "Stopping", pulse: true },
  STOPPED: { tone: "muted", label: "Stopped", pulse: false },
  RESTARTING: { tone: "warning", label: "Restarting", pulse: true },
  UPDATING: { tone: "info", label: "Updating", pulse: true },
  BACKING_UP: { tone: "info", label: "Backing up", pulse: true },
  MIGRATING: { tone: "info", label: "Moving", pulse: true },
  DELETING: { tone: "danger", label: "Deleting", pulse: true },
  CRASHED: { tone: "danger", label: "Crashed", pulse: false },
  ERROR: { tone: "danger", label: "Error", pulse: false },
  SUSPENDED: { tone: "muted", label: "Suspended", pulse: false },
};

export const TONE_MAP: Record<EventTone, Tone> = {
  ACCENT: "accent",
  INFO: "info",
  SUCCESS: "success",
  WARNING: "warning",
  DANGER: "danger",
  MUTED: "muted",
};

/** "in 12 h 34 m" for a future instant, or a fallback when there is none. */
export function untilTime(date: Date | null, fallback = "paused") {
  if (!date) return fallback;
  const mins = Math.max(0, Math.round((date.getTime() - Date.now()) / 60000));
  if (mins < 60) return `in ${mins} m`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `in ${h} h ${mins % 60} m`;
  return `in ${Math.round(h / 24)} d`;
}

export function relativeTime(date: Date) {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function uptimeFrom(startedAt: Date | null) {
  if (!startedAt) return "—";
  const mins = Math.floor((Date.now() - startedAt.getTime()) / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  return d > 0 ? `${d} d ${h} h` : `${h} h`;
}

export function formatBytes(bytes: bigint) {
  const gb = Number(bytes) / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(Number(bytes) / 1024 ** 2).toFixed(0)} MB`;
}

/* What a server list puts first.

   Not the enum's declaration order, which is a lifecycle and would put a
   crashed server below a stopped one. This is attention order: the
   things that are wrong, then the things that are happening, then the
   things that are fine, then the things nobody is waiting on. */
const STATE_ORDER: Record<DbServerState, number> = {
  CRASHED: 0,
  ERROR: 0,
  UNHEALTHY: 1,
  CREATING: 2,
  INSTALLING: 2,
  UPDATING: 2,
  STARTING: 3,
  RESTARTING: 3,
  BACKING_UP: 3,
  MIGRATING: 2,
  STOPPING: 3,
  DELETING: 3,
  RUNNING: 4,
  STOPPED: 5,
  SUSPENDED: 6,
};

export async function getServers() {
  const servers = await db.server.findMany({
    orderBy: { name: "asc" },
    include: {
      node: { select: { name: true, city: true, pingMs: true, daemonUrl: true, daemonToken: true } },
    },
  });
  // Small lists; sorting here keeps the order deliberate rather than an
  // accident of how the enum happens to be declared.
  return servers
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state])
    .map(({ node: { daemonUrl, daemonToken, ...node }, ...server }) => ({
      ...server,
      node,
      /* Whether this server is only a record the simulator moves around.
         Worked out here so the encrypted agent token is read for the
         answer and never becomes part of what a page is handed. */
      simulated: !daemonUrl || !daemonToken,
    }));
}

export async function getServerBySlug(slug: string) {
  return db.server.findUnique({
    where: { slug },
    include: {
      node: true,
      owner: { select: { name: true, initials: true } },
      backups: { orderBy: { createdAt: "desc" }, take: 3 },
      players: { where: { online: true }, orderBy: { joinedAt: "asc" }, take: 10 },
      // The catalog row's slug is the version's id in its definition,
      // which is what the version outlook is keyed by.
      gameVersionRef: { select: { slug: true } },
    },
  });
}

/* The usage chart, over a chosen window, averaged into at most 120
   points and laid out in the 600×170 viewBox the design specifies.

   It used to read the first 60 samples in ascending order — the oldest
   ones the database held — so a server running for a week showed an
   hour from last week under an axis ending in "now". The window buttons
   did nothing. */
export const USAGE_RANGES = {
  "1h": 3600_000,
  "6h": 6 * 3600_000,
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
} as const;
export type UsageRange = keyof typeof USAGE_RANGES;

export async function getUsageSeries(serverId: string, range: UsageRange = "1h") {
  const now = Date.now();
  const from = new Date(now - USAGE_RANGES[range]);
  const samples = await db.metricSample.findMany({
    where: { serverId, at: { gte: from } },
    orderBy: { at: "asc" },
    select: { at: true, cpuPct: true, ramMb: true, players: true },
  });
  if (samples.length === 0) return null;

  const POINTS = 120;
  const span = USAGE_RANGES[range];
  const buckets = Array.from({ length: POINTS }, () => ({ cpu: 0, ram: 0, n: 0 }));
  for (const s of samples) {
    const i = Math.min(POINTS - 1, Math.floor(((s.at.getTime() - from.getTime()) / span) * POINTS));
    buckets[i]!.cpu += s.cpuPct;
    buckets[i]!.ram += s.ramMb;
    buckets[i]!.n++;
  }

  const W = 600;
  const H = 170;
  const points = buckets
    .map((b, i) => ({ i, cpu: b.n ? b.cpu / b.n : null, ram: b.n ? b.ram / b.n : null }))
    .filter((p): p is { i: number; cpu: number; ram: number } => p.cpu !== null);
  const maxRam = Math.max(...points.map((p) => p.ram), 1);
  const x = (i: number) => ((i + 0.5) / POINTS) * W;
  const latest = samples[samples.length - 1]!;

  const label = (t: Date) =>
    range === "7d"
      ? t.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })
      : t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return {
    cpu: points.map((p) => `${x(p.i).toFixed(1)},${(H - (Math.min(100, p.cpu) / 100) * H).toFixed(1)}`).join(" "),
    ram: points.map((p) => `${x(p.i).toFixed(1)},${(H - (p.ram / maxRam) * H * 0.8).toFixed(1)}`).join(" "),
    latest,
    ramGb: (latest.ramMb / 1024).toFixed(1),
    // Five evenly spaced times across the window, the last one "now".
    labels: Array.from({ length: 5 }, (_, i) => (i === 4 ? "now" : label(new Date(from.getTime() + (span * i) / 4)))),
    samples: samples.length,
  };
}

/* Each server's CPU over the last hour, in twelve five-minute averages,
   for the dashboard cards. A server with no samples in that hour gets
   no line at all: the card used to draw one computed from the current
   CPU figure, which looked like history and was not. */
export async function getRecentCpu(serverIds: string[]) {
  const SLOTS = 12;
  const span = 3600_000;
  const from = new Date(Date.now() - span);
  const samples = await db.metricSample.findMany({
    where: { serverId: { in: serverIds }, at: { gte: from } },
    select: { serverId: true, at: true, cpuPct: true },
  });

  const sums = new Map<string, { total: number; n: number }[]>();
  for (const s of samples) {
    const slots = sums.get(s.serverId) ?? Array.from({ length: SLOTS }, () => ({ total: 0, n: 0 }));
    const i = Math.min(SLOTS - 1, Math.floor(((s.at.getTime() - from.getTime()) / span) * SLOTS));
    slots[i]!.total += s.cpuPct;
    slots[i]!.n++;
    sums.set(s.serverId, slots);
  }

  // An empty slot repeats the one before it, so a gap reads as flat rather than as a drop to zero.
  const series = new Map<string, number[]>();
  for (const [id, slots] of sums) {
    let last = slots.find((b) => b.n > 0)!;
    series.set(
      id,
      slots.map((b) => {
        if (b.n > 0) last = b;
        return Math.min(100, last.total / last.n);
      }),
    );
  }
  return series;
}

export async function getDashboardStats() {
  const [servers, players, storage, nodes] = await Promise.all([
    db.server.groupBy({ by: ["state"], _count: true }),
    db.server.aggregate({ _sum: { playersOn: true, playersMax: true } }),
    db.server.aggregate({ _sum: { diskQuota: true } }),
    db.node.findMany({ select: { approvedAt: true, daemonUrl: true, daemonToken: true, state: true } }),
  ]);

  const total = servers.reduce((n, g) => n + g._count, 0);
  /* Up means the server is meant to be serving players. An unhealthy
     one is up and answering badly, which is a different problem from
     being down — counting it as down would hide it. */
  const up = servers
    .filter((g) => g.state === "RUNNING" || g.state === "STARTING" || g.state === "UNHEALTHY")
    .reduce((n, g) => n + g._count, 0);

  return {
    total,
    up,
    playersOnline: players._sum.playersOn ?? 0,
    playersMax: players._sum.playersMax ?? 0,
    storageGb: storage._sum.diskQuota ?? 0,
    /* In place of a median TPS: no game reports its tick rate yet, and
       the poller records the ceiling as a placeholder, so an average of
       it was 20.0 on every panel whatever the worlds were doing. */
    nodesInService: nodes.filter((n) => n.approvedAt !== null).length,
    nodesWithAgent: nodes.filter((n) => n.approvedAt !== null && n.daemonUrl && n.daemonToken).length,
    nodesPending: nodes.filter((n) => n.approvedAt === null).length,
    nodesHealthy: nodes.filter((n) => n.approvedAt !== null && n.state === "HEALTHY").length,
  };
}

export async function getActivity(take = 3) {
  return db.activityEvent.findMany({ orderBy: { createdAt: "desc" }, take });
}

export async function getNodes() {
  return db.node.findMany({ orderBy: { pingMs: "asc" } });
}

/* ── Backups ──────────────────────────────────────────────────── */

export async function getBackups(serverSlug?: string) {
  return db.backup.findMany({
    where: serverSlug ? { server: { slug: serverSlug } } : undefined,
    orderBy: { createdAt: "desc" },
    include: { server: { select: { name: true, slug: true } } },
  });
}

/* Archives are written to the disks of the nodes that made them, so
   that is what they are measured against. There used to be a fixed
   400 GB "pool" here, which no machine had ever reported and which an
   empty workspace showed as 400 GB free. */
export async function getBackupStorage() {
  const [agg, count, disks] = await Promise.all([
    // Only what is on the nodes' disks counts against the nodes' disks.
    db.backup.aggregate({ _sum: { sizeBytes: true }, where: { store: { not: "S3" } } }),
    db.backup.count(),
    db.node.aggregate({ _sum: { diskTotal: true }, where: { approvedAt: { not: null } } }),
  ]);
  const usedGb = Number(agg._sum.sizeBytes ?? BigInt(0)) / 1024 ** 3;
  const diskGb = disks._sum.diskTotal ?? 0;
  return {
    count,
    usedGb,
    diskGb,
    pct: diskGb > 0 ? Math.min(100, Math.round((usedGb / diskGb) * 100)) : 0,
  };
}

/* ── Players ──────────────────────────────────────────────────── */

export async function getPlayerSessions(serverSlug?: string, take = 100) {
  const where = serverSlug ? { server: { slug: serverSlug } } : undefined;
  const [online, recent] = await Promise.all([
    db.playerSession.findMany({
      where: { ...where, online: true },
      orderBy: { joinedAt: "asc" },
      include: { server: { select: { name: true, slug: true } } },
    }),
    db.playerSession.findMany({
      where: { ...where, online: false },
      orderBy: { joinedAt: "desc" },
      take,
      include: { server: { select: { name: true, slug: true } } },
    }),
  ]);
  return { online, recent };
}

/* ── Analytics ────────────────────────────────────────────────── */

/* Everything on the Analytics page, over one window, from the two things
   the poller records: a usage sample per running server per pass, and a
   session per join it read from a console.

   The samples are aggregated in the database. At one sample every
   fifteen seconds a server writes 170,000 rows a month, which is not
   something to pull into the page to average. */
export async function getAnalytics(range: AnalyticsRange) {
  const to = new Date();
  const span = ANALYTICS_RANGES[range];
  const from = new Date(to.getTime() - span);
  const SLOTS = 84;
  const bucketMs = Math.ceil(span / SLOTS);

  const [concurrency, perServer, sessions, servers] = await Promise.all([
    /* Players online per slot: each server's highest count in the slot,
       added across servers. Adding raw samples would count a server once
       per poll pass that landed in the slot. */
    db.$queryRaw<{ slot: bigint; players: number }[]>(Prisma.sql`
      SELECT slot, SUM(peak)::int AS players FROM (
        SELECT FLOOR(EXTRACT(EPOCH FROM "at") * 1000 / ${bucketMs})::bigint AS slot, "serverId", MAX("players") AS peak
        FROM "metric_samples" WHERE "at" >= ${from}
        GROUP BY 1, 2
      ) per_server
      GROUP BY slot ORDER BY slot`),
    db.$queryRaw<
      { serverId: string; cpuAvg: number; cpuMax: number; ramAvg: number; ramMax: number; playersMax: number; samples: number }[]
    >(Prisma.sql`
      SELECT "serverId", AVG("cpuPct")::float AS "cpuAvg", MAX("cpuPct") AS "cpuMax",
             AVG("ramMb")::float AS "ramAvg", MAX("ramMb") AS "ramMax",
             MAX("players") AS "playersMax", COUNT(*)::int AS samples
      FROM "metric_samples" WHERE "at" >= ${from}
      GROUP BY 1`),
    db.playerSession.findMany({
      where: { joinedAt: { lt: to }, OR: [{ leftAt: null }, { leftAt: { gte: from } }] },
      select: { username: true, joinedAt: true, leftAt: true, online: true, server: { select: { name: true } } },
    }),
    db.server.findMany({ select: { id: true, name: true, slug: true, gameId: true, memoryLimit: true } }),
  ]);

  const spans: SessionSpan[] = sessions.map((s) => ({
    username: s.username,
    serverName: s.server.name,
    joinedAt: s.joinedAt,
    // A session still marked online is open; one closed without a time is treated as open too, and clipped to now.
    leftAt: s.online ? null : s.leftAt,
  }));
  const inWindow = spans.filter((s) => overlapMinutes(s, from, to) > 0);
  const firstSlot = Math.floor(from.getTime() / bucketMs);
  const series = Array.from({ length: SLOTS }, (_, i) => ({ at: new Date((firstSlot + i) * bucketMs), players: null as number | null }));
  for (const row of concurrency) {
    const i = Number(row.slot) - firstSlot;
    if (i >= 0 && i < SLOTS) series[i]!.players = row.players;
  }
  const peak = series.reduce<(typeof series)[number] | null>((best, p) => (p.players !== null && (!best || p.players > best.players!) ? p : best), null);
  const byId = new Map(perServer.map((r) => [r.serverId, r]));

  return {
    from,
    to,
    series,
    peak: peak && peak.players! > 0 ? peak : null,
    uniquePlayers: new Set(inWindow.map((s) => s.username)).size,
    sessionCount: inWindow.length,
    medianSessionMinutes: median(
      inWindow.filter((s) => s.leftAt && s.joinedAt >= from).map((s) => (s.leftAt!.getTime() - s.joinedAt.getTime()) / 60_000),
    ),
    playtimeMinutes: inWindow.reduce((sum, s) => sum + overlapMinutes(s, from, to), 0),
    top: topPlayers(inWindow, from, to),
    heatmap: joinHeatmap(spans.filter((s) => s.joinedAt >= from).map((s) => s.joinedAt)),
    servers: servers
      .map((s) => ({ ...s, usage: byId.get(s.id) ?? null }))
      .sort((a, b) => (b.usage?.samples ?? 0) - (a.usage?.samples ?? 0) || a.name.localeCompare(b.name)),
  };
}

/* ── Scheduler ────────────────────────────────────────────────── */

export async function getTasks(serverSlug?: string) {
  return db.scheduledTask.findMany({
    where: serverSlug ? { server: { slug: serverSlug } } : undefined,
    orderBy: [{ enabled: "desc" }, { nextRunAt: "asc" }],
    include: { server: { select: { name: true, slug: true } } },
  });
}

/* ── Audit log ────────────────────────────────────────────────── */

export const AUDIT_PAGE_SIZE = 25;

export interface AuditFilter {
  q?: string;
  actor?: string;
  days?: number;
  page?: number;
  /** One server's events, by slug. */
  server?: string;
}

/* A server is found by its name or slug whether it still exists or not:
   the link while it does, what was written onto its events when it was
   deleted after that. A slug can be taken again by a newer server, and a
   filter on it then shows both — each line says which is deleted. */
function auditWhere({ q, actor, days, server }: AuditFilter): Prisma.ActivityEventWhereInput {
  const all: Prisma.ActivityEventWhereInput[] = [];

  if (q) {
    all.push({
      OR: [
        { actor: { contains: q, mode: "insensitive" } },
        { action: { contains: q, mode: "insensitive" } },
        { target: { contains: q, mode: "insensitive" } },
        { server: { name: { contains: q, mode: "insensitive" } } },
        { originServerName: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (actor) all.push({ actor });
  if (days) all.push({ createdAt: { gte: new Date(Date.now() - days * 24 * 3600_000) } });
  if (server) all.push({ OR: [{ server: { slug: server } }, { originServerSlug: server }] });
  return all.length ? { AND: all } : {};
}

/* The same filter the page is showing, without its pages, for export.
   Capped: an export is a file somebody downloads, not a way to ask the
   database for everything it has ever recorded. */
export const AUDIT_EXPORT_LIMIT = 5000;

export async function getAuditExport(filter: AuditFilter) {
  return db.activityEvent.findMany({
    where: auditWhere(filter),
    orderBy: { createdAt: "desc" },
    take: AUDIT_EXPORT_LIMIT,
    include: { user: { select: { email: true } }, server: { select: { name: true, slug: true } } },
  });
}

export async function getAuditEvents({ q, actor, days, server, page = 1 }: AuditFilter) {
  const where = auditWhere({ q, actor, days, server });

  const [events, total] = await Promise.all([
    db.activityEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      include: {
        user: { select: { initials: true, email: true } },
        server: { select: { name: true, slug: true } },
      },
    }),
    db.activityEvent.count({ where }),
  ]);

  return { events, total, page, pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) };
}

export async function getAuditActors() {
  const rows = await db.activityEvent.groupBy({ by: ["actor"], _count: true });
  return rows.sort((a, b) => b._count - a._count).map((r) => ({ actor: r.actor, count: r._count }));
}

export async function getAuditEvent(id: string) {
  return db.activityEvent.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, initials: true, email: true } },
      server: { select: { name: true, slug: true } },
    },
  });
}

/* ── Nodes ────────────────────────────────────────────────────── */

export async function getNodesWithLoad() {
  const nodes = await db.node.findMany({
    orderBy: { pingMs: "asc" },
    include: {
      servers: {
        select: { id: true, state: true, memoryLimit: true, diskQuota: true, cpuLimit: true },
      },
    },
  });

  return nodes.map((n) => {
    const running = n.servers.filter((s) => isUp(s.state)).length;
    return {
      ...n,
      hasAgent: Boolean(n.daemonUrl && n.daemonToken),
      serverCount: n.servers.length,
      running,
      /* Committed is what has been promised to containers, which can
         exceed live usage — the number that decides whether another
         server fits. */
      committedRamGb: n.servers.reduce((sum, s) => sum + s.memoryLimit, 0),
      committedDiskGb: n.servers.reduce((sum, s) => sum + s.diskQuota, 0),
      committedCpuPct: n.servers.reduce((sum, s) => sum + s.cpuLimit, 0),
    };
  });
}

export async function getNodeByName(name: string) {
  return db.node.findUnique({
    where: { name },
    include: {
      servers: {
        orderBy: [{ state: "asc" }, { name: "asc" }],
        include: { owner: { select: { name: true, initials: true } } },
      },
    },
  });
}

/* ── Members ──────────────────────────────────────────────────── */

export async function getMembers() {
  const users = await db.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    include: {
      servers: { select: { id: true, name: true, slug: true } },
      _count: { select: { apiKeys: true, sessions: true } },
    },
  });

  return users.map((u) => ({
    ...u,
    activeKeys: u._count.apiKeys,
    sessions: u._count.sessions,
  }));
}

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MODERATOR: "Moderator",
  MEMBER: "Member",
};

export const ROLE_TONE: Record<Role, Tone> = {
  OWNER: "accent",
  ADMIN: "info",
  MODERATOR: "success",
  MEMBER: "muted",
};

/* What the permission matrix actually grants — see
   domain/access/permissions.ts. There is no billing and no workspace to
   delete, so neither is promised here. */
export const ROLE_BLURB: Record<Role, string> = {
  OWNER: "Everything: nodes, servers, members and other owners.",
  ADMIN: "Everything except granting or removing the owner role.",
  MODERATOR: "Watches every console; runs and configures their own servers.",
  MEMBER: "Sees every server; runs and configures their own.",
};

/* ── API keys ─────────────────────────────────────────────────── */

export async function getApiKeys(viewer: { id: string; role: Role }) {
  const privileged = viewer.role === "OWNER" || viewer.role === "ADMIN";
  return db.apiKey.findMany({
    where: privileged ? undefined : { userId: viewer.id },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    include: { user: { select: { name: true, initials: true } } },
  });
}
