import {
  CAPABILITY_LABELS,
  type Architecture,
  type CapabilityId,
  type GameDefinition,
  type OperatingSystem,
} from "../games/types";

/* Can this game run on that node?

   Three answers, not two. "Incompatible" is a fact — eight gigabytes
   will not fit in four. "Partial" is an admission: the node has not told
   us its architecture yet, or it is degraded, so the placement might
   work and might not. Collapsing partial into either of the others is
   how an operator ends up either blocked for no reason or debugging a
   server that never had a chance.

   Every answer comes with its reasons, because "incompatible" on its own
   is not something anybody can act on. */

export type NodeHealth = "HEALTHY" | "DEGRADED" | "UNREACHABLE" | "DRAINING";

/** What the engine needs to know about a node. Read from the DB, not the agent. */
export interface NodeProfile {
  name: string;
  region: string;
  state: NodeHealth;
  pingMs: number;
  /** Null until the node has reported it. Unknown is not the same as wrong. */
  os: OperatingSystem | null;
  arch: Architecture | null;
  capabilities: CapabilityId[];
  /** Percent of one core, summed over every core. 16 cores is 1600. */
  cpuTotalPct: number;
  ramTotalGb: number;
  diskTotalGb: number;
  /* Committed, not used. A node whose servers are idle still has its
     memory promised to them, and the moment they are all busy is exactly
     when a placement made against current usage falls over. */
  cpuCommittedPct: number;
  ramCommittedGb: number;
  diskCommittedGb: number;
  servers: number;
  hasAgent: boolean;
}

export interface ResourceRequest {
  memoryGb: number;
  /** Percent of one core. */
  cpuLimit: number;
  diskGb: number;
}

export type Verdict = "compatible" | "partial" | "incompatible";

export interface Reason {
  /** Whether this check passed. `null` means it could not be checked. */
  ok: boolean | null;
  label: string;
  detail?: string;
}

export interface CompatibilityReport {
  node: string;
  verdict: Verdict;
  reasons: Reason[];
  /** What would be left over after this placement, as a fraction. */
  headroom: { cpu: number; ram: number; disk: number };
}

function fraction(free: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, free / total));
}

export function checkCompatibility(
  game: GameDefinition,
  node: NodeProfile,
  request: ResourceRequest,
): CompatibilityReport {
  const reasons: Reason[] = [];
  let incompatible = false;
  let unknown = false;

  const fail = (label: string, detail?: string) => {
    reasons.push({ ok: false, label, detail });
    incompatible = true;
  };
  const unsure = (label: string, detail?: string) => {
    reasons.push({ ok: null, label, detail });
    unknown = true;
  };
  const pass = (label: string, detail?: string) => reasons.push({ ok: true, label, detail });

  /* ── Availability ─────────────────────────────────────────────── */
  if (node.state === "UNREACHABLE") {
    fail("Node reachable", "The panel cannot see this node.");
  } else if (node.state === "DRAINING") {
    fail("Accepting servers", "It is being emptied, so it will not take new ones.");
  } else if (node.state === "DEGRADED") {
    unsure("Node healthy", "It is degraded — a placement here may not settle.");
  } else {
    pass("Node healthy");
  }

  if (!node.hasAgent) {
    /* Without an agent the panel can write a row and nothing else. Not
       a refusal — the seeded workspace runs this way on purpose — but
       never something to recommend. */
    unsure("Agent attached", "No agent on this node, so the server would be simulated.");
  } else {
    pass("Agent attached");
  }

  /* ── Platform ─────────────────────────────────────────────────── */
  if (node.os === null) {
    unsure("Operating system", "The node has not reported one yet.");
  } else if (!game.requirements.os.includes(node.os)) {
    fail("Operating system", `${game.name} needs ${game.requirements.os.join(" or ")}, not ${node.os}.`);
  } else {
    pass("Operating system", node.os);
  }

  if (node.arch === null) {
    unsure("Architecture", "The node has not reported one yet.");
  } else if (!game.requirements.arch.includes(node.arch)) {
    fail("Architecture", `${game.name} needs ${game.requirements.arch.join(" or ")}, not ${node.arch}.`);
  } else {
    pass("Architecture", node.arch);
  }

  /* ── Capabilities ─────────────────────────────────────────────── */
  const missing: CapabilityId[] = game.requirements.capabilities.filter(
    (c) => !node.capabilities.includes(c),
  );
  if (game.requirements.capabilities.length === 0) {
    pass("Capabilities", "none required");
  } else if (node.capabilities.length === 0) {
    unsure("Capabilities", "The node has not reported what it can do.");
  } else if (missing.length > 0) {
    fail("Capabilities", `missing ${missing.map((c) => CAPABILITY_LABELS[c]).join(", ")}`);
  } else {
    pass("Capabilities", game.requirements.capabilities.map((c) => CAPABILITY_LABELS[c]).join(", "));
  }

  /* ── Resources ────────────────────────────────────────────────── */
  const ramFree = node.ramTotalGb - node.ramCommittedGb;
  const cpuFree = node.cpuTotalPct - node.cpuCommittedPct;
  const diskFree = node.diskTotalGb - node.diskCommittedGb;

  if (request.memoryGb > ramFree) {
    fail("Memory", `${request.memoryGb} GB requested, ${ramFree} GB uncommitted.`);
  } else {
    pass("Memory", `${request.memoryGb} of ${ramFree} GB free`);
  }

  if (request.cpuLimit > cpuFree) {
    fail("CPU", `${request.cpuLimit / 100} cores requested, ${cpuFree / 100} uncommitted.`);
  } else {
    pass("CPU", `${request.cpuLimit / 100} of ${cpuFree / 100} cores free`);
  }

  if (request.diskGb > diskFree) {
    fail("Storage", `${request.diskGb} GB requested, ${diskFree} GB uncommitted.`);
  } else {
    pass("Storage", `${request.diskGb} of ${diskFree} GB free`);
  }

  /* The game's own floor, which is not the same as what the operator
     asked for — a request below it is a server that starts and then
     falls over under load, which is the worst way to find out. */
  if (request.memoryGb < game.requirements.memoryGbMin) {
    fail("Meets the game's minimum", `${game.name} needs at least ${game.requirements.memoryGbMin} GB.`);
  }

  return {
    node: node.name,
    verdict: incompatible ? "incompatible" : unknown ? "partial" : "compatible",
    reasons,
    headroom: {
      cpu: fraction(cpuFree - request.cpuLimit, node.cpuTotalPct),
      ram: fraction(ramFree - request.memoryGb, node.ramTotalGb),
      disk: fraction(diskFree - request.diskGb, node.diskTotalGb),
    },
  };
}

/** The reasons a report failed on, for a message that says what to fix. */
export function blockers(report: CompatibilityReport): Reason[] {
  return report.reasons.filter((r) => r.ok === false);
}
