import "server-only";
import type { ServerState as DbServerState, EventTone } from "@prisma/client";
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
