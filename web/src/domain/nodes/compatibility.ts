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

export type NodeHealth =
  | "PENDING"
  | "HEALTHY"
  | "DEGRADED"
  | "UNREACHABLE"
  | "DRAINING"
  | "MAINTENANCE";

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
  /* What those servers are, for placement's anti-affinity: which game
     each runs and whose it is. Absent means not told, and placement then
     has nothing to say about it rather than assuming there are none. */
  hosted?: Array<{ gameId: string | null; ownerId: string }>;
  hasAgent: boolean;
  /* Why this node's agent and this panel cannot work together, when they
     cannot: one sentence, or null. Computed by the caller, which is the
     only layer that knows what version the panel is — see
     agent-version.ts and lib/create-ops.ts. Absent means not checked,
     which is treated as not told rather than as fine. */
  agentVersionMismatch?: string | null;
}

export interface ResourceRequest {
  memoryGb: number;
  /** Percent of one core. */
  cpuLimit: number;
  diskGb: number;
}

export type Verdict = "compatible" | "partial" | "incompatible";

/* What a check was about. Creation refuses on `platform`, `capability`
   and `agent` failures itself; availability and resources it has already
   refused on, with messages of its own that name the numbers. */
export type ReasonKind = "availability" | "agent" | "platform" | "capability" | "resources" | "advice";

export interface Reason {
  /** Whether this check passed. `null` means it could not be checked. */
  ok: boolean | null;
  kind: ReasonKind;
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

  const fail = (kind: ReasonKind, label: string, detail?: string) => {
    reasons.push({ ok: false, kind, label, detail });
    incompatible = true;
  };
  const unsure = (kind: ReasonKind, label: string, detail?: string) => {
    reasons.push({ ok: null, kind, label, detail });
    unknown = true;
  };
  const pass = (kind: ReasonKind, label: string, detail?: string) =>
    reasons.push({ ok: true, kind, label, detail });
  /* Something the operator should know and is allowed to do anyway. It
     reads as a failed check because it is one — the game asked and did
     not get it — but it does not make the placement incompatible, and
     nothing refuses on it. */
  const caution = (label: string, detail?: string) =>
    reasons.push({ ok: false, kind: "advice", label, detail });

  /* ── Availability ─────────────────────────────────────────────── */
  if (node.state === "PENDING") {
    /* Not a health problem and still a refusal. Approval is a person's
       decision, and placement does not get to route around it. */
    fail("availability", "Approved", "This node is registered but nobody has approved it yet.");
  } else if (node.state === "UNREACHABLE") {
    fail("availability", "Node reachable", "The panel cannot see this node.");
  } else if (node.state === "DRAINING") {
    fail("availability", "Accepting servers", "It is being emptied, so it will not take new ones.");
  } else if (node.state === "MAINTENANCE") {
    fail("availability", "Accepting servers", "It is out of rotation for maintenance.");
  } else if (node.state === "DEGRADED") {
    unsure("availability", "Node healthy", "It is degraded — a placement here may not settle.");
  } else {
    pass("availability", "Node healthy");
  }

  if (!node.hasAgent) {
    /* Without an agent the panel can write a row and nothing else. Not
       a refusal — the seeded workspace runs this way on purpose — but
       never something to recommend. */
    unsure("agent", "Agent attached", "No agent on this node, so the server would be simulated.");
  } else {
    pass("agent", "Agent attached");

    /* A refusal, unlike the one above: an agent from another release
       line answers a request this panel did not mean, and the failure
       shows up as a missing field on a world rather than as an error
       here. The node keeps what it already runs; it takes nothing new
       until it is upgraded. */
    if (node.agentVersionMismatch) {
      fail("agent", "Agent version", node.agentVersionMismatch);
    } else {
      pass("agent", "Agent version");
    }
  }

  /* ── Platform ─────────────────────────────────────────────────── */
  if (node.os === null) {
    unsure("platform", "Operating system", "The node has not reported one yet.");
  } else if (!game.requirements.os.includes(node.os)) {
    fail(
      "platform",
      "Operating system",
      `${game.name} needs ${game.requirements.os.join(" or ")}, not ${node.os}.`,
    );
  } else {
    pass("platform", "Operating system", node.os);
  }

  if (node.arch === null) {
    unsure("platform", "Architecture", "The node has not reported one yet.");
  } else if (!game.requirements.arch.includes(node.arch)) {
    fail(
      "platform",
      "Architecture",
      `${game.name} needs ${game.requirements.arch.join(" or ")}, not ${node.arch}.`,
    );
  } else {
    pass("platform", "Architecture", node.arch);
  }

  /* ── Capabilities ─────────────────────────────────────────────── */
  const missing: CapabilityId[] = game.requirements.capabilities.filter(
    (c) => !node.capabilities.includes(c),
  );
  if (game.requirements.capabilities.length === 0) {
    pass("capability", "Capabilities", "none required");
  } else if (node.capabilities.length === 0) {
    unsure("capability", "Capabilities", "The node has not reported what it can do.");
  } else if (missing.length > 0) {
    fail("capability", "Capabilities", `missing ${missing.map((c) => CAPABILITY_LABELS[c]).join(", ")}`);
  } else {
    pass(
      "capability",
      "Capabilities",
      game.requirements.capabilities.map((c) => CAPABILITY_LABELS[c]).join(", "),
    );
  }

  /* ── Resources ────────────────────────────────────────────────── */
  const ramFree = node.ramTotalGb - node.ramCommittedGb;
  const cpuFree = node.cpuTotalPct - node.cpuCommittedPct;
  const diskFree = node.diskTotalGb - node.diskCommittedGb;

  if (request.memoryGb > ramFree) {
    fail("resources", "Memory", `${request.memoryGb} GB requested, ${ramFree} GB uncommitted.`);
  } else {
    pass("resources", "Memory", `${request.memoryGb} of ${ramFree} GB free`);
  }

  if (request.cpuLimit > cpuFree) {
    fail("resources", "CPU", `${request.cpuLimit / 100} cores requested, ${cpuFree / 100} uncommitted.`);
  } else {
    pass("resources", "CPU", `${request.cpuLimit / 100} of ${cpuFree / 100} cores free`);
  }

  if (request.diskGb > diskFree) {
    fail("resources", "Storage", `${request.diskGb} GB requested, ${diskFree} GB uncommitted.`);
  } else {
    pass("resources", "Storage", `${request.diskGb} of ${diskFree} GB free`);
  }

  /* The game's own floor, which is not the same as what the operator
     asked for — a request below it is a server that may start and then
     fall over under load.

     It used to refuse the placement outright, and the slider would not go
     below it either, so the decision could not be made at all. Whose
     decision it is was the question: `memoryGbMin` is what this catalogue
     believes about somebody else's hardware and somebody else's player
     count, and an operator running four friends on a small box knows
     something it does not. So it says so, loudly, and gets out of the
     way. `cpuPctMin` was declared by every game in the catalogue and
     checked by nothing at all; it is checked here now. */
  if (request.memoryGb < game.requirements.memoryGbMin) {
    caution(
      "Under the game's suggested memory",
      `${game.name} asks for ${game.requirements.memoryGbMin} GB and this gives it ${request.memoryGb}.`,
    );
  }
  if (request.cpuLimit < game.requirements.cpuPctMin) {
    caution(
      "Under the game's suggested CPU",
      `${game.name} asks for ${game.requirements.cpuPctMin}% of a core and this gives it ${request.cpuLimit}%.`,
    );
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
  return report.reasons.filter((r) => r.ok === false && r.kind !== "advice");
}

/** What is allowed and worth saying: under a game's own suggested size. */
export function cautions(report: CompatibilityReport): Reason[] {
  return report.reasons.filter((r) => r.kind === "advice");
}

/* Why this game cannot run on this node at all, whatever resources are
   asked for: its operating system, architecture, capabilities, or an
   agent from a release line this panel does not speak to. Empty
   when it can, and when the node has not said — unknown stays partial,
   and a node that has not reported is not refused on a guess. */
export function cannotRun(report: CompatibilityReport): string[] {
  return report.reasons
    .filter(
      (r) =>
        r.ok === false && (r.kind === "platform" || r.kind === "capability" || r.kind === "agent"),
    )
    .map((r) => {
      const text = r.detail ?? r.label;
      return text.charAt(0).toUpperCase() + text.slice(1);
    });
}
