import type { Role } from "@prisma/client";

/* Permissions.

   The panel already had rules; they were just written out longhand at
   every call site, as `user.role === "OWNER" || user.role === "ADMIN" ||
   server.ownerId === user.id`. Four roles and a dozen operations is
   about where that stops being readable and starts being a place for a
   mistake to hide.

   This is the same policy in one table. It is deliberately not a
   generous reading of the old rules — every entry below reproduces what
   the code did before, including the asymmetries. A moderator can watch
   any console but only type into a server they own, and that is on
   purpose: watching is oversight, typing is control.

   Scope is the second half of a permission. "own" is not a weaker
   version of "all"; it is the answer to a different question, and the
   only reason a member can do anything at all. */

export const PERMISSIONS = [
  "server.read",
  "server.create",
  "server.delete",
  "server.start",
  "server.stop",
  "server.restart",
  "server.settings.write",
  "server.update",
  "server.console.read",
  "server.console.write",
  "server.files.read",
  "server.files.write",
  "server.backup.read",
  "server.backup.write",
  "server.schedule.write",
  "node.read",
  "node.manage",
  "member.read",
  "member.manage",
  "apikey.manage",
  "audit.read",
  "game.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** "all" is every server; "own" is only the ones this user owns. */
export type Scope = "none" | "own" | "all";

function everything(): Record<Permission, Scope> {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, "all"])) as Record<Permission, Scope>;
}

function build(overrides: Partial<Record<Permission, Scope>>): Record<Permission, Scope> {
  const base = Object.fromEntries(PERMISSIONS.map((p) => [p, "none"])) as Record<Permission, Scope>;
  return { ...base, ...overrides };
}

/* Owners and admins share a matrix. They differ in what they may do to
   each other, which is a rank comparison rather than a permission — see
   changeMemberRoleOp, where it belongs. */
const PRIVILEGED = everything();

const MATRIX: Record<Role, Record<Permission, Scope>> = {
  OWNER: PRIVILEGED,
  ADMIN: PRIVILEGED,

  MODERATOR: build({
    "server.read": "all",
    "server.console.read": "all",
    "server.console.write": "own",
    "server.start": "own",
    "server.stop": "own",
    "server.restart": "own",
    "server.settings.write": "own",
    "server.files.read": "own",
    "server.files.write": "own",
    "server.backup.read": "own",
    "server.backup.write": "own",
    "server.schedule.write": "own",
    "node.read": "all",
    "member.read": "all",
    "apikey.manage": "own",
    "audit.read": "all",
    "game.read": "all",
  }),

  MEMBER: build({
    "server.read": "all",
    "server.start": "own",
    "server.stop": "own",
    "server.restart": "own",
    "server.settings.write": "own",
    "server.console.read": "own",
    "server.console.write": "own",
    "server.files.read": "own",
    "server.files.write": "own",
    "server.backup.read": "own",
    "server.backup.write": "own",
    "server.schedule.write": "own",
    "node.read": "all",
    "member.read": "all",
    "apikey.manage": "own",
    "audit.read": "all",
    "game.read": "all",
  }),
};

export interface Actor {
  id: string;
  role: Role;
}

/** How far a role's grant of one permission reaches. */
export function scopeOf(role: Role, permission: Permission): Scope {
  return MATRIX[role][permission];
}

/* Whether an actor may do this, to this thing.

   `ownerId` is the owner of the resource being acted on. Leave it out
   for an operation that has no owner — creating a server, reading the
   node list — and only an "all" grant will do. */
export function can(actor: Actor, permission: Permission, ownerId?: string | null): boolean {
  const scope = scopeOf(actor.role, permission);
  if (scope === "all") return true;
  if (scope === "none") return false;
  return ownerId !== undefined && ownerId !== null && ownerId === actor.id;
}

/** Every permission a role holds at all, for the members page and the docs. */
export function grantedTo(role: Role): Array<{ permission: Permission; scope: Scope }> {
  return PERMISSIONS.map((permission) => ({ permission, scope: MATRIX[role][permission] })).filter(
    (g) => g.scope !== "none",
  );
}

/* ── API keys ─────────────────────────────────────────────────────
   A key's scopes narrow what its owner can already do; they never widen
   it. Both checks have to pass, so a member's key with servers:write
   still only reaches that member's servers. */
export const SCOPE_PERMISSIONS: Record<string, Permission[]> = {
  "servers:read": ["server.read", "node.read", "game.read"],
  "servers:write": [
    "server.start",
    "server.stop",
    "server.restart",
    "server.settings.write",
    "server.update",
  ],
  "console:write": ["server.console.read", "server.console.write"],
  "files:read": ["server.files.read"],
  "files:write": ["server.files.read", "server.files.write"],
  "backups:write": ["server.backup.read", "server.backup.write"],
  "metrics:read": ["server.read"],
};

/** The permissions a set of API-key scopes allows through. */
export function permissionsForScopes(scopes: string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const scope of scopes) {
    for (const permission of SCOPE_PERMISSIONS[scope] ?? []) out.add(permission);
  }
  return out;
}
