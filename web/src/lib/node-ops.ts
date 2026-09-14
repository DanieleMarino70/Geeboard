import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { PlatformError } from "@/domain/errors";
import { CAPABILITIES, type CapabilityId } from "@/domain/games/types";
// Shared with the Add a node form, so both refuse exactly the same names.
import { NODE_NAME } from "./agent-command";
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./secrets";
import type { OpResult } from "./server-ops";

/* Registering a node.

   Attaching a machine used to mean encrypting a token by hand and
   writing it into the database with SQL. That is a credential — the one
   that grants control of every container on a machine — handled outside
   any flow that could audit it, expire it or take it back.

   This is the flow instead:

     panel mints a registration token   shown once, expiring, single-use
     node presents it, sends its own    name, address, agent token
     panel records it as PENDING        nothing is placed there yet
     an admin approves it               and only then is it in service

   The last step is the one that matters. A machine that registered with
   a leaked token must not become useful by simply waiting. */

const TOKEN_PREFIX = "gbn_";
const DEFAULT_TTL_HOURS = 24;

/** A token, its masked form for the UI, and its hash. Secret shown once. */
function mintToken() {
  const secret = `${TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
  const body = secret.slice(TOKEN_PREFIX.length);
  return { secret, prefix: `${TOKEN_PREFIX}${body.slice(0, 4)}…${body.slice(-4)}` };
}

export interface RegistrationTokenRequest {
  /** The one node this token may register. */
  nodeName: string;
  /** Defaults to the node name, which is what somebody will recognise. */
  label?: string;
  ttlHours?: number;
}

export async function createRegistrationTokenOp(
  actor: User,
  request: RegistrationTokenRequest,
): Promise<OpResult & { secret?: string; tokenId?: string; expiresAt?: Date; replaces?: boolean }> {
  if (!can(actor, "node.manage")) {
    return { ok: false, title: "Not permitted", body: "Only owners and admins can register nodes." };
  }

  const nodeName = request.nodeName.trim().toLowerCase();
  if (!NODE_NAME.test(nodeName)) {
    return {
      ok: false,
      title: "Check the node name",
      body: "2 to 39 lowercase letters, digits and dashes, starting with a letter or digit.",
    };
  }

  const label = (request.label ?? nodeName).trim();
  if (label.length > 60) {
    return { ok: false, title: "Label too long", body: "Keep it under 60 characters." };
  }

  const ttlHours = request.ttlHours ?? DEFAULT_TTL_HOURS;
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 168) {
    return { ok: false, title: "Check the expiry", body: "Between 1 hour and 7 days." };
  }

  /* A token for a name that already exists is how a node is rebuilt or
     its agent token rotated. Allowed, because that is a real job — but
     said out loud, because it re-points a node that may be in service. */
  const existing = await db.node.findUnique({ where: { name: nodeName }, select: { id: true } });

  const { secret, prefix } = mintToken();
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);

  const token = await db.nodeRegistrationToken.create({
    data: {
      prefix,
      hash: await bcrypt.hash(secret, 10),
      label,
      nodeName,
      expiresAt,
      createdById: actor.id,
    },
  });

  await db.activityEvent.create({
    data: {
      actor: actor.name,
      action: "node.token.created",
      target: nodeName,
      tone: existing ? "WARNING" : "INFO",
      userId: actor.id,
      changes: {
        Expires: { from: "—", to: expiresAt.toISOString() },
        ...(existing ? { Replaces: { from: "—", to: `the agent registered as ${nodeName}` } } : {}),
      },
    },
  });

  return {
    ok: true,
    tone: "success",
    title: "Registration token created",
    body: "Copy the command now — the token is not shown again, and it works once.",
    secret,
    tokenId: token.id,
    expiresAt,
    replaces: Boolean(existing),
  };
}

/* ── Waiting for it ───────────────────────────────────────────────
   What the Add a node dialog polls while somebody is running the
   command on the machine, so the flow ends in the place it started
   rather than on a page they have to know to refresh. */

export type RegistrationProgress =
  | { state: "waiting"; expiresAt: Date }
  | { state: "expired" | "revoked" | "gone" }
  | {
      state: "registered";
      node: {
        name: string;
        os: string | null;
        arch: string | null;
        cpuCores: number;
        ramTotal: number;
        diskTotal: number;
        capabilities: string[];
        approved: boolean;
      };
    };

export async function registrationProgressOp(
  actor: User,
  tokenId: string,
): Promise<RegistrationProgress> {
  if (!can(actor, "node.manage")) return { state: "gone" };

  const token = await db.nodeRegistrationToken.findUnique({ where: { id: tokenId } });
  if (!token) return { state: "gone" };
  if (token.revokedAt) return { state: "revoked" };

  if (token.usedAt && token.usedByNode) {
    const node = await db.node.findUnique({ where: { name: token.usedByNode } });
    if (!node) return { state: "gone" };
    return {
      state: "registered",
      node: {
        name: node.name,
        os: node.os,
        arch: node.arch,
        cpuCores: node.cpuCores,
        ramTotal: node.ramTotal,
        diskTotal: node.diskTotal,
        capabilities: node.capabilities,
        approved: node.approvedAt !== null,
      },
    };
  }

  if (token.expiresAt < new Date()) return { state: "expired" };
  return { state: "waiting", expiresAt: token.expiresAt };
}

export async function revokeRegistrationTokenOp(actor: User, tokenId: string): Promise<OpResult> {
  if (!can(actor, "node.manage")) {
    return { ok: false, title: "Not permitted", body: "Only owners and admins can do that." };
  }

  const token = await db.nodeRegistrationToken.findUnique({ where: { id: tokenId } });
  if (!token) return { ok: false, title: "Cannot revoke", body: "That token no longer exists." };
  if (token.revokedAt) {
    return { ok: false, title: "Already revoked", body: `${token.label} was revoked already.` };
  }

  await db.nodeRegistrationToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  await db.activityEvent.create({
    data: {
      actor: actor.name,
      action: "node.token.revoked",
      target: token.label,
      tone: "WARNING",
      userId: actor.id,
    },
  });

  return {
    ok: true,
    tone: "warning",
    title: "Token revoked",
    body: `${token.label} can no longer register a node.`,
  };
}

/* ── Registration ─────────────────────────────────────────────────
   Called by a node, not by a person. Everything here is untrusted
   input from a machine holding a token, which is exactly as much trust
   as the token is worth. */

export interface RegistrationRequest {
  token: string;
  name: string;
  /** Where the panel can reach this node. The node knows; we do not. */
  advertiseUrl: string;
  /** The secret the panel will present back to the node from now on. */
  agentToken: string;
  agentVersion: string;
  /** The platform game servers on it run on — the container engine's, not the host's. */
  os?: string;
  arch?: string;
  capabilities: string[];
  resources: { cpuCores: number; ramTotalGb: number; diskTotalGb: number };
}

/* The token the node presented, or a refusal.

   Deliberately vague about which check failed. "Expired" and "revoked"
   and "never existed" are all the same answer to whoever is holding a
   token they should not have. */
async function consumeToken(presented: string) {
  const body = presented.startsWith(TOKEN_PREFIX) ? presented.slice(TOKEN_PREFIX.length) : "";
  if (body.length < 8) throw refuseRegistration();

  const mask = `${TOKEN_PREFIX}${body.slice(0, 4)}…${body.slice(-4)}`;
  const candidates = await db.nodeRegistrationToken.findMany({
    where: { prefix: mask, revokedAt: null, usedAt: null },
  });

  for (const token of candidates) {
    if (!(await bcrypt.compare(presented, token.hash))) continue;
    if (token.expiresAt < new Date()) throw refuseRegistration();
    return token;
  }
  throw refuseRegistration();
}

function refuseRegistration() {
  return new PlatformError("UNAUTHENTICATED", "That registration token is not valid.");
}

/* An OS or architecture as a node reported it, or null.

   Stored as reported rather than narrowed to the two values games use
   today, because "freebsd" is a true answer and the compatibility engine
   already refuses it by name. What is not stored is anything that could
   not be a platform name at all — this is text a machine sent us. */
const PLATFORM_VALUE = /^[a-z0-9_-]{1,32}$/;

function cleanPlatform(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return PLATFORM_VALUE.test(value) && value !== "unknown" ? value : null;
}

function cleanCapabilities(raw: string[]): CapabilityId[] {
  const known = new Set<string>(CAPABILITIES);
  // A capability we do not recognise is dropped, not stored. The set is
  // closed so a typo on a node cannot invent one the games never match.
  return raw.filter((c): c is CapabilityId => known.has(c));
}

export interface RegistrationResult {
  node: string;
  state: string;
  /** False while an admin has not approved it yet. */
  approved: boolean;
}

export async function registerNode(request: RegistrationRequest): Promise<RegistrationResult> {
  const token = await consumeToken(request.token);

  const name = request.name.trim().toLowerCase();
  if (!NODE_NAME.test(name)) {
    throw new PlatformError("VALIDATION_FAILED", "A node name is lowercase letters, digits and dashes.");
  }
  /* Refused before anything is written, and without spending the token,
     so somebody who edited the name in the command can put it back and
     run it again. The name it was issued for is not repeated here: this
     answer goes to whoever holds the token. 401 rather than 403 because
     the agent stops retrying on a 401, and this will not change. */
  if (token.nodeName && token.nodeName !== name) {
    throw new PlatformError(
      "UNAUTHENTICATED",
      "That registration token was issued for a different node name.",
    );
  }
  if (request.agentToken.length < 32) {
    throw new PlatformError("VALIDATION_FAILED", "The agent token must be at least 32 characters.");
  }

  let url: URL;
  try {
    url = new URL(request.advertiseUrl);
  } catch {
    throw new PlatformError("VALIDATION_FAILED", "That is not a valid address for the panel to reach.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PlatformError("VALIDATION_FAILED", "A node address must be http or https.");
  }

  const capabilities = cleanCapabilities(request.capabilities);
  const os = cleanPlatform(request.os);
  const arch = cleanPlatform(request.arch);
  const now = new Date();

  const existing = await db.node.findUnique({ where: { name } });

  /* Re-registering an approved node is how a machine is rebuilt or its
     token rotated, and it must not silently take it out of service. What
     it must not do either is let a fresh token quietly re-point an
     existing node's name somewhere else — so approval is preserved, and
     the change is recorded. */
  const reported = {
    daemonUrl: url.toString().replace(/\/$/, ""),
    daemonToken: encryptSecret(request.agentToken),
    daemon: request.agentVersion,
    os,
    arch,
    capabilities,
    cpuCores: Math.max(1, Math.round(request.resources.cpuCores)),
    ramTotal: Math.max(1, Math.round(request.resources.ramTotalGb)),
    diskTotal: Math.max(1, Math.round(request.resources.diskTotalGb)),
    registeredAt: now,
    lastSeenAt: now,
  };

  const node = existing
    ? await db.node.update({ where: { name }, data: reported })
    : await db.node.create({
        data: {
          ...reported,
          name,
          city: url.hostname,
          region: "unknown",
          state: "PENDING",
          pingMs: 0,
          cpuPct: 0,
          ramPct: 0,
          diskPct: 0,
        },
      });

  await db.nodeRegistrationToken.update({
    where: { id: token.id },
    data: { usedAt: now, usedByNode: name },
  });

  await db.activityEvent.create({
    data: {
      actor: "Node agent",
      action: existing ? "node.reregistered" : "node.registered",
      target: name,
      tone: existing ? "INFO" : "ACCENT",
      changes: {
        Platform: { from: "—", to: `${os ?? "unknown"} · ${arch ?? "unknown"}` },
        Capabilities: { from: "—", to: capabilities.join(", ") || "none reported" },
        Token: { from: "—", to: token.label },
      },
    },
  });

  return {
    node: node.name,
    state: node.state,
    approved: node.approvedAt !== null,
  };
}

/* ── Approval ─────────────────────────────────────────────────────── */

export async function approveNodeOp(actor: User, name: string): Promise<OpResult> {
  if (!can(actor, "node.manage")) {
    return { ok: false, title: "Not permitted", body: "Only owners and admins can approve nodes." };
  }

  const node = await db.node.findUnique({ where: { name } });
  if (!node) return { ok: false, title: "Cannot approve", body: "That node no longer exists." };
  if (node.approvedAt) {
    return { ok: false, title: "Already approved", body: `${node.name} is already in service.` };
  }

  await db.node.update({
    where: { id: node.id },
    data: { approvedAt: new Date(), approvedById: actor.id, state: "HEALTHY" },
  });

  await db.activityEvent.create({
    data: {
      actor: actor.name,
      action: "node.approved",
      target: node.name,
      tone: "SUCCESS",
      userId: actor.id,
      changes: { State: { from: "PENDING", to: "HEALTHY" } },
    },
  });

  return {
    ok: true,
    tone: "success",
    title: `${node.name} approved`,
    body: `${node.cpuCores} cores and ${node.ramTotal} GB are now available for placement.`,
  };
}

export async function rejectNodeOp(actor: User, name: string): Promise<OpResult> {
  if (!can(actor, "node.manage")) {
    return { ok: false, title: "Not permitted", body: "Only owners and admins can do that." };
  }

  const node = await db.node.findUnique({
    where: { name },
    include: { _count: { select: { servers: true } } },
  });
  if (!node) return { ok: false, title: "Cannot reject", body: "That node no longer exists." };

  /* Refusing to remove a node with servers on it is the same rule as
     refusing to delete a server whose node is unreachable: the panel
     must not lose track of something that is still running. */
  if (node._count.servers > 0) {
    return {
      ok: false,
      title: "It has servers on it",
      body: `${node.name} hosts ${node._count.servers}. Move or delete them first.`,
    };
  }
  if (node.approvedAt) {
    return {
      ok: false,
      title: "Already approved",
      body: `${node.name} is in service. Drain it before removing it.`,
    };
  }

  await db.node.delete({ where: { id: node.id } });
  await db.activityEvent.create({
    data: {
      actor: actor.name,
      action: "node.rejected",
      target: node.name,
      tone: "DANGER",
      userId: actor.id,
    },
  });

  return {
    ok: true,
    tone: "warning",
    title: `${node.name} rejected`,
    body: "Its registration is gone. The agent will keep trying until it is stopped.",
  };
}

/* ── Heartbeat ────────────────────────────────────────────────────
   A node saying it is alive, and what it currently looks like.

   Authenticated with the same shared secret the panel presents back to
   it: there are exactly two parties who know it, so either direction is
   the same proof. Compared in constant time, like every other token
   check in this codebase. */

export interface HeartbeatRequest {
  name: string;
  token: string;
  agentVersion?: string;
  os?: string;
  arch?: string;
  capabilities?: string[];
  resources?: { cpuCores: number; ramTotalGb: number; diskTotalGb: number };
  load?: { cpuPct: number; ramPct: number; diskPct: number };
  servers?: number;
}

/** A measured size, or undefined for one that could not be a measurement. */
function cleanSize(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.round(value) : undefined;
}

export async function recordHeartbeat(request: HeartbeatRequest): Promise<{ state: string }> {
  const node = await db.node.findUnique({ where: { name: request.name.trim().toLowerCase() } });
  if (!node?.daemonToken) throw new PlatformError("UNAUTHENTICATED", "Unknown node.");

  let expected: string;
  try {
    expected = decryptSecret(node.daemonToken);
  } catch {
    throw new PlatformError("UNAUTHENTICATED", "Unknown node.");
  }
  if (!constantTimeEquals(request.token, expected)) {
    throw new PlatformError("UNAUTHENTICATED", "Unknown node.");
  }

  const load = request.load;
  /* A platform the node stops reporting is left as it was: an older
     agent that never sent one has not changed what it runs on. */
  const os = cleanPlatform(request.os) ?? node.os;
  const arch = cleanPlatform(request.arch) ?? node.arch;
  const platformChanged = os !== node.os || arch !== node.arch;

  await db.node.update({
    where: { id: node.id },
    data: {
      lastSeenAt: new Date(),
      ...(request.agentVersion ? { daemon: request.agentVersion } : {}),
      ...(platformChanged ? { os, arch } : {}),
      /* Size, as measured now. Registration's reading was the only one
         there ever was, so a node whose first measurement was wrong — a
         data root not yet created, reported as 1 GB of disk — stayed
         wrong, and refused every server for storage it had. */
      ...(cleanSize(request.resources?.cpuCores) ? { cpuCores: cleanSize(request.resources?.cpuCores) } : {}),
      ...(cleanSize(request.resources?.ramTotalGb) ? { ramTotal: cleanSize(request.resources?.ramTotalGb) } : {}),
      ...(cleanSize(request.resources?.diskTotalGb) ? { diskTotal: cleanSize(request.resources?.diskTotalGb) } : {}),
      ...(request.capabilities ? { capabilities: cleanCapabilities(request.capabilities) } : {}),
      ...(load
        ? {
            cpuPct: clampPct(load.cpuPct),
            ramPct: clampPct(load.ramPct),
            diskPct: clampPct(load.diskPct),
          }
        : {}),
      /* A heartbeat clears a fault and never clears an operator's
         decision. A draining node that is perfectly healthy is still
         draining. */
      ...(node.state === "UNREACHABLE" || node.state === "DEGRADED"
        ? { state: "HEALTHY" as const }
        : {}),
    },
  });

  if (node.state === "UNREACHABLE" || node.state === "DEGRADED") {
    await db.activityEvent.create({
      data: { actor: "Watchdog", action: "node.recovered", target: node.name, tone: "SUCCESS" },
    });
  }

  /* Filling in a platform nobody had reported is not news. Changing one
     is — Docker Desktop switched to Windows containers changes which
     games this node can host, and somebody should be able to find out
     when that happened. */
  if (platformChanged && node.os !== null && node.arch !== null) {
    await db.activityEvent.create({
      data: {
        actor: "Node agent",
        action: "node.platform.changed",
        target: node.name,
        tone: "WARNING",
        changes: { Platform: { from: `${node.os} · ${node.arch}`, to: `${os} · ${arch}` } },
      },
    });
  }

  return { state: node.approvedAt ? "active" : "pending" };
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function constantTimeEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself leak
  // the length — so pad both and still fail, keeping the timing flat.
  if (a.length !== b.length) {
    const pad = Buffer.alloc(Math.max(a.length, b.length));
    const other = Buffer.alloc(pad.length);
    a.copy(pad);
    b.copy(other);
    timingSafeEqual(pad, other);
    return false;
  }
  return timingSafeEqual(a, b);
}
