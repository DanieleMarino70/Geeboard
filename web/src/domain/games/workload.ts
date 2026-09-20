import type { ProvisionPlan } from "../runtime/types";
import { provisionPorts, resourceEnvFor, type GameDefinition, type GameVersion } from "./types";

/* What a workload is given, and whether that is still what it would be
   given today.

   A server's workload is made once — at creation, at an update, at a
   rebuild — from the version's definition and the server's settings, and
   it keeps what it was given until it is made again. When a definition
   changes what a version runs or how (Zomboid moving image, a private
   port moving to loopback, a heap now sized from the limit), existing
   servers go on running the old thing, and nothing said so: **Rebuild on
   this version** fixed it for whoever happened to know it was needed.

   So what a workload was made from is written down when it is made, and
   compared with what it would be made from now. It also replaces four
   copies of the same object literal — create, update, settings rebuild
   and move each assembled the plan themselves, and the comparison only
   means something if they all mean the same thing by it. */

export interface WorkloadSubject {
  id: string;
  slug: string;
  /** The first port of the block allocated on the node. */
  port: number;
  memoryGb: number;
  cpuLimit: number;
}

export function workloadPlan(
  game: GameDefinition,
  version: Pick<GameVersion, "image">,
  subject: WorkloadSubject,
  rendered: { env: Record<string, string>; args: string[] },
): ProvisionPlan {
  const memoryMb = subject.memoryGb * 1024;
  return {
    serverId: subject.id,
    name: subject.slug,
    source: version.image,
    ports: provisionPorts(game, subject.port),
    memoryMb,
    cpuLimit: subject.cpuLimit,
    env: {
      ...rendered.env,
      ...resourceEnvFor(game, { memoryMb, portBase: subject.port }),
      GEEBOARD_SERVER: subject.slug,
    },
    dataPath: game.dataPath,
    cachePaths: game.cachePaths,
    args: rendered.args,
    // The installer starts it after the config is written, not before.
    start: false,
  };
}

/* The part of a plan that can be compared across time. Stored on the
   server row as JSON when the workload is made.

   Secrets are left out: they are random per workload and stored nowhere,
   so they differ every time and mean nothing. Everything else a server's
   settings put in its environment is already on its row in the clear. */
export interface WorkloadSpec {
  source: string;
  env: Record<string, string>;
  args: string[];
  dataPath: string;
  /** Absent on a spec recorded before cache mounts existed; read as none. */
  cachePaths?: string[];
  ports: Array<{ host: number; container: number; protocol: string; loopback: boolean }>;
  memoryMb: number;
  cpuLimit: number;
}

export function workloadSpec(plan: ProvisionPlan, game: Pick<GameDefinition, "resourceEnv">): WorkloadSpec {
  const secret = new Set(Object.keys(game.resourceEnv?.secrets ?? {}));
  const env: Record<string, string> = {};
  for (const key of Object.keys(plan.env).sort()) {
    if (!secret.has(key)) env[key] = plan.env[key]!;
  }
  return {
    source: plan.source,
    env,
    args: [...plan.args],
    dataPath: plan.dataPath ?? "/data",
    cachePaths: [...(plan.cachePaths ?? [])],
    ports: plan.ports.map((p) => ({ host: p.host, container: p.container, protocol: p.protocol, loopback: p.loopback })),
    memoryMb: plan.memoryMb,
    cpuLimit: plan.cpuLimit,
  };
}

/** What was stored, if it still has the shape of a spec. Anything else is "not recorded". */
export function readWorkloadSpec(stored: unknown): WorkloadSpec | null {
  if (!stored || typeof stored !== "object") return null;
  const spec = stored as Partial<WorkloadSpec>;
  if (typeof spec.source !== "string" || typeof spec.env !== "object" || spec.env === null) return null;
  if (!Array.isArray(spec.args) || !Array.isArray(spec.ports)) return null;
  return spec as WorkloadSpec;
}

/* What differs, in words for the version panel. The panel does not talk
   about images, so a changed source is "the build it runs"; variables are
   named, because their names are what an operator would search for. */
export function workloadDifferences(built: WorkloadSpec, now: WorkloadSpec): string[] {
  const out: string[] = [];
  if (built.source !== now.source) out.push("the build it runs");

  /* Empty and absent are one thing here. A new server leaves an unset
     setting out of its environment and a rebuild writes it as empty — so
     that clearing a password is possible — and a server must not be told
     it needs a rebuild the moment it has been created. */
  const names = new Set([...Object.keys(built.env), ...Object.keys(now.env)]);
  const changed = [...names].filter((name) => (built.env[name] ?? "") !== (now.env[name] ?? "")).sort();
  if (changed.length > 0) {
    out.push(`${changed.length === 1 ? "a start-up variable" : `${changed.length} start-up variables`} (${changed.join(", ")})`);
  }

  if (JSON.stringify(built.args) !== JSON.stringify(now.args)) out.push("its start arguments");
  if (built.dataPath !== now.dataPath) out.push("where its files are mounted");
  if ((built.cachePaths ?? []).join() !== (now.cachePaths ?? []).join()) {
    out.push("what it keeps between rebuilds instead of downloading again");
  }
  /* Field by field, not as text: the stored half has been through a JSONB
     column, which hands an object's keys back in its own order, and every
     server read as needing a rebuild for ports that had not changed. */
  const port = (p: WorkloadSpec["ports"][number]) => `${p.host}:${p.container}/${p.protocol}${p.loopback ? "@loopback" : ""}`;
  if (built.ports.map(port).join() !== now.ports.map(port).join()) out.push("how its ports are published");
  if (built.memoryMb !== now.memoryMb) out.push(`its memory limit (${built.memoryMb / 1024} GB → ${now.memoryMb / 1024} GB)`);
  if (built.cpuLimit !== now.cpuLimit) out.push(`its CPU limit (${built.cpuLimit}% → ${now.cpuLimit}%)`);
  return out;
}
