"use server";

import { revalidatePath } from "next/cache";
import { findGame } from "@/domain/games/registry";
import { cannotRun } from "@/domain/nodes/compatibility";
import { placeServer, type Placement } from "@/domain/nodes/placement";
import { requireUser } from "@/lib/auth";
import { nodeProfiles } from "@/lib/create-ops";
import {
  approveNodeOp,
  rotateAgentTokenOp,
  createRegistrationTokenOp,
  registrationProgressOp,
  rejectNodeOp,
  removeNodeOp,
  revokeRegistrationTokenOp,
  updateNodeDetailsOp,
  type NodeDetailsInput,
  type RegistrationProgress,
} from "@/lib/node-ops";
import { setNodeDrainOp, type OpResult } from "@/lib/server-ops";

/* Thin, like the other action files: resolve the user, call the
   operation, revalidate what changed. */

function refresh() {
  revalidatePath("/nodes");
  revalidatePath("/");
}

export async function createRegistrationToken(nodeName: string) {
  const result = await createRegistrationTokenOp(await requireUser(), { nodeName });
  if (result.ok) refresh();
  return result;
}

/* Polled by the dialog. Dates cross the wire as strings, so they are
   made strings here rather than trusted to the serialiser. */
export async function registrationProgress(
  tokenId: string,
): Promise<Exclude<RegistrationProgress, { state: "waiting" }> | { state: "waiting"; expiresAt: string }> {
  const progress = await registrationProgressOp(await requireUser(), tokenId);
  return progress.state === "waiting"
    ? { state: "waiting", expiresAt: progress.expiresAt.toISOString() }
    : progress;
}

export async function revokeRegistrationToken(tokenId: string): Promise<OpResult> {
  const result = await revokeRegistrationTokenOp(await requireUser(), tokenId);
  if (result.ok) refresh();
  return result;
}

export async function rotateAgentToken(name: string): Promise<OpResult> {
  const result = await rotateAgentTokenOp(await requireUser(), name);
  if (result.ok) revalidatePath(`/nodes/${name}`);
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

export async function removeNode(name: string, confirmation: string): Promise<OpResult> {
  const result = await removeNodeOp(await requireUser(), name, confirmation);
  if (result.ok) {
    refresh();
    revalidatePath(`/nodes/${name}`);
    revalidatePath("/audit");
  }
  return result;
}

export async function rejectNode(name: string): Promise<OpResult> {
  const result = await rejectNodeOp(await requireUser(), name);
  if (result.ok) refresh();
  return result;
}

export async function updateNodeDetails(name: string, input: NodeDetailsInput) {
  const result = await updateNodeDetailsOp(await requireUser(), name, {
    city: String(input.city ?? ""),
    region: String(input.region ?? ""),
  });
  if (result.ok) {
    refresh();
    revalidatePath(`/nodes/${name}`);
    revalidatePath("/audit");
  }
  return result;
}

export async function setNodeDrain(name: string, drain: boolean): Promise<OpResult> {
  const result = await setNodeDrainOp(await requireUser(), name, drain);
  if (result.ok) {
    refresh();
    revalidatePath(`/nodes/${name}`);
    revalidatePath("/audit");
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
  scores: Array<{
    node: string;
    score: number;
    eligible: boolean;
    verdict: string;
    /** Why this game cannot run there at all — the same refusal creation makes. */
    cannotRun: string[];
  }>;
}

export async function recommendNode(input: {
  gameId: string;
  memoryGb: number;
  cpuLimit: number;
  diskGb: number;
  region?: string;
}): Promise<PlacementPreview> {
  const user = await requireUser();

  const game = findGame(input.gameId);
  if (!game) return { recommended: null, reasons: [], refusal: ["Unknown game."], scores: [] };

  const placement = placeServer(
    {
      game,
      resources: { memoryGb: input.memoryGb, cpuLimit: input.cpuLimit, diskGb: input.diskGb },
      region: input.region,
      // The wizard's server will be this person's.
      ownerId: user.id,
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
      cannotRun: cannotRun(c.compatibility),
    })),
  };
}
