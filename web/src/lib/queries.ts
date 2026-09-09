import "server-only";
import { Prisma } from "@prisma/client";
import type { ServerState as DbServerState, EventTone, Role } from "@prisma/client";
import { db } from "./db";
import type { Tone } from "./ui-types";

/* Presentation mappings. The database speaks in enums; the design
   speaks in tones and words. This is the only place they meet. */

export const STATE_META: Record<DbServerState, { tone: Tone; label: string; pulse: boolean }> = {
  RUNNING: { tone: "success", label: "Running", pulse: false },
  STARTING: { tone: "warning", label: "Starting", pulse: true },
  STOPPING: { tone: "warning", label: "Stopping", pulse: true },
  STOPPED: { tone: "muted", label: "Stopped", pulse: false },
  CRASHED: { tone: "danger", label: "Crashed", pulse: false },
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

export async function getServers() {
  return db.server.findMany({
    orderBy: [{ state: "asc" }, { name: "asc" }],
    include: { node: { select: { name: true, city: true, pingMs: true } } },
  });
}

export async function getServerBySlug(slug: string) {
  return db.server.findUnique({
    where: { slug },
    include: {
      node: true,
      owner: { select: { name: true, initials: true } },
      backups: { orderBy: { createdAt: "desc" }, take: 3 },
      players: { where: { online: true }, orderBy: { pingMs: "asc" }, take: 5 },
    },
  });
}

/* The usage chart reads the last hour and normalises into the
   600×170 viewBox the design specifies. */
export async function getUsageSeries(serverId: string) {
  const samples = await db.metricSample.findMany({
    where: { serverId },
    orderBy: { at: "asc" },
    take: 60,
    select: { at: true, cpuPct: true, ramMb: true },
  });
  if (samples.length === 0) return null;

  const W = 600;
  const H = 170;
  const maxRam = Math.max(...samples.map((s) => s.ramMb), 1);
  const x = (i: number) => (i / Math.max(samples.length - 1, 1)) * W;

  return {
    cpu: samples.map((s, i) => `${x(i).toFixed(1)},${(H - (s.cpuPct / 100) * H).toFixed(1)}`).join(" "),
    ram: samples.map((s, i) => `${x(i).toFixed(1)},${(H - (s.ramMb / maxRam) * H * 0.8).toFixed(1)}`).join(" "),
    latest: samples[samples.length - 1],
    ramGb: (samples[samples.length - 1].ramMb / 1024).toFixed(1),
    labels: samples
      .filter((_, i) => i % 12 === 0 || i === samples.length - 1)
      .map((s, i, arr) =>
        i === arr.length - 1
          ? "now"
          : s.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      ),
  };
}

export async function getDashboardStats() {
  const [servers, players, storage, tps] = await Promise.all([
    db.server.groupBy({ by: ["state"], _count: true }),
    db.server.aggregate({ _sum: { playersOn: true, playersMax: true } }),
    db.server.aggregate({ _sum: { diskQuota: true } }),
    db.metricSample.aggregate({ _avg: { tps: true } }),
  ]);

  const total = servers.reduce((n, g) => n + g._count, 0);
  const up = servers
    .filter((g) => g.state === "RUNNING" || g.state === "STARTING")
    .reduce((n, g) => n + g._count, 0);

  return {
    total,
    up,
    playersOnline: players._sum.playersOn ?? 0,
    playersMax: players._sum.playersMax ?? 0,
    storageGb: storage._sum.diskQuota ?? 0,
    medianTps: (tps._avg.tps ?? 20).toFixed(1),
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

/* The pool is a fixed allocation per workspace until nodes report
   their real backup volumes. */
export const BACKUP_POOL_GB = 400;

export async function getBackupStorage() {
  const agg = await db.backup.aggregate({ _sum: { sizeBytes: true }, _count: true });
  const usedGb = Number(agg._sum.sizeBytes ?? BigInt(0)) / 1024 ** 3;
  return {
    count: agg._count,
    usedGb,
    poolGb: BACKUP_POOL_GB,
    freeGb: Math.max(0, BACKUP_POOL_GB - usedGb),
    pct: Math.min(100, Math.round((usedGb / BACKUP_POOL_GB) * 100)),
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
}

export async function getAuditEvents({ q, actor, days, page = 1 }: AuditFilter) {
  const where: Prisma.ActivityEventWhereInput = {};

  if (q) {
    where.OR = [
      { actor: { contains: q, mode: "insensitive" } },
      { action: { contains: q, mode: "insensitive" } },
      { target: { contains: q, mode: "insensitive" } },
    ];
  }
  if (actor) where.actor = actor;
  if (days) where.createdAt = { gte: new Date(Date.now() - days * 24 * 3600_000) };

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
    const running = n.servers.filter((s) => s.state === "RUNNING" || s.state === "STARTING").length;
    return {
      ...n,
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

export const ROLE_BLURB: Record<Role, string> = {
  OWNER: "Full control, including billing and deleting the workspace.",
  ADMIN: "Everything except workspace deletion and owner changes.",
  MODERATOR: "Console and player moderation on servers they are given.",
  MEMBER: "Read-only, plus whatever their own servers allow.",
};
