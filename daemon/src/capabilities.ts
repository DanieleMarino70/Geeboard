import { cpus, freemem, networkInterfaces, totalmem } from "node:os";
import { statfs } from "node:fs/promises";
import process from "node:process";

/* What this machine is, and what it is willing to run.

   Two different questions, and conflating them is how a node ends up
   advertising something it cannot do.

   What the machine *is* — cores, memory, disk, architecture, whether it
   has IPv6 — can be measured, and is. What it is *willing to run* mostly
   cannot be. Game servers run in containers, so whether the node itself
   has SteamCMD or a JDK installed tells you nothing; what matters is
   whether the operator wants Steam workloads here, and that is a policy,
   not a fact about the hardware.

   So: measure what is measurable, and take the rest from configuration,
   where somebody has signed their name to it. A capability nobody can
   verify is a claim, and a claim belongs in a config file rather than in
   a probe that guesses. */

export interface Resources {
  cpuCores: number;
  ramTotalGb: number;
  diskTotalGb: number;
}

export interface Load {
  cpuPct: number;
  ramPct: number;
  diskPct: number;
}

/** The architecture, in the vocabulary the game definitions use. */
export function architecture(): string {
  switch (process.arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "arm64";
    default:
      // Reporting an architecture nothing matches is better than
      // claiming one; the panel treats unknown as unknown, not as wrong.
      return process.arch;
  }
}

export function operatingSystem(): string {
  return process.platform === "linux" ? "linux" : process.platform === "win32" ? "windows" : process.platform;
}

/** True when this machine has a routable IPv6 address, not just a loopback. */
export function hasIpv6(): boolean {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv6" && !address.internal) return true;
    }
  }
  return false;
}

export async function resources(dataRoot: string): Promise<Resources> {
  return {
    cpuCores: cpus().length || 1,
    ramTotalGb: Math.max(1, Math.round(totalmem() / 1024 ** 3)),
    diskTotalGb: Math.max(1, Math.round((await diskBytes(dataRoot)).total / 1024 ** 3)),
  };
}

export async function load(dataRoot: string): Promise<Load> {
  const disk = await diskBytes(dataRoot);
  return {
    cpuPct: await cpuPercent(),
    ramPct: Math.round(((totalmem() - freemem()) / Math.max(1, totalmem())) * 100),
    diskPct: disk.total > 0 ? Math.round(((disk.total - disk.free) / disk.total) * 100) : 0,
  };
}

/* The filesystem the servers actually live on, not the root one. A node
   with a small root disk and a large mounted volume for game data is the
   normal shape, and reporting the wrong one would make every placement
   decision on this node wrong. */
async function diskBytes(dataRoot: string): Promise<{ total: number; free: number }> {
  try {
    const stats = await statfs(dataRoot);
    return { total: stats.blocks * stats.bsize, free: stats.bfree * stats.bsize };
  } catch {
    // The directory may not exist yet on a node that has never run one.
    return { total: 0, free: 0 };
  }
}

/* CPU load, sampled over a short window.

   os.loadavg() would be cheaper and is meaningless on Windows and
   misleading everywhere else — it counts runnable processes, not busy
   time. Two readings of the per-core tick counters is the honest
   measure, and 200ms is long enough to be stable without holding up a
   heartbeat. */
async function cpuPercent(windowMs = 200): Promise<number> {
  const before = ticks();
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  const after = ticks();

  const idle = after.idle - before.idle;
  const total = after.total - before.total;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
}

function ticks() {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    for (const [kind, value] of Object.entries(cpu.times)) {
      total += value;
      if (kind === "idle") idle += value;
    }
  }
  return { idle, total };
}

/* What the node offers, measured where possible and declared otherwise.

   `docker` is present because this agent is the Docker agent — if the
   engine were unreachable the agent would be failing its own health
   check, so claiming it here is not a guess. `high-memory` is derived,
   because it genuinely is a fact about the machine. Everything else
   comes from GEEBOARD_CAPABILITIES. */
const HIGH_MEMORY_GB = 32;

export async function capabilities(declared: string[], dataRoot: string): Promise<string[]> {
  const found = new Set<string>(declared);
  found.add("docker");
  if (hasIpv6()) found.add("ipv6");

  const { ramTotalGb } = await resources(dataRoot);
  if (ramTotalGb >= HIGH_MEMORY_GB) found.add("high-memory");

  return [...found].sort();
}
