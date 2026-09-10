"use server";

import { revalidatePath } from "next/cache";
import type { CapabilityId } from "@/domain/games/types";
import { findGame } from "@/domain/games/registry";
import type { NodeProfile } from "@/domain/nodes/compatibility";
import { placeServer, type Placement } from "@/domain/nodes/placement";
import { requireUser } from "@/lib/auth";
import { capacityOf } from "@/lib/create-ops";
import { db } from "@/lib/db";
import {
  approveNodeOp,
  createRegistrationTokenOp,
  rejectNodeOp,
  revokeRegistrationTokenOp,
} from "@/lib/node-ops";
import { setNodeDrainOp, type OpResult } from "@/lib/server-ops";

/* Thin, like the other action files: resolve the user, call the
   operation, revalidate what changed. */

function refresh() {
  revalidatePath("/nodes");
  revalidatePath("/");
}

export async function createRegistrationToken(label: string, ttlHours: number) {
  const result = await createRegistrationTokenOp(await requireUser(), label, ttlHours);
  if (result.ok) refresh();
  return result;
}

export async function revokeRegistrationToken(tokenId: string): Promise<OpResult> {
  const result = await revokeRegistrationTokenOp(await requireUser(), tokenId);
  if (result.ok) refresh();
  return result;
}

export async function approveNode(name: string): Promise<OpResult> {
  const result = await approveNodeOp(await requireUser(), name);
  if (result.ok) {
    refresh();
    revalidatePath(`/nodes/${name}`);
  }
  return result;
}

export async function rejectNode(name: string): Promise<OpResult> {
  const result = await rejectNodeOp(await requireUser(), name);
  if (result.ok) refresh();
  return result;
}

export async function setNodeDrain(name: string, drain: boolean): Promise<OpResult> {
  const result = await setNodeDrainOp(await requireUser(), name, drain);
  if (result.ok) {
    refresh();
    revalidatePath(`/nodes/${name}`);
  }
  return result;
}

/* ── Placement ────────────────────────────────────────────────────
   What the wizard shows before anybody has chosen a node. A
   recommendation and its arithmetic, not a decision — the operator can
   always pick something else, and creation validates whatever they
   picked rather than trusting this. */

export interface PlacementPreview {
  recommended: string | null;
  reasons: string[];
  refusal: string[] | null;
  scores: Array<{ node: string; score: number; eligible: boolean; verdict: string }>;
}

export async function recommendNode(input: {
  gameId: string;
  memoryGb: number;
  cpuLimit: number;
  diskGb: number;
  region?: string;
}): Promise<PlacementPreview> {
  await requireUser();

  const game = findGame(input.gameId);
  if (!game) return { recommended: null, reasons: [], refusal: ["Unknown game."], scores: [] };

  const placement = placeServer(
    {
      game,
      resources: { memoryGb: input.memoryGb, cpuLimit: input.cpuLimit, diskGb: input.diskGb },
      region: input.region,
    },
    await nodeProfiles(),
  );

  return summarise(placement);
}

function summarise(placement: Placement): PlacementPreview {
  return {
    recommended: placement.recommended?.node ?? null,
    reasons: placement.recommended?.reasons ?? [],
    refusal: placement.refusal,
    scores: placement.candidates.map((c) => ({
      node: c.node,
      score: c.score,
      eligible: c.eligible,
      verdict: c.compatibility.verdict,
    })),
  };
}

/* Every node, in the shape the placement engine reads.

   Committed figures come from the servers actually placed, not from a
   counter somebody has to remember to update — a stored total drifts,
   and a drifted total is a placement that overcommits a machine. */
export async function nodeProfiles(): Promise<NodeProfile[]> {
  const nodes = await db.node.findMany({ orderBy: { pingMs: "asc" } });

  return Promise.all(
    nodes.map(async (node) => {
      const committed = await capacityOf(node.id);
      return {
        name: node.name,
        region: node.region,
        state: node.state,
        pingMs: node.pingMs,
        // A value the node has not reported stays null: unknown is not
        // the same as wrong, and the engine treats them differently.
        os: node.os === "linux" || node.os === "windows" ? node.os : null,
        arch: node.arch === "x64" || node.arch === "arm64" ? node.arch : null,
        capabilities: node.capabilities as CapabilityId[],
        cpuTotalPct: node.cpuCores * 100,
        ramTotalGb: node.ramTotal,
        diskTotalGb: node.diskTotal,
        cpuCommittedPct: committed.cpuCommitted,
        ramCommittedGb: committed.ramCommitted,
        diskCommittedGb: committed.diskCommitted,
        servers: committed.servers,
        hasAgent: Boolean(node.daemonUrl && node.daemonToken),
      };
    }),
  );
}
