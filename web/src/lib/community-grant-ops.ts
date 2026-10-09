import "server-only";
import type { User } from "@prisma/client";
import type { CapabilityId } from "@/domain/games/types";
import { verifyFreshCodeOp } from "./account-ops";
import { db } from "./db";
import type { OpResult } from "./server-ops";

/* Letting community games run on a node, from the panel.

   Until 0.9.6 only the machine could say so (the installer's --community-games), on the reasoning that whoever can
   click in the panel is not thereby whoever owns the machine. The owner of this panel asked for it in the panel. So it
   is here, held to what a grant like that should cost: an owner (not an admin), a fresh code from the authenticator for
   each change (a stolen session is not enough), a line in the audit log saying who, and a page that says what it lets
   in. What the machine declares itself it keeps: the panel can grant, and take back what it granted, and never take
   away the machine's own word.

   What it grants: the images of community games an owner approved may be placed here, and run as root in their
   containers, reaching what this machine's network reaches (docs/community-games.md). Servers already placed keep
   running when it is taken back; no new one is placed. */

export async function setCommunityGamesOp(user: User, nodeName: string, allow: boolean, code: string): Promise<OpResult> {
  if (user.role !== "OWNER") {
    return { ok: false, title: "Owners only", body: "Letting community games run on a node is an owner's decision." };
  }
  const node = await db.node.findUnique({ where: { name: nodeName } });
  if (!node || !node.approvedAt) return { ok: false, title: "No such node", body: "That node is not one this panel runs servers on." };

  if (!allow && !node.communityGrantedAt) {
    return node.communityDeclared
      ? { ok: false, title: "The machine declares it", body: `${node.name} declares community games itself. Only the machine can take that away: remove community-games from GEEBOARD_CAPABILITIES in /etc/geeboard/agent.env and run its installer again.` }
      : { ok: false, title: "Already off", body: `Community games do not run on ${node.name}.` };
  }
  if (allow && (node.communityGrantedAt || node.communityDeclared)) {
    return { ok: false, title: "Already on", body: `Community games may already run on ${node.name}.` };
  }

  const fresh = await verifyFreshCodeOp(user, String(code ?? "").trim(), "letting community games run on a node");
  if (!fresh.ok) return fresh;

  const capabilities = node.capabilities.filter((c) => c !== "community-games") as CapabilityId[];
  const next = allow || node.communityDeclared ? [...capabilities, "community-games"] : capabilities;
  await db.node.update({
    where: { id: node.id },
    data: allow
      ? { communityGrantedAt: new Date(), communityGrantedById: user.id, capabilities: next }
      : { communityGrantedAt: null, communityGrantedById: null, capabilities: next },
  });
  await db.activityEvent.create({
    data: {
      actor: user.name,
      userId: user.id,
      action: allow ? "node.community.granted" : "node.community.revoked",
      target: node.name,
      tone: "WARNING",
      changes: { "Community games": { from: allow ? "not allowed" : "allowed from the panel", to: allow ? "allowed from the panel" : "not allowed" } },
    },
  });

  return allow
    ? {
        ok: true,
        tone: "warning",
        title: "Community games may run here",
        body: `Approved community games can now be placed on ${node.name}. Their images run as root in their containers.`,
      }
    : {
        ok: true,
        tone: "success",
        title: "Taken back",
        body: `No new community game server is placed on ${node.name}. The ones already there keep running.`,
      };
}
