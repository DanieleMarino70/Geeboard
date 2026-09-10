import type { GameDefinition } from "../games/types";
import {
  blockers,
  checkCompatibility,
  type CompatibilityReport,
  type NodeProfile,
  type ResourceRequest,
} from "./compatibility";

/* Choosing which node hosts a new server.

   Placement picks between machines that already exist. It does not buy,
   create, provision or resize anything — there is no cloud integration
   and there is not meant to be one. The question is only ever "which of
   these should it go on?".

   Deterministic and explainable, on purpose. An operator who is told a
   server went to Milan should be able to see the arithmetic; a score
   nobody can reproduce is a score nobody trusts, and the moment it puts
   a server somewhere surprising it becomes something to work around
   rather than something to use. */

export interface PlacementRequest {
  game: GameDefinition;
  resources: ResourceRequest;
  /** Prefer a node in this region. A preference, never a requirement. */
  region?: string;
}

export interface PlacementCandidate {
  node: string;
  compatibility: CompatibilityReport;
  /** 0–1. Higher is a better place for this server. */
  score: number;
  /** Why it scored what it did, in the order it was worked out. */
  reasons: string[];
  /** False when the node cannot take this server at all. */
  eligible: boolean;
}

export interface Placement {
  /** The node to use, or null when nothing can take it. */
  recommended: PlacementCandidate | null;
  /** Every node considered, best first. Ineligible ones last. */
  candidates: PlacementCandidate[];
  /** Set when nothing was eligible: the reasons, deduplicated. */
  refusal: string[] | null;
}

/* The weights.

   Memory dominates because it is what actually runs out — a game server
   is a memory-shaped workload, and a node with spare cores and no spare
   memory can host nothing. CPU matters next. Disk rarely decides
   anything but breaks ties in the right direction.

   Spreading is worth a little on its own: two servers on one node share
   a failure. It is deliberately small, because packing servers where
   there is room beats spreading them where there is not. */
const WEIGHTS = {
  memory: 0.45,
  cpu: 0.25,
  disk: 0.1,
  spread: 0.1,
  region: 0.1,
} as const;

/* A node with no servers on it should not be infinitely attractive, and
   one with a dozen should not be excluded. Diminishing returns past this
   many is about right for a machine sized for game servers. */
const CROWDED = 12;

export function placeServer(
  request: PlacementRequest,
  nodes: NodeProfile[],
): Placement {
  const candidates = nodes.map((node) => evaluate(request, node));

  candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    /* A stable tiebreak, so two identical nodes do not swap places
       between one render and the next. Latency first because it is the
       one difference a player would notice. */
    if (a.compatibility.node !== b.compatibility.node) {
      const byPing = pingOf(nodes, a.compatibility.node) - pingOf(nodes, b.compatibility.node);
      if (byPing !== 0) return byPing;
    }
    return a.compatibility.node.localeCompare(b.compatibility.node);
  });

  const eligible = candidates.filter((c) => c.eligible);
  const recommended = eligible[0] ?? null;

  return {
    recommended,
    candidates,
    refusal: recommended ? null : summariseRefusals(candidates),
  };
}

function pingOf(nodes: NodeProfile[], name: string): number {
  return nodes.find((n) => n.name === name)?.pingMs ?? Number.MAX_SAFE_INTEGER;
}

function evaluate(request: PlacementRequest, node: NodeProfile): PlacementCandidate {
  const compatibility = checkCompatibility(request.game, node, request.resources);
  const reasons: string[] = [];

  if (compatibility.verdict === "incompatible") {
    return {
      node: node.name,
      compatibility,
      score: 0,
      reasons: blockers(compatibility).map((b) => `${b.label}: ${b.detail ?? "not met"}`),
      eligible: false,
    };
  }

  const { ram, cpu, disk } = compatibility.headroom;
  reasons.push(`${pct(ram)} memory free after this server`);
  reasons.push(`${pct(cpu)} CPU free after this server`);

  /* Fewer neighbours is better, with diminishing returns. Two servers on
     one node share a failure; the twelfth and thirteenth barely differ. */
  const spread = 1 - Math.min(node.servers, CROWDED) / CROWDED;
  if (node.servers === 0) reasons.push("No other servers on this node");
  else reasons.push(`${node.servers} server${node.servers === 1 ? "" : "s"} already here`);

  const regionMatch = request.region ? (node.region === request.region ? 1 : 0) : 0;
  if (request.region) {
    reasons.push(node.region === request.region ? `In ${request.region}` : `Not in ${request.region}`);
  }

  let score =
    ram * WEIGHTS.memory +
    cpu * WEIGHTS.cpu +
    disk * WEIGHTS.disk +
    spread * WEIGHTS.spread +
    regionMatch * WEIGHTS.region;

  /* A partial verdict means something could not be checked — the node
     has not reported its architecture, or it is degraded, or it has no
     agent. It stays eligible, because refusing on an unknown would block
     a placement that would probably have worked, but it should lose to
     any node we are sure about. */
  if (compatibility.verdict === "partial") {
    score *= 0.6;
    const unknown = compatibility.reasons.filter((r) => r.ok === null);
    for (const reason of unknown) reasons.push(`${reason.label}: ${reason.detail ?? "unknown"}`);
  }

  return {
    node: node.name,
    compatibility,
    score: Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000,
    reasons,
    eligible: true,
  };
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/* Why nothing could take it, said once each.

   A list of five nodes all saying "out of memory" is one fact, not five,
   and the operator needs the fact — that the fleet is full — rather than
   a wall of rows. */
function summariseRefusals(candidates: PlacementCandidate[]): string[] {
  if (candidates.length === 0) return ["There are no nodes registered."];

  const seen = new Map<string, number>();
  for (const candidate of candidates) {
    for (const reason of candidate.reasons) {
      const label = reason.split(":")[0]!.trim();
      seen.set(label, (seen.get(label) ?? 0) + 1);
    }
  }

  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) =>
      count === candidates.length
        ? `Every node: ${label.toLowerCase()}`
        : `${count} of ${candidates.length} nodes: ${label.toLowerCase()}`,
    );
}
