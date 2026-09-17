# Security

## Authentication

Sessions are a signed JWT in an httpOnly, SameSite=Lax cookie (`Secure` in
production) carrying a **pointer to a `Session` row**, never user data — so
revoking a session is a delete, not a wait for expiry. Two weeks.

Passwords are bcrypt at cost 12. `verifyCredentials` hashes against a dummy hash
when the account does not exist, so a wrong address and a wrong password take
the same time to answer.

## Permissions

One matrix in [`src/domain/access/permissions.ts`](../web/src/domain/access/permissions.ts).
A permission has a **scope**: `all` is every server, `own` is only the ones this
user owns. `own` is not a weaker `all` — it is the answer to a different
question, and the only reason a member can do anything.

```ts
can(actor, "server.files.write", server.ownerId)
```

| Role | Reaches |
| --- | --- |
| `OWNER`, `ADMIN` | Everything, on any server |
| `MODERATOR` | Reads any server, watches any console; acts only on their own |
| `MEMBER` | Their own servers |

Two asymmetries are deliberate and were preserved exactly from the code this
replaced:

- A moderator can **watch** any console but only **type** into a server they
  own. Watching is oversight; typing is control.
- Console access does not carry the filesystem with it. Files reach worlds,
  config and anything an operator dropped on disk.

Creating and deleting servers are owner/admin only: a placement commits a node's
memory, CPU and a port for as long as the server exists.

Covered by [`test/platform.test.ts`](../web/test/platform.test.ts), including
the asymmetries.

## API keys

Shown once, stored as bcrypt. What is kept in the clear is a mask —
`gbk_live_8f2a…d417` — which the UI shows and which narrows the lookup to a
handful of rows; the bcrypt comparison is what decides.

**A key's scopes narrow its owner; they never widen them.** Both checks have to
pass, so a member's key with `servers:write` still only reaches that member's
servers. A rejection says which half failed — `INSUFFICIENT_SCOPE` and
`FORBIDDEN` need completely different fixes.

Revoking is reversible-ish (the record stays); deleting loses the trail of what
the key could reach, so a key must be revoked before it can be removed.

## Node registration

A registration token is minted in the panel, shown once, and stored as a bcrypt
hash — the same treatment as an API key, because it is the same kind of thing: a
credential that can bring a machine into the fleet.

- Single-use. Consumed the moment a node registers with it.
- Bound to one node name, chosen when it is minted. Before that, a token could
  re-register an existing, approved node's name, which keeps approval — so a
  leaked one could re-point a node in service at another machine. Now that takes
  a token somebody minted for that name, and the audit log says so.
- Expiring. 24 hours by default, 7 days at most.
- Revocable, from the Nodes page — and revoked automatically when the node named
  on it is removed, so a retired name does not come back through a token that was
  lying around.
- Refusals are deliberately vague. "Expired", "revoked" and "never existed" are
  the same answer to whoever is holding a token they should not have.

**Approval is the control that matters.** A node that registers lands as
`PENDING`: no servers are placed on it, and the watchdog ignores it, until an
admin approves it. If a token leaks, the attacker gets a row in a table and a
line in the audit log — not a machine in the fleet.

Registration is the one route that is not user-authenticated, because the caller
is a machine and the token in the body is the whole credential. Everything in
that request is treated as untrusted input: the node name is pattern-checked
before it becomes anything, the advertised URL must parse as http or https, and
capabilities outside the closed set are dropped rather than stored.

## Node security

The panel is the only thing that talks to an agent, except for registration and
heartbeats, which the node initiates.

- Bearer token on every route except `/health`. The agent refuses to start
  without one of at least 32 characters, and has no default for it or for its
  node name — nothing that grants access should ever be checked in.
- Comparison is constant-time, including on a length mismatch, where the naive
  version would leak the length by throwing.
- Tokens are **encrypted at rest** with AES-256-GCM under `SECRETS_KEY`, not
  hashed: the panel is the client and has to present them. A tampered ciphertext
  fails to decrypt rather than yielding garbage.
- The heartbeat authenticates with that same shared secret in the other
  direction, compared in constant time. Two parties know it, so either direction
  is the same proof — and an unknown node, a bad token and an undecryptable one
  all answer identically.
- A token never reaches a browser. The console WebSocket is proxied by the panel
  as SSE precisely so that hop stays server-side.
- The agent token is generated **on the node**, by `npm run join`, and never
  shown to anyone. The panel first sees it when the node presents it at
  registration, so no agent token is ever sent to or made in a browser — until
  September 2026 the Add a node dialog generated it in the browser and displayed
  it once, in a command people then kept in notes and screenshots. Pages that
  need to know whether a node has an agent read the token server-side into a
  boolean.
- On the node, `join` saves the agent token in `agent.json` in the running
  account's profile — `%LOCALAPPDATA%\Geeboard` on Windows, not ProgramData,
  which every local user can read; `~/.config/geeboard` or `/etc/geeboard`
  elsewhere, written `0600` in a `0700` directory. Anything running as that
  account can read it, as it could read the environment of the agent.
- The agent only sees containers carrying its managed label — it will not list,
  touch or report on anything else, so it can share a Docker host. Every
  id arriving in a URL is checked against that label before anything is done to
  it.
- A game port marked private — RCON, TShock's REST API — is published on the
  node's loopback address and nowhere else. Until September 2026 it was
  published on every interface, which put a Minecraft server's RCON on the
  internet behind nothing but the password its image generated. A server made
  before then keeps the old binding until it is rebuilt.

## File security

Every requested path is resolved inside `<dataRoot>/<serverId>` and refused if
it escapes. The check runs **twice on purpose**: a lexical one catches `../`,
and a `realpath` one catches a symlink pointing out of the tree, which no amount
of string handling would see.

The server root cannot be deleted or moved. A file over 2 MB is reported rather
than streamed. A null byte in a path is refused. Server ids are validated before
they become path segments, in the same place, by the same rule.

Covered by [`daemon/test/files.test.ts`](../daemon/test/files.test.ts):
traversal, traversal behind a valid prefix, backslash separators, null bytes,
symlink escape, and a server id that is itself a path.

## Console safety

Commands go to stdin, not to a new process — so "send a command" is talking to
the game, not running something on the machine. Multi-line input is rejected so
a second command cannot be smuggled in. Every command sent is written to the
audit log with its text.

## API surface

- Every `/api/v1` route authenticates first, then checks a permission
- Errors carry a stable code and a message written for a person; the cause is
  logged and never serialised, so a connection string in an exception cannot
  reach a client
- A read scoped to `own` **filters** rather than refusing — a member asking for
  the server list gets their servers, not a 403
- Rate limiting is a fixed window per principal, held in process. It is honest
  about what it is: behind more than one instance each has its own counter, so
  it bounds a runaway script rather than a determined attacker. Anything
  stronger belongs in front of the app, where it can see every instance.
- No route returns `daemonUrl`, `daemonToken`, a password hash or an API key
  hash. The node shape reports `attached: boolean` and nothing else about how
  a node is reached.

## Audit log

Every privileged action writes an `ActivityEvent` with the actor, the target,
the tone and — for settings changes — the before and after of each field.
Lifecycle actions, console commands, file writes and deletes, member role
changes, API key creation and revocation, node draining, and watchdog-detected
crashes and recoveries all land there.

## Environment

```
SESSION_SECRET   ≥32 chars. Signs session cookies.
SECRETS_KEY      ≥32 chars. Encrypts node tokens. Falls back to SESSION_SECRET.
DATABASE_URL
```

The panel refuses to start without `DATABASE_URL`, and throws on the first
session or node-token operation if the secrets are missing or too short.

Generate both with `openssl rand -base64 32`. They are separate variables so
rotating one does not invalidate the other — but note that rotating
`SECRETS_KEY` makes every stored node token undecryptable, so re-encrypt before
you do.

## Known gaps

- No 2FA enforcement. The `twoFactor` column exists and nothing checks it; the
  Members page says so rather than showing an on/off badge nothing backs.
- No password reset and no invitations. An account is created by whoever runs
  the panel, and the sign-in page says that instead of linking to a `/forgot`
  page that never existed.
- The sign-in page prints the seeded credentials only when `NODE_ENV` is not
  `production`, and prefills the demo email on the same condition.
- No CSRF token on server actions beyond Next's own protections.
- Rate limiting is per-process, as above.
- A registration token is a bearer credential in the join command, and so in
  the shell's history and the process list on the node while it runs. It is
  single-use, expiring and bound to one name, and a node it registers still
  waits for approval, which bounds the damage — but a token seen before it is
  used (a screenshot of the dialog) should be revoked.
- On Windows, `agent.json` relies on the profile directory's default ACL rather
  than setting one of its own.
- Single use is checked, then recorded after the node row is written; two
  registrations racing with one token could both succeed.
- The agent listens on `0.0.0.0` by default. On a machine with a public address
  that is the internet; bind `GEEBOARD_DAEMON_HOST` or firewall it.
- `SECRETS_KEY` derives its AES key with a fixed salt. Acceptable because the
  input is already a high-entropy secret rather than a chosen password, but it
  means the same secret always yields the same key.
