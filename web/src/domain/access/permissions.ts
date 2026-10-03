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
  /* Giving a server to somebody: the only way a member comes to own one,
     since creating is not theirs. Owners' and admins'. */
  "server.assign",
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
  /* A shell on a node's machine, as the account its agent runs as. Not
     part of managing a node: managing is done through the agent, which
     bounds what can be asked of it; a shell is not bounded by anything
     but the account. Owners only — see below — and in no API-key scope. */
  "node.terminal",
  /* The workspace's DNS provider — a token that writes records under a
     zone — and the records kept with it. Owners' and admins', like the
     bucket and the Steam key, and in no API-key scope. */
  "dns.manage",
  /* Where the panel sends a message when something goes wrong: an address
     somebody pasted, called from inside the panel's own network. Held like
     the DNS token — owners' and admins', and in no API-key scope. */
  "notifications.manage",
  /* A workspace's saved starting points for new servers, and cloning one
     that exists. Whoever may create a server: owners and admins. */
  "template.manage",
  /* Games that came from a manifest: somebody pasting one in, and
     somebody saying it may run. Proposing, rejecting and retiring reduce
     nothing and add nothing that runs, so owners and admins hold them.
     Approving is giving an image the run of a node that has said it will
     have one: the owner's alone, with a fresh code, like the terminal.
     Neither is in any API-key scope. */
  "community.propose",
  "community.approve",
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

/* Owners and admins share a matrix, with one exception. They differ in
   what they may do to each other, which is a rank comparison rather than
   a permission — see changeMemberRoleOp, where it belongs. The exception
   is the node terminal: a shell on somebody's machine is the one thing
   here that reaches past everything the panel can see or take back, so
   it is the owner's alone. */
const PRIVILEGED = everything();

const MATRIX: Record<Role, Record<Permission, Scope>> = {
  OWNER: PRIVILEGED,
  ADMIN: { ...PRIVILEGED, "node.terminal": "none", "community.approve": "none" },

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

  /* A member is somebody a server was given to, and that is the whole
     of it: they see the servers that are theirs, start, stop and restart
     them, and watch what the game prints while it does. Nothing of the
     workspace — not the other servers, the nodes, the members, the audit
     log — and no settings, files, backups, schedules or keys. Until
     0.4.0 a member held most of these "own" and read every server, but
     owned nothing: a server's owner is whoever created it, and members
     cannot create, so the grants reached no server at all. */
  MEMBER: build({
    "server.read": "own",
    "server.start": "own",
    "server.stop": "own",
    "server.restart": "own",
    "server.console.read": "own",
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

/* Whether a role holds a permission at all, on anything: what decides
   if a page is listed in the navigation and answers, before any one
   server is asked about. A member holds server.read on their own
   servers, so Servers is listed for them; they hold no node.read, so
   Nodes is not. */
export function holds(role: Role, permission: Permission): boolean {
  return scopeOf(role, permission) !== "none";
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
  "servers:read": ["server.read", "node.read", "game.read", "server.backup.read"],
  "servers:write": [
    "server.start",
    "server.stop",
    "server.restart",
    "server.settings.write",
    "server.update",
    "server.schedule.write",
  ],
  /* Making and unmaking servers commits a node's resources, which is a
     different order of thing from restarting one: its own scope, so a
     key that restarts a crashed server at night cannot also delete it. */
  "servers:manage": ["server.create", "server.delete", "server.update", "server.assign"],
  "console:write": ["server.console.read", "server.console.write"],
  "files:read": ["server.files.read"],
  "files:write": ["server.files.read", "server.files.write"],
  "backups:write": ["server.backup.read", "server.backup.write"],
  "metrics:read": ["server.read"],
  // Never node.terminal: a key outlives the session that made it, and a shell must not.
  "nodes:manage": ["node.read", "node.manage"],
  "audit:read": ["audit.read"],
};

/** The permissions a set of API-key scopes allows through. */
export function permissionsForScopes(scopes: string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const scope of scopes) {
    for (const permission of SCOPE_PERMISSIONS[scope] ?? []) out.add(permission);
  }
  return out;
}
