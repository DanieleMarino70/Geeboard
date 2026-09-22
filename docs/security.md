# Security

## Authentication

Sessions are a signed JWT in an httpOnly, SameSite=Lax cookie (`Secure` in
production) carrying a **pointer to a `Session` row**, never user data — so
revoking a session is a delete, not a wait for expiry. Two weeks.

Passwords are bcrypt at cost 12. `verifyCredentials` hashes against a dummy hash
when the account does not exist, so a wrong address and a wrong password take
the same time to answer. Sign-in attempts are bounded — ten a quarter hour per
address, thirty per source — in the process, like the API's rate limit.

### Accounts, made from the panel

An owner or admin adds a member from **Members**: name, email, role. The row is
created with a password nobody knows (bcrypt of 32 random bytes) and
`passwordSetAt` empty, and a **one-time setup link** comes back, shown once the
way an API key is. The panel sends no email — that is a dependency, an SMTP
relay and a mailbox to trust, and it was decided against — so the admin hands
the link over themselves, and the page says so.

The link is the credential: `gbt_` and 32 random bytes, stored only as its
SHA-256 in `account_tokens`, expiring (seven days for setup, one day for a
reset), single-use, and one live link per account — issuing a new one ends the
old. It is spent in a single `UPDATE … WHERE usedAt IS NULL`, so two
submissions racing on one link cannot both succeed. Guesses at links are
bounded like passwords. Looking at a link does not spend it; setting the
password does, and every session of the account ends with it.

**Reset** is the same link with a different purpose, issued by an owner or admin
from the member's row. It ends every session of the account at once — the usual
reason for a reset is that the old password is in the wrong hands — and, when
the link is used, removes two-factor from the account: a reset is also the way
back in for somebody whose phone and recovery codes are both gone, and an admin
who can issue one can therefore remove a second factor. The audit log says so.
An admin cannot reset an owner, and nobody resets their own from there: a
signed-in person changes their password from **Account** with the current one,
which ends their other sessions and keeps this one.

Setting a password is judged on length alone: ten characters at least, two
hundred at most. Composition rules make passwords predictable, not strong.

### Two-factor

TOTP (RFC 6238 over RFC 4226: HMAC-SHA1, six digits, thirty seconds), written
against `node:crypto` in [`src/domain/access/totp.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/web/src/domain/access/totp.ts)
and checked against the RFCs' own vectors — no dependency, and any
authenticator app. The secret is 20 random bytes, encrypted at rest with the
same AES-256-GCM as a node token, shown once as base32, as an `otpauth://` URI
and as a QR code of that URI. The code's modules are computed on the server
([`src/lib/qr.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/web/src/lib/qr.ts)) and drawn by the page as rectangles,
so the secret goes to no image service and no third party. The encoder is the
one dependency this took (`uqr`, MIT, none of its own): TOTP could be checked
against the RFC's vectors and the S3 signature against Amazon's, and a QR code
has nothing to be checked against but a phone. Enrolment is a
two-step — start, then confirm with a code — so a secret that never reached the
app never counts.

A code is accepted for its own thirty-second step and one either side, and the
step of the last code accepted is recorded, so a code seen once cannot be
replayed within its window. Five tries in five minutes per account, in the
process. After the password, a two-factor account gets no session: it gets a
five-minute signed cookie scoped to `/sign-in`, which names the account and
grants nothing but the right to try a code.

Ten **recovery codes**, ten characters each from an alphabet without look-alikes,
shown once and kept as SHA-256; each is spent in the statement that finds it.
Using one is a warning in the audit log, and the account page says how many are
left. Regenerating them, or turning two-factor off, needs a current code (and,
for turning off, the password).

**Required by role.** Owners and admins must use two-factor; everyone else may.
An owner or admin without it is signed in and sent to their account page by
every other page, and the API front door refuses their session with
`FORBIDDEN` until they have enrolled. A member may turn it off; an owner or
admin may not.

### The first account, and the way back to it

An installation's first owner is made by `npm run setup` on the panel's own
machine, never in a browser: on a VPS the first visitor to a new port is as
often a scanner as the installer, and a first-run form hands them the panel.
Being able to run a command as the panel, against its database, is the proof of
being the administrator — whoever can do that already has everything the panel
protects.

The password it prints is **temporary**: twenty characters from an alphabet
with no look-alikes, random per installation, shown once in the terminal,
stored only as a bcrypt hash, and good for **24 hours**. It was read off a
screen and perhaps pasted into a note on the way to a browser; the longer it
works, the more places it has been. Afterwards the answer is
`npm run admin:recover`, which makes another — the audit log carries both.

Until it has been replaced the account is **signed in and shown nothing**:
every page redirects to the account page, and the API refuses the session with
`FORBIDDEN`. Then, and only then, two-factor is asked for. The order is
deliberate: a second factor enrolled behind a password somebody else may have
seen is a second factor somebody else may have enrolled. `accountGate()` in
[`domain/access/account.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/web/src/domain/access/account.ts) is the one
answer all three doors ask.

`setup` refuses once any account exists, inside a serializable transaction so
two people cannot both read "nobody" and each make an owner. `admin:recover`
works on owners alone; everybody else is reset from **Members**, where there is
a name to put in the audit log. A recovery removes the account's two-factor and
ends every session it has — it is the way back in for a lost phone and lost
codes — and says so as `installation.owner.recovered`.

The seed is a development tool and knows it: `db:seed` and `db:seed:empty` wipe
the database and create an account whose password is published in the source,
so they refuse to run with `NODE_ENV=production`. The sign-in page mentions
those credentials only when that account actually exists.

### What the panel refuses to start with

In production the environment is checked before the first request — a missing
`DATABASE_URL`, a secret shorter than 32 characters, `SECRETS_KEY` equal to
`SESSION_SECRET`, the development database password, or a secret that **looks
like an example**. That last one is not hypothetical: `.env.example` used to
ship `generate-with-openssl-rand-base64-32` in both secrets, thirty-six
characters long, passing every length check, printed in a public repository.
A panel that followed its own README signed sessions with a value everybody
has. The file now ships them empty and `npm run setup:env` generates them.

### One instance, and what changes with more

Three things are counted in the panel's own process, not in the database:
sign-in attempts (ten a quarter hour per address, thirty per source),
two-factor and recovery-link attempts (five in five minutes), and the API's
rate limit (per principal and per budget). For one panel this is exactly what
it says. Behind two or more, each instance counts on its own, so the effective
limits multiply by the number of instances — a bound on a runaway script, not
on a determined attacker.

The panel is written to run as one instance, and the poller **must** be one:
two would each fire every scheduled backup. What a second panel would need
before it made sense — a shared counter for the limits, a lock or a leader for
the poller — is not built, and nothing pretends otherwise. In front of a public
panel, put rate limiting in the proxy, where it sees every instance.

## Permissions

One matrix in [`src/domain/access/permissions.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/web/src/domain/access/permissions.ts).
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

Covered by [`test/platform.test.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/web/test/platform.test.ts), including
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

## Off-site backup storage

One S3-compatible bucket per workspace, configured by an owner or admin. The
keys are encrypted at rest (AES-256-GCM, the node-token key), written once and
never shown back — the page shows the endpoint, the bucket and a mask of the
key id. Nothing is saved that did not just accept a test upload.

A node never holds the keys. The panel signs a URL (SigV4, `node:crypto`,
checked against Amazon's published vectors) that allows one `PUT` or one `GET`
of one object for an hour, and the node streams the archive on it. A URL that
leaks is worth that one object for that hour. The node accepts only `http(s)`
transfer URLs and refuses link-local addresses, so it cannot be pointed at its
own metadata service; beyond that it trusts the panel, which is the only thing
that can talk to it. A download is hashed on the way in and refused if it does
not match the checksum recorded when the archive was made.

Configuring, testing, forgetting the bucket and every transfer are audit
events; the keys never appear in one.

An off-site backup outlives the server it was taken from, and its permission
does too: the row keeps the owner the server had, and `can()` is asked about
that owner exactly as before. A member who owned a deleted server can still
reach its backups and nobody else's; restoring one into another server needs the
permission on that server as well, and is refused for a different game before
the node is asked anything.

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
- **The agent checks the panel's certificate, always.** A panel behind a
  certificate authority of its own — Caddy's `tls internal`, which is how a
  panel with an address and no domain name gets https — is trusted by giving
  the agent that authority's root certificate (`install.sh --panel-ca`, which
  sets `NODE_EXTRA_CA_CERTS`), never by switching checking off. That variable
  adds one authority to the public ones; `NODE_TLS_REJECT_UNAUTHORIZED=0`
  removes all of them, on the channel that carries the orders the node obeys,
  and nothing in Geeboard sets it. The root certificate is not a secret: it
  checks signatures and makes none.
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
- **The token is rotated from the node's page**, with the node in service. The
  panel generates the new one on the server and sends it to the agent over the
  channel the old one authenticates; it is never shown, returned by a route, or
  sent to a browser. Two steps, so that a failure at any point leaves a node
  the panel can still reach: the agent saves the new token beside the old and
  accepts both; the panel records the new one; then the agent is told — by the
  new token, and only by it, so the old cannot retire itself in — to forget the
  old. Both tokens are compared in constant time, every candidate every time.
  An agent whose token is `GEEBOARD_DAEMON_TOKEN` refuses, because the variable
  would win again at the next start and a rotation that silently reverts is
  worse than none. Audited as `node.token.rotated`, saying whether the old
  token was forgotten.
- **One exchange with a game's port.** Health queries need the node to send
  bytes to a game and hand back the answer. An endpoint that writes bytes to a
  port on request is a port scanner with an HTTP interface unless it is
  bounded, so it is: only a port the named server's own workload publishes, on
  the transport it publishes it on, on this machine; one payload of at most
  1 KB, a reply cut at 4 KB, five seconds; and the only caller is the panel,
  which already controls that game's console and files. The node holds no
  protocol knowledge — see [servers.md](servers.md#health).
- **File bytes are capped and atomic.** The raw file routes stream, stop at
  256 MB either way, resolve every path inside the server's directory like the
  text routes, and write beside the target before renaming over it.
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

Covered by [`daemon/test/files.test.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/daemon/test/files.test.ts):
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
  a node is reached. Backup shapes leave out the node's archive path and the
  off-site key; file routes never return a path outside the server's root,
  because the node refuses to resolve one
- A route never does anything a server action does not: both call the same
  operation, which is where the permission check, the state check and the
  audit entry live. A scope is a bundle of permissions and the role still
  decides, so a key cannot be issued past its owner
- Deleting a server or a node over HTTP asks for the typed name, as the
  dialogs do — a script has to know what it is deleting, not just its id
- A scope with no route behind it is refused at key creation. All ten have
  routes now; the mark stays for the next one

## Audit log

Every privileged action writes an `ActivityEvent` with the actor, the target,
the tone and — for settings changes — the before and after of each field.
Lifecycle actions, console commands, file writes and deletes, member role
changes, API key creation and revocation, node draining, and watchdog-detected
crashes and recoveries all land there. So does everything about an account:
creation and password reset (by whom, for whom, how many sessions ended), a
password set or changed, two-factor turned on or off, recovery codes
regenerated or used, sessions ended from the account page.

## Environment

```
SESSION_SECRET   ≥32 chars. Signs session cookies.
SECRETS_KEY      ≥32 chars. Encrypts node tokens and the bucket's keys.
                 Falls back to SESSION_SECRET in development only.
DATABASE_URL
PANEL_URL        The https address browsers and node agents use.
```

`npm run setup:env` writes them, generated, into `.env` — once; it never
overwrites one that exists, because `SECRETS_KEY` is what every stored node
token is encrypted under. In production the panel checks them before it takes
a request and exits if they are missing, short, identical or example-looking;
in development it says so and carries on.

Rotating `SESSION_SECRET` signs everybody out and costs nothing else. Rotating
`SECRETS_KEY` makes every stored node token and the off-site bucket's keys
undecryptable: the nodes have to be registered again and the bucket configured
again. Back the file up with the database — a dump restored beside a different
key is a panel that can reach none of its nodes.

## Known gaps

- Setup and reset links are handed over by hand. Whatever channel the admin
  uses — a chat, a note — holds a live credential for up to seven days; the
  link is single-use and the account it opens has no session, but a link seen
  before its owner uses it should be replaced by issuing another.
- Attempt limits on sign-in, codes and links are per process, like the API's
  rate limit — see [One instance](#one-instance-and-what-changes-with-more).
- A temporary password is a credential in a terminal's scrollback, and in the
  shell history of anybody who pasted it. It expires in a day and can do
  nothing but replace itself, but it should be used and then replaced.
- Whoever can run a command on the panel's machine as its account can make
  themselves an owner's password. That is what "the machine is the proof"
  means, and it is why the panel's account should own only the panel.
- A reset issued by an admin removes the account's second factor when used.
  That is the recovery path for a lost phone and lost codes, and it means an
  admin can strip two-factor from any member (an owner from anyone); the audit
  log records both the issue and the use.
- The `otpauth://` secret is shown as text and as a QR code, so it passes
  through the clipboard and the screen like any secret shown once — and a
  screenshot of the page is the secret.
- A token rotation the agent did not confirm leaves the old token valid on the
  node until the next rotation succeeds. The panel says so at the time and in
  the audit log; it does not retry on its own.
- The exchange probe sends whatever bytes the panel gives it to a game's own
  port. A compromised panel could use it to send a game traffic — as it could
  already type into its console. It cannot reach any other port or host.
- A game that does not like a well-formed question could still fall over.
  Every protocol declared has been put to the real image first, and vanilla
  Terraria's crash on an unanswered connection is why the node never hangs up
  before its timeout; a new game's protocol needs the same measurement.
- A node fetches whatever transfer URL the panel hands it (http or https, not
  link-local). The panel is the only caller, and its URLs are the bucket's, but
  a compromised panel could point a node at another host for a PUT of one
  archive. The bucket's keys never leave the panel either way.
- Off-site archives are not encrypted by Geeboard before upload: what the
  bucket holds is the gzipped tar, readable by whoever can read the bucket.
  Use the store's own encryption at rest.
- The sign-in page prints the seeded credentials only outside production **and**
  only where that seeded account exists; an installation made by `setup` never
  sees them.
- Until the release work, every page in the panel carried the signed-in
  person's whole `User` row into the payload the browser receives —
  `passwordHash` and the encrypted `totpSecret` included — because the shell is
  a client component and was handed the row. `shellUser()` narrows it to a
  name, initials and a role, and `test/shell-user.test.ts` fails if a page
  stops using it. The hashes were bcrypt at cost 12 and the secrets were
  encrypted, so this was an offline-attack surface rather than a key handed
  over; anybody who ran an affected version should still change their password
  and re-enrol two-factor.
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
- The agent container runs as root with the Docker socket, which is
  root-equivalent on the host. That is what an agent that creates containers
  and binds host directories is, container or not; the token in front of its
  port is the whole of the boundary, so the port must not be public.
- The Windows scheduled task runs the agent interactively in the account that
  installed it, with that account's rights, while that user is signed in.
- `SECRETS_KEY` derives its AES key with a fixed salt. Acceptable because the
  input is already a high-entropy secret rather than a chosen password, but it
  means the same secret always yields the same key.
