import { cpus, freemem, networkInterfaces, totalmem } from "node:os";
import { statfs } from "node:fs/promises";
import path from "node:path";
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

/* ── Platform ──────────────────────────────────────────────────────
   Which OS and architecture a game server on this node will run on.

   That is the engine's, not the host's. Docker Desktop on Windows runs
   Linux containers inside a VM, so a Windows machine hosts Linux game
   servers — and a node reporting "windows" made every game in the
   catalog incompatible with a machine that could run all of them. The
   host's own values are only the answer when the engine cannot be
   asked. */

export interface Platform {
  os: string;
  arch: string;
}

/** What the engine says about itself: Docker's /info fields. */
export interface EngineInfo {
  OSType?: string;
  Architecture?: string;
}

/* The architecture, in the vocabulary the game definitions use.

   Three vocabularies arrive here: Node's (`x64`), the kernel's as Docker
   /info reports it (`x86_64`, `aarch64`), and Go's (`amd64`), which is
   what `docker version` prints. They name the same two machines. */
export function normaliseArchitecture(raw: string): string {
  switch (raw.trim().toLowerCase()) {
    case "x64":
    case "x86_64":
    case "amd64":
      return "x64";
    case "arm64":
    case "aarch64":
      return "arm64";
    default:
      // Reporting an architecture nothing matches is better than
      // claiming one; the panel treats unknown as unknown, not as wrong.
      return raw.trim().toLowerCase();
  }
}

export function normaliseOperatingSystem(raw: string): string {
  const value = raw.trim().toLowerCase();
  return value === "win32" ? "windows" : value;
}

/** The host's architecture: the fallback when the engine cannot say. */
export function architecture(): string {
  return normaliseArchitecture(process.arch);
}

/** The host's operating system: the fallback when the engine cannot say. */
export function operatingSystem(): string {
  return normaliseOperatingSystem(process.platform);
}

const ENGINE_TIMEOUT_MS = 5_000;

/* Asks the engine on every call, and remembers its last answer.

   The memory is the point. Falling straight back to the host on a failed
   call would make a Windows node report "windows" for the fifteen seconds
   Docker Desktop takes to restart, and every compatibility check made in
   that window would refuse the node for a reason that is not true. So the
   host's values are used only until the engine has answered once.

   Bounded, because this runs inside the heartbeat, and an engine that
   hangs must not stop the node saying it is alive. */
export function platformReporter(
  ask: () => Promise<EngineInfo>,
  timeoutMs = ENGINE_TIMEOUT_MS,
): () => Promise<Platform> {
  let known: Platform | null = null;

  return async () => {
    try {
      const info = await withTimeout(ask(), timeoutMs);
      // Field by field: an engine that names its OS and not its
      // architecture still knows its OS better than the host does.
      known = {
        os: info.OSType ? normaliseOperatingSystem(info.OSType) : (known?.os ?? operatingSystem()),
        arch: info.Architecture
          ? normaliseArchitecture(info.Architecture)
          : (known?.arch ?? architecture()),
      };
      return known;
    } catch {
      return known ?? { os: operatingSystem(), arch: architecture() };
    }
  };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer in ${ms}ms`)), ms);
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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
   decision on this node wrong.

   On a node that has never run a server the data root does not exist
   yet. This used to answer zero, which the panel floors to 1 GB — and a
   brand-new node then refused every game as out of storage. The nearest
   directory that does exist is on the filesystem the data root will be
   created on, so that is what gets measured. */
export async function diskBytes(dataRoot: string): Promise<{ total: number; free: number }> {
  let at = path.resolve(dataRoot);
  for (;;) {
    try {
      const stats = await statfs(at);
      return { total: stats.blocks * stats.bsize, free: stats.bfree * stats.bsize };
    } catch {
      const parent = path.dirname(at);
      if (parent === at) return { total: 0, free: 0 };
      at = parent;
    }
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
