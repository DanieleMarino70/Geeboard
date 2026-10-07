# Security

## Authentication

Sessions are a signed JWT in an httpOnly, SameSite=Lax cookie (`Secure` in
production) carrying a **pointer to a `Session` row**, never user data — so
revoking a session is a delete, not a wait for expiry. Two weeks.

Passwords are bcrypt at cost 12. `verifyCredentials` hashes against a dummy hash
when the account does not exist, so a wrong address and a wrong password take
the same time to answer. (It did not, until 0.9: the dummy was 65 characters, which
bcrypt refuses outright, so an address nobody had answered in 0.01 ms against 264 ms
for one somebody had. The dummy is now a real cost-12 hash made once, when the panel
starts.) Sign-in attempts are bounded — see [Sign-in limits](#sign-in-limits) — in the
process, like the API's rate limit.

### Sign-in limits

Three counters, so that none of them can be spent by somebody else:

- **An address, from one source:** ten tries a quarter hour. Ten wrong passwords typed
  by anybody else, from anywhere else, no longer lock the owner out of their own account.
- **A source:** thirty tries across addresses.
- **An address, from every source:** sixty, as the ceiling over a distributed attacker.

*Source* is the client's address as the proxy in front of the panel saw it: the **last**
`X-Forwarded-For` entry, `GEEBOARD_TRUSTED_PROXIES` entries from the right when there is
more than one proxy. It used to be the first entry, which the client writes, so a script that
sent a different one with every try had a fresh bucket for each. An IPv6 address counts as its
/64, which is what one subscriber is handed. With `GEEBOARD_TRUSTED_PROXIES=0` the header is not
read at all and everybody is one source.

The same source is what limits `/api/v1/nodes/heartbeat` and `/register`, which anybody can
reach: a source refused thirty times in a minute is refused without being read, a node that beats
faster than four times a minute (thirty is the ceiling) is told to wait, and a node's token is
checked after its key is already derived (below).

### Secrets at rest, and the cost of reading them

The key stored secrets are sealed with is derived from `SECRETS_KEY` once and kept. Deriving it
(scrypt) is 30 ms of work that stops the whole process, and it used to be done on every read: by every
page that touched a node, a bucket, a DNS provider or a notification channel, by the poller for every
node on every pass, and by the heartbeat, before it compared the token. It is under a millisecond now
after the first read. An API key's bcrypt compare (73 ms, no yielding) is remembered for five minutes as the
key's SHA-256 against the hash it was proved with; the row is still read on every request, so a revoked key
is refused at once.

### Headers, and cookie-authenticated requests

Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy:
frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin` and a `Permissions-Policy` that
turns off the powerful features the panel does not use, and none says `X-Powered-By`. A panel reached at a
**name over https** also sends `Strict-Transport-Security: max-age=31536000`, read from `PANEL_URL`; an
address, plain http and localhost do not, because a browser does not apply it to an address and the panel
cannot promise https it does not have. A script policy (nonces) is not set: it is a larger change to a framework
that writes its own inline scripts, and is left for later. The referrer policy is never `no-referrer`: with it
a browser sends `Origin: null` on every POST, even to the same host, and the checks below refuse everything.

A request to a `POST`, `PUT`, `PATCH` or `DELETE` route under `/api/v1` that carries only a cookie has to
come from the panel's own origin and, if it has a body, send JSON. A request with an API key is not asked: a program
chooses to send a key, and a browser sends a cookie to any page that asks. Nothing in the product makes such a
request (the pages use server actions, which Next checks the same way), so this is for the script that copied a
cookie, and for a hostile page that tries.

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
shown once and kept as a **salted scrypt hash** (16 MiB, about 40 ms on the thread pool, a salt per
code; they were SHA-256 until 0.9, which a stolen copy of the table gives up in about a day, since ten
characters of 31 is fifty bits). A code is checked against the account's unused ones and spent in a
statement that only spends it if nobody else has. Rows made before 0.9 still work until they are used
or the codes are made again from the account page; the new hash needs no secret, so `rekey` has
nothing to redo.
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
works, the more places it has been. Afterwards the answer is `recover` —
`docker compose -f deploy/panel/docker-compose.yml run --rm panel recover` on an installation from the
image, `npm run admin:recover` in a checkout; the sign-in page and the account page show the one that fits —
which makes another. The audit log carries both.

Until it has been replaced the account is **signed in and shown nothing**:
every page redirects to the account page, and the API refuses the session with
`FORBIDDEN`. Then, and only then, two-factor is asked for. The order is
deliberate: a second factor enrolled behind a password somebody else may have
seen is a second factor somebody else may have enrolled. `accountGate()` in
[`domain/access/account.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/web/src/domain/access/account.ts) is the one
answer all three doors ask.

`setup` refuses once any account exists, inside a serializable transaction so
two people cannot both read "nobody" and each make an owner. `recover`
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
sign-in attempts (see [Sign-in limits](#sign-in-limits)),
two-factor and recovery-link attempts (five in five minutes), and the API's
rate limit (per principal and per budget). For one panel this is exactly what
it says. Behind two or more, each instance counts on its own, so the effective
limits multiply by the number of instances — a bound on a runaway script, not
on a determined attacker.

The panel is written to run as one instance, and the poller **must** be one:
two would each fire every scheduled backup, send every notification twice and write two
DNS records at a name. That one is **enforced**: the poller takes a lock in the database at
start, on a connection of its own, and a second poller says why in one line and leaves (exit code
75); one whose connection to the database ends leaves too, so that its supervisor starts it again
and it takes the lock again. What a second *panel* would need before it made sense — a shared
counter for the limits — is not built, and nothing pretends otherwise. In front of a public
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
| `MODERATOR` | Reads any server, watches any console; on their own servers starts, stops, restarts, configures, schedules and types into them, and cannot delete one |
| `MEMBER` | Only the servers given to them: sees them, starts, stops and restarts them, watches their console. Nothing of the workspace |

Two asymmetries are deliberate and were preserved exactly from the code this
replaced:

- A moderator can **watch** any console but only **type** into a server they
  own. Watching is oversight; typing is control.
- Console access does not carry the filesystem with it. Files reach worlds,
  config and anything an operator dropped on disk.

Creating and deleting servers are owner/admin only: a placement commits a node's
memory, CPU and a port for as long as the server exists. So is **giving** one
(`server.assign`): a server's owner is whoever created it, and the Owner card on
its Settings page, or `POST /api/v1/servers/:id/assign`, hands it to another
account. That is the only way a member comes to see a server. Until 0.4.0 the
matrix gave members most things "own" and no way to own anything, so the grants
reached no server; and it gave them the node list, the member list and the
whole audit log. A member's sidebar now lists what a member can open — the
navigation filters on the same matrix, and every page asks again for whoever
types an address — and the API's `GET /servers` answers a member with their
servers rather than a 403. A moderator is unchanged: they read every server,
and act on their own.

**What `server.read` shows of a server that is not yours.** A moderator reads
every server, and sees another person's server as somebody in the same
community would: its page and state, its address, its settings without the
means to change them, who is playing on it and who has, and the scheduled tasks
on it — including the command a task will type. The names of its players are
read from its console's join lines, and the tasks are a schedule the whole
workspace shares; both are shown on purpose, and are the two places a console
reaches somebody who may not watch it. What it does not show, and did until
September 2026: a join password (a setting marked secret, given only to
whoever may change the settings — see [Audit log](#audit-log)), the list of
its backups (`server.backup.read`; the audit log records each one taken, as it
records every action on every server), and the text of the commands typed into
its console, which is the console's and goes with `server.console.read` — so a
moderator, who watches every console, reads them.

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

**A key expires a year after it is made**, unless it is revoked first: one that never does is a credential
nobody remembers having, held by a script nobody remembers writing. The page shows the date, an expired key
is refused with `That key has expired.`, and a new one is made from the same page. **A key ends with the
sessions that may have made it:** an admin's reset of an account, an owner recovery (`recover`) and **Sign out
other devices** all revoke every key the account has, because a key outlives the session that made it and a
reset exists for the case where a password or a session is in the wrong hands.

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
transfer URLs and refuses a host that is written as `169.254.…` or is Google's metadata name;
beyond that it trusts the panel, which is the only thing that can talk to it. That is a
match on the text of the host, not a judgement of the address: a name that *resolves* to
the metadata service, an IPv6 link-local address, and a redirect are not caught, and the
container firewall (which closes the metadata service to *containers*) is no help against
the agent itself. A compromised panel could therefore point a node's transfer at it. The agent
resolving and judging every address, as the panel does for the bucket and for webhooks, is on
the list for the first non-S3 store. A download is hashed on the way in and refused if it does
not match the checksum recorded when the archive was made.

The bucket's address is typed by an owner or an admin, and the panel calls it
with a signed request from inside its own network, so the call is the guarded
one described under [Notifications](#notifications): the name is looked up once,
every address it gives is judged, and the call goes to one of them, with no
redirect followed and no more of the answer read than a few lines of XML. A store
on this machine, in the same Docker network or on the LAN is the usual way to run
this and is allowed. What is refused is the address a cloud keeps the machine's
credentials at — link-local (`169.254.0.0/16`, `fe80::/10`) and cloud metadata
addresses outside it — the unspecified address, and the multicast and reserved
ranges, in any spelling. An endpoint saved before this rule that falls in one of
those is not deleted; the panel will not call it, and says so where the bucket is
checked.

Configuring, testing, forgetting the bucket and every transfer are audit
events; the keys never appear in one.

An off-site backup outlives the server it was taken from, and its permission
does too: the row keeps the owner the server had, and `can()` is asked about
that owner exactly as before. A member who owned a deleted server can still
reach its backups and nobody else's; restoring one into another server needs the
permission on that server as well, and is refused for a different game before
the node is asked anything.

## DNS provider

The one credential the panel holds for a service outside it, besides the
off-site bucket's and the Steam key: an API token for Cloudflare or DuckDNS,
with which it writes address records for servers ([servers.md](servers.md#dns)) —
or, for a webhook, the secret its requests are signed with and the receiver's
address. Off by default; nothing is called until somebody sets one.

- **Stored** like the bucket's secret: encrypted at rest with `SECRETS_KEY`,
  checked against the provider before it is saved, and never sent back to a
  browser — the DNS page says which provider, which zone, who set it and
  whether the provider still takes it. A key changed with `rekey` keeps it; one
  changed by editing the file makes it unreadable, and the page says so and asks
  for it again.
- **Scoped** as narrowly as the provider allows. A Cloudflare token needs
  Zone:Read and DNS:Edit on the one zone, and the check proves exactly those:
  it reads the zone, and writes and removes a `TXT` record under it. A DuckDNS
  token is the account's, and reaches its subdomains and nothing else.
- **Set** by owners and admins (`dns.manage`), and in no API-key scope.
- **Written** only for a server whose address is under the zone, and only at a
  name the panel made or that already said the right address. A record it
  did not make, pointing elsewhere, is left alone and reported, never
  overwritten. Cloudflare records carry a comment naming the server, which is
  how the panel tells its own. A webhook cannot be asked what is at a name, so
  that protection is its receiver's, which is sent the same comment.
- **Logged** as what was written where — `server.dns.set`, `.updated`,
  `.removed`, `.refused`, `.failed`, `.orphaned` with the address — and never
  the token or the zone's id.
- **Never on the agent.** A node knows nothing of the provider; the panel
  writes every record, so a compromised node holds no DNS credential.

**A webhook** is an address a person typed, called from inside the panel's network, so it
is held to the rules of a notification webhook and to no looser ones: https, to a public
address, unless the operator has set `GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1` on the machine; every
address its name resolves to is judged and the call goes to one of them, by number, never
through a redirect; the machine itself, link-local addresses and the ranges that mean nothing
are never reachable ([notifications](#notifications) says why). It has a timeout of five
seconds, and **the answer is read for its status and nothing more**: what a receiver wrote is
not kept, not shown, and not in the audit log, and a failure says the status and the receiver's
host and never the path, which may hold a secret. Its requests are signed with a secret the
panel makes, which the form shows once, before the receiver has to be told it, because a
receiver that checks signatures cannot answer the test that saves it without it. Neither the
secret nor the address is shown again, in the audit log or by the API, and both are sealed by
`rekey`. **What a receiver does is its own security**, and the page that describes it
([dns-webhook.md](dns-webhook.md)) is plain about it: it has to check the signature and the
timestamp, which is all that stands between the Internet and the zone it writes in. A
receiver that does not holds a zone that anyone can change.

The address a record points at is the node's **public address**, set by hand
on the node's page, or the address the panel observed its heartbeat coming
from. The observed address is read from `X-Forwarded-For` as the panel's own
proxy writes it — the last entry, which is the peer the proxy accepted the
connection from, not the first, which is whatever the client claimed — and is
used only when it is a public address. An agent can therefore steer its own
node's records to wherever it heartbeats from, and to nowhere else: the same
trust a node already has over what runs on it.

## Notifications

The panel can send a message to a Discord channel or to a webhook when a server
crashes, a node goes quiet, a backup fails or an update is available
([notifications.md](notifications.md)). It is the one place the panel calls an
address that a person typed, and the feature is mostly the rules about that.

The address is a secret and is held like one: owners' and admins' only
(`notifications.manage`), encrypted with `SECRETS_KEY` and covered by `rekey`,
shown on the page as the host alone (for Discord, the webhook's id), and in no
audit line, API response or log. An API key cannot reach it however it was made.
A webhook's signing key is shown once, when it is made.

Where it may call is decided before every call and not only when the channel is
saved, because what a name resolves to is not a thing that was checked once:

- Discord only at the addresses Discord issues, and whatever they resolve to must
  be public.
- A webhook over `https`, to public addresses. A name is looked up **once**, by
  the panel; **every** address it gives is judged, one that is not allowed refuses
  the lot, and the connection is made to one of the addresses that were judged,
  by number, with the name kept for the certificate and the `Host` header. A
  second lookup is how a name that answers differently the second time — DNS
  rebinding — would send the call somewhere the check never saw.
- Never, in any setting: this machine's own address, link-local addresses where
  cloud metadata answers (`169.254.169.254`; AWS's IPv6 metadata address too),
  and the unspecified, multicast and reserved ranges. The judgement is on the
  address, so `127.1`, `2130706433`, `0x7f000001`, `::ffff:127.0.0.1`,
  `64:ff9b::a9fe:a9fe` and `2002:a9fe:a9fe::` are what they are.
- A redirect is an answer and is never followed. At most 2 KB of what comes back
  is read, and none of it is kept or shown: a receiver's answer is the one thing
  here that somebody else wrote.
- What a failure says is a fixed phrase and the host's name, never the address
  tried, the path with its token, or what the receiver replied.

One thing widens it, and it is not on the page: `GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1`
in the panel's environment lets a webhook reach private networks (RFC 1918,
carrier-grade NAT, unique-local IPv6), and there, use plain `http`, for ntfy or
Home Assistant on the LAN. The consent is given on the machine by the person who
owns it — the same place the node terminal's is — because whoever can type an
address into the page could otherwise make the panel call anything on its
network. The page says whether it is on. It never allows what is listed as never.

A message names a server or a node by the name a person gave it, says what
happened, and may link back to the panel when `PANEL_URL` is set. It carries no
token, no agent address, no path and nothing a console printed; a reason written
by a node is stripped of paths and control characters and cut to a few hundred
characters. A Discord message cannot ping anybody — a server named `@everyone` is
text — and cannot carry a link of its name's choosing.

The messages are made from the audit log after the fact, so nothing that starts or
stops a server knows about them. Channels, tests, key replacements and removals are
audit events; the address, the key and any message are in none.

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

### The panel-agent channel

The panel calls an agent over **plain http**, with one bearer token. Between two machines
on a LAN, or on a private network (WireGuard, Tailscale), that is a wire nobody else is on.
Across the internet it is not: the token, every console line and every file cross it
unencrypted, and whoever can watch the path can take over every container on the node
through the Docker socket the agent holds. A rule about who may connect to the port does
not protect the path. What 0.9 does, and does not do:

- **The port is closed by default.** `deploy/linux/install.sh` runs `deploy/linux/agent-port.sh`,
  which refuses everything to the agent's port except loopback, the panel's address (what its
  name resolves to when it joins) and, for a node on the panel's own machine, Docker's networks.
  It uses what the machine has: ufw when it is active, firewalld when it is running, and otherwise
  iptables, in a chain of its own (`GEEBOARD-AGENT`, IPv4 and IPv6) that a unit,
  `geeboard-agent-port.service`, puts back at boot. Then it asks the panel whether it can still
  reach the node, which is the proof the rule let the right one in. `--no-firewall` leaves it open,
  and says so; `agent-port.sh status` and `remove` are how to look and how to undo.
  Measured on a VPS: from another machine the port answered before and was refused after, the
  panel on the same machine kept reaching its node, and both survived a reboot. firewalld's path is
  written and was not run on a firewalld machine. **The panel's address is what it learned when the
  node joined:** a name that points somewhere else later, or a panel that calls from an address other
  than the one the name resolves to, is shut out; the node then shows as unreachable, and
  `sudo bash deploy/linux/install.sh` (or `agent-port.sh apply --allow <address>`) is the fix.
- **`/health` says nothing about the node.** It answers `{"ok":true}` to anybody, and used to name
  the node it belonged to.
- **The agent listens on both address families** (`::`, which takes IPv4 as well), where it listened
  on IPv4 only while `join` could advertise an IPv6 address.
- **It says so when the channel crosses the internet in clear:** the installer, when the address the
  agent advertises is `http://` at a public address, and the *Add a node* dialog, when that is what is
  typed in the agent address field.
- **What stays true.** Closing the port does not encrypt the wire. For a node in another place, put the
  node and the panel on a private network and advertise the address on it (`--advertise
  http://10.8.0.2:8080`); a WireGuard tunnel between two VPSs is a few lines and Tailscale is none.
  TLS on the agent port, with a certificate per node that the panel pins, is the real answer and is
  on the roadmap after 1.0: it is a protocol change, and deserves its own release.

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
  the agent that authority's root certificate (`install.sh --panel-ca`,
  `install-node.ps1 -PanelCa`; it sets `NODE_EXTRA_CA_CERTS`), never by switching
  checking off. The command the panel writes carries the authority's SHA-256
  fingerprint, and the node asks the panel for the authority over a connection it
  does not trust and **keeps it only if it matches the fingerprint** (as an SSH host
  key is pinned): the part nobody on the way can change is the part that came from
  the signed-in page, and an authority that does not match is thrown away. That variable
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
it escapes. A lexical check catches `../`. A symlink pointing out of the tree,
which no amount of string handling would see, is caught differently on the two
platforms:

- **On Linux the agent walks the path itself.** It opens the server's directory,
  then each name under it with `O_NOFOLLOW` through the descriptor it already
  holds, and reads a link with `readlink` instead of letting the kernel follow
  it. A link that stays inside the server's folder is followed, as it always
  was; a link that leaves it is refused. Because every step is made from a
  directory the agent has open, a game that swaps a directory for a link
  *between* the check and the write changes nothing: the agent is already
  standing in the old directory. Before, the path was checked with `realpath`
  and then used by name, and that gap was a race: in a test where a process
  swapped a directory for a link to somewhere else as fast as it could, 12 files
  were written outside the folder in about five thousand swaps; it is none in
  nine thousand now.
- **An upload is written to a name the game cannot guess,** under
  `<dataRoot>/.uploads` and not beside the target (that used to be
  `<file>.<pid>.<ms>.upload`, which a game could plant a link at), and is moved
  into place by a rename through the open directory.
- **On Windows the check is still `realpath` and then use.** There is no
  descriptor-relative open there, so a process that can make a link or a
  directory junction inside a server's folder has a window it does not have on
  Linux. It is written down in [Known limitations](limitations.md#nodes-and-storage).
- **A recursive delete holds the folder you asked to delete, not the ones inside
  it.** It removes a link as a link, and what it points at is never followed at
  the top; but a process that swaps a directory *inside* the folder for a link
  during the second or so the delete takes could make it remove a file outside.
  That is the one race left on Linux (the same limitation entry).

The server root cannot be deleted or moved. A file over 2 MB is reported rather
than streamed. A null byte in a path is refused. Server ids are validated before
they become path segments, in the same place, by the same rule.

Covered by [`daemon/test/files.test.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/daemon/test/files.test.ts):
traversal, traversal behind a valid prefix, backslash separators, null bytes,
symlink escape, and a server id that is itself a path; and, on Linux, by
[`daemon/test/beneath.test.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/daemon/test/beneath.test.ts):
links inside that still work, links outside refused on the way and at the end,
the old upload name, and the race above (which fails against the previous
implementation).

## Console safety

Commands go to stdin, not to a new process — so "send a command" is talking to
the game, not running something on the machine. A newline or a carriage return
inside a command is rejected, in the panel and again in the agent, so a second
command cannot be smuggled in (a carriage return ends a line for some consoles,
and only the newline was checked before 0.9). Every command sent is written to the
audit log with its text, which is shown to whoever may watch that console —
see [Audit log](#audit-log). Running something on the machine is a different
thing, with a different door: the [node terminal](#node-terminal).

**Watching is asked everywhere output is shown.** A console carries players'
names and addresses and whatever else a game prints, and a member may open
every server's page but watch only their own server's console. The console
page, the last lines on a server's page and the stream all ask
`server.console.read`, and the two pages say why there is nothing to show.
Until September 2026 only the stream did: the page loaded a thousand lines of
any server named in its address, and the overview showed six, to anybody
signed in. A crash is reported on a server's page as the console line that
showed it; to somebody who may not watch that console, the page says the line
is there instead of quoting it.

**A stream is authorised while it runs, not only when it opens.** It is one
request that lasts as long as the tab, so a check made at the start would
outlive a role taken away or a session ended from the account page. The
console stream asks again every ten seconds — the
session, the account gate and the permission, read from the database — and
closes with the reason when the answer changes. It asks the account gate as
every page does; it used to skip it, so an owner or admin who had not enrolled
two-factor could open a stream by its address. So did the audit export and the
install progress route, which read the session themselves; every route that
does is now held to it by `test/account-gate.test.ts`. A database that cannot
be read keeps an open console as it was: everything that takes the right away
is a write to that database.

## Node terminal

A shell on a node's machine, from the panel (0.3.5; [nodes.md](nodes.md#node-terminal)).
Everything else the panel does to a machine goes through the agent's routes,
each of which does one bounded thing; a shell is bounded by nothing but the
account it runs as. So it crosses three doors, held by three different parties,
and each is enough to keep it shut.

**The machine decides whether.** Off until somebody at the machine sets
`GEEBOARD_TERMINAL=1` or runs the installer with `--terminal`; the panel has
no way to switch it on, and the command the Add a node dialog writes never
carries the flag. The agent says in every heartbeat what a shell there would
be — the account, the program, and whether it is the machine's shell or one
inside the agent's container — and the panel shows that before anyone opens
one. On Windows it is the installing account's PowerShell, not elevated; on
Linux it is `/bin/sh` inside the agent's container, which sees the agent's
mounts and the host's network and not the host's files.

**The panel decides who.** `node.terminal` is held by owners alone — the one
permission an admin does not share — and belongs to no API-key scope, so no
key reaches it however it was issued. The routes that open, drive and stream
a session live outside `/api/v1`, read the session cookie and nothing else,
and check the request's `Origin` themselves, since Next checks it only for
server actions. Opening asks for a fresh code from the authenticator: the one
that signed in is spent, its step is recorded under a condition so two
requests carrying the same code cannot both pass, and five wrong codes in five
minutes close the door for five minutes. A refusal is in the audit log.

**The road must not be the open Internet.** A terminal carries what is typed and
what the shell prints, passwords included, and the panel reaches most agents over
plain HTTP. So an agent reached with `http:` at a public address gets no terminal:
the panel says why and what to do, before any code is asked for. A private or
loopback address — `10.x`, `172.16–31.x`, `192.168.x`, `100.64–127.x`, `127.x`,
`::1`, a link-local or unique-local IPv6 — is allowed over plain HTTP, since that
road is the machine's own network; and an agent reached over `https:` is allowed at
any address. A name, which can point anywhere and is not known to be private, is
refused over `http:` like a public address, `localhost` included: register such a
node by its IP address, or put TLS in front of its agent. The consequence: **a node
with a public address has a terminal only if its agent is reached over HTTPS.** The
rule is about the address the panel reaches the agent at, which is what the node
registered; it is decided with the rest in `terminalDecision`, which the Terminal
page, the node's page and the open all ask, before a code is looked at.

**The session is the sign-in's.** It belongs to the session that opened it:
another sign-in of the same owner is refused its stream and cannot type into
it. It is asked again every ten seconds — the sign-in, the account gate, the
role, the node's approval and its agent token — and closes with the reason
when any of them changes, as a console does. A rotated token ends it: the
socket the panel holds was opened with the old one, and nothing outlives a
token. The browser going away leaves the shell for thirty seconds, for a page
reload, and then ends it; the agent ends a session after fifteen idle minutes,
after four hours, and when it stops, and allows two at once.

**What travels, and what is kept.** The browser talks to the panel only:
output comes as Server-Sent Events and typing goes back in numbered requests,
one at a time, taken once each. The panel talks to the agent over a WebSocket
whose token is in the handshake's header and never in its URL — the console's
moved there too in 0.3.5, with the agent still taking the old form from
panels of that line. The shell's environment is the agent's minus every
`GEEBOARD_*` and `NODE_*` variable. What was typed or printed is kept
nowhere: the audit log has that a session opened and closed, on which node,
by whom, for how long, why it ended and how many bytes each way; the panel's
and the agent's logs have the same and less.

**When it ends, everything it started ends.** `taskkill /T` on Windows,
which follows parentage and so catches a program the shell started in a
window of its own; on Linux a hang-up to the shell's process group and every
descendant found through `/proc`, then a kill three seconds later, because a
shell with job control puts a background job in a group of its own.

Covered by `test/terminal.test.ts` (who may open one, on which node),
`daemon/test/terminal.test.ts` (the session manager, a real shell through the
real PTY, the agent's routes) and `verify:terminal` (the whole path, twice,
and every refusal above).

## Community games

A manifest is a game written by somebody else, and an approved one **runs an image
somebody chose** on a node (0.6.0; the whole of it is in
[community-games.md](community-games.md)). It is the one place the project runs code
a person picked, so what holds it in is in layers, and none of them is a sandbox.

**Who.** `community.propose` is for owners and admins, `community.approve` for owners
alone, and neither is in any API scope: no key can propose or approve. Approving asks
for a **fresh authenticator code** — the same check as opening a terminal: not the code
that signed you in, which is spent, and not one already used — and is bound to the **SHA-256 of the
canonical manifest**: the page shows the hash, the operation refuses if it is not the
stored one, and a stored row that no longer hashes to what was proposed does not approve
and does not load. The checks that need a code are made last, so a refusal does not spend
one. Approving, retiring and changing the registries are warnings in the audit log, which
names the game, the revision and twelve characters of the hash — never the manifest.

**What.** A manifest is validated by a closed list: a field the panel does not know is an
error, and what comes out is built from what was checked. An image has to be named by its
digest, from a registry on the owner's list (`docker.io` and `ghcr.io` to begin with); the
agent would pull any, so the panel holds this line. There is no `mods`, no download and no
Steam branch, no way to write a file outside the server's folder, none of the panel's own
environment variables, no reserved port. A regular expression is checked statically, run
against lines built to hurt it, and guarded at run time by a time limit. The agent builds
every container from a fixed list of options, which a test holds: no privileged mode, no
added capability, no device, no host mount, no host network.

**Where.** A game of this kind is placed only on a node whose machine declared
`community-games` — on the machine, never from the panel. The panel's join command does
not carry it and the dialog does not offer it.

**What is still true.** An approved image runs as root in its container, with Docker's
default capabilities, and reaches the Internet and the network of the machine it runs
on: on a Linux machine measured, SSH on the node, the agent's port and the proxy answered
from a container, and on a cloud machine the provider's metadata service at
`169.254.169.254` answered with HTTP 200. That is true of every game Geeboard hosts. The
panel's own port and database did not answer, on a standard install. A digest says which
bytes run, not what they do. `deploy/linux/container-firewall.sh` closes the node's SSH and
agent ports and the metadata service for containers, and was tested on a real machine; the
page says what it does not cover. Nothing in Geeboard stops an owner approving an image that
is hostile, and the approval page says in plain words what it would be allowed to do.

## API surface

- Every `/api/v1` route authenticates first, then checks a permission — except three that
  nobody signed in can be asked for, each with its own reason. `nodes/register` takes the
  registration token in its body and is the door a new node comes through; `nodes/heartbeat`
  takes the node's own token and is limited by source before it reads anything; `panel-ca` is
  this panel's root certificate, public because the node asking has no token yet and compares
  what it gets with a fingerprint it was given (a root certificate is not a secret)
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
  audit entry live. The check is the one table above, asked with the permission
  each operation names (`web/src/domain/access/operations.ts`), and a refusal
  is the same sentence on a page and over HTTP. It was "owner, admin, or
  whoever owns the server" until 0.9.0, which is not the table: a member who
  had been given a server could delete it, change its settings, run its tasks
  and type into its console from the page, while the API refused every one. A scope is a bundle of permissions and the role still
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

It outlives what it is about. A deleted account's lines keep the name they
were written under, and a deleted server's lines keep its name and slug —
written onto them as it is deleted — so the history of a server is still there
after the server is not, in the page, its search and its CSV export. Until
September 2026 a server's lines were deleted with it.

Every owner, admin and moderator reads the log (a member does not: a member holds no
`audit.read`), so two things are kept out of what it shows. **A
console command's text** is shown to whoever may watch that server's console,
and to nobody else: the line says who sent a command to which server and when,
and *command not shown* in place of the command — on the Audit and Activity
pages, the dashboard, the CSV export and the API, whose search does not look
inside a text its reader may not see. A deleted server's owner is not kept, so
its commands are read only by those who may watch every console. This is
decided when a line is read, so it holds for every command ever recorded. And a
command is recorded **without a secret the server holds**: where its text contains
the current value of one of the game's secret settings (a join password typed as
`password …` at the console, or in a `say`), the line keeps `[hidden]` in its place,
decided when the line is written, so it holds from 0.9 on and not for a command
recorded before it. The command still reaches the game as it was typed.
**A secret setting** — a join password — is recorded as changed and never as what
it was or became. That is decided when a line is written: a password changed
before 0.3.2 is still in its line, for every owner, admin and moderator to read (see
[Known gaps](#known-gaps)). Everything else a line records — a backup's name
and why it failed, a setting's value before and after — is there for every owner,
admin and moderator, as the log has always been.

## Environment

```
SESSION_SECRET   ≥32 chars. Signs session cookies.
SECRETS_KEY      ≥32 chars. Encrypts node tokens, the bucket's keys, the DNS token,
                 two-factor secrets and notification channels.
                 Required in production: the panel will not start without it. Where it is
                 not set, SESSION_SECRET stands in (see below).
DATABASE_URL
PANEL_URL        The https address browsers and node agents use.
GEEBOARD_WEBHOOK_ALLOW_PRIVATE
                 Optional. 1 lets a webhook reach private networks. See Notifications.
```

`npm run setup:env` writes them, generated, into `.env` — once; it never
overwrites one that exists, because `SECRETS_KEY` is what every stored node
token is encrypted under. In production the panel checks them before it takes
a request and exits if they are missing, short, identical or example-looking;
in development it says so and carries on.

Rotating `SESSION_SECRET` signs everybody out and costs nothing else — where
`SECRETS_KEY` is set. Where it is not, `SESSION_SECRET` stands in for it: rotating that one
also makes every stored secret unreadable, so set `SECRETS_KEY` first. The fall-back is in the
code that seals and opens a secret, which does not ask what environment it is in; the
check that refuses a production panel without a `SECRETS_KEY` runs when the panel starts, and
the commands run by hand — `admin:recover`, `node-token` — are separate processes that do not
run it. One started in a shell without the variable would seal or open under `SESSION_SECRET`, and
what it sealed the panel could not open (`rekey` is the exception: it refuses a key that is
missing or the wrong length, and says which). Editing `SECRETS_KEY` makes every stored node token, the
off-site bucket's keys, the Steam key, the DNS provider's token (and a webhook's
address), every notification channel's address and signing key and every two-factor
secret undecryptable: the nodes would have to be registered again and
the rest set up again. To change it without that, use `rekey`, below. Back the file
up with the database — a dump restored beside a different key is a panel that can
reach none of its nodes.

### Changing `SECRETS_KEY`

`rekey` opens every stored secret with the key the panel holds now and seals it
again with a new one, in one transaction: all of it, or none. The agents are not
touched — a node's token lives in plain text on its own machine, and only the
panel's copy is encrypted — so no node is registered again. Stop the panel and the
poller first, as for a migration, so that nothing is written while it runs. Then,
from `deploy/panel`:

```bash
docker compose stop panel poller
export SECRETS_KEY_NEW="$(openssl rand -hex 32)"
sudo --preserve-env=SECRETS_KEY_NEW docker compose run --rm -e SECRETS_KEY_NEW panel rekey --dry-run   # counts, writes nothing
sudo --preserve-env=SECRETS_KEY_NEW docker compose run --rm -e SECRETS_KEY_NEW panel rekey
# put the same value in deploy/panel/.env as SECRETS_KEY, then:
docker compose up -d
```

The new key is read from the environment and never from the command line, where it
would sit in the shell's history and the process list; nothing the command prints is
a key or a secret. Keep the value: it is what `SECRETS_KEY` becomes, and until it is
in `.env` the panel cannot read what was just sealed.

`sudo` is for a host where Docker needs it; where your account is in the `docker`
group, leave it out and the variable passes as it is. It is `--preserve-env=` and not
`-E` because the `sudo` that Ubuntu ships from 25.10 (sudo-rs) ignores `-E`: the
command then starts without the variable and stops at once, saying it is not set.
Nothing is written in that case, and the fix is the option above.

**How you find out the key is not the right one.** The panel and the poller each open
every stored secret once, at start, and say in one line how many do not and where
(`3 stored secrets do not open with SECRETS_KEY (node tokens: 2, two-factor secrets: 1)`).
The poller then names each node whose token is among them, treats it as not reached (the
Nodes page says why) and goes on with the others, the scheduled backups and the
notifications; an action on such a node, and the DNS page, say
`SECRETS_KEY is not the key these secrets were sealed with`, and the API answers
`SECRETS_UNREADABLE`. All of it is the same cause, and putting the previous value back and
restarting is the whole repair.

It stops, and changes nothing, when any stored value does not open with the current
key — most often because `SECRETS_KEY` was edited before it was run, in which case the
message says so: put the old value back, pass the new one as `SECRETS_KEY_NEW`, and run
it again; the edit comes last. It also stops if a value changes under it, and if the new
key is short, a placeholder, the one already in use, or `SESSION_SECRET`. A successful
run is one `secrets.rekeyed` line in the audit log, with how many of each kind and no
key. `npm run rekey` does the same from a checkout.

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
- A join password changed before 0.3.2 is in the audit log as it was and as
  it became, readable by every owner, admin and moderator. Nothing removes it; change the
  password again if the old lines matter, and the new line will not carry it.
- The names of a server's players and the commands its scheduled tasks type
  are shown to whoever may see that server (owners, admins, moderators, and a
  member of a server given to them), from its page, Players, Analytics and the
  scheduler. They are read from, or written to, its console — the one place a
  console reaches somebody who may not watch it, and on purpose: see
  [Permissions](#permissions).
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
- A node fetches whatever transfer URL the panel hands it (http or https, and not a host
  spelled as a link-local IPv4 address or Google's metadata name: see
  [Off-site backup storage](#off-site-backup-storage) for how little that is). The panel is the only caller, and its URLs are the bucket's, but
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
- No CSRF token on server actions beyond Next's own protections. Those are an `Origin` check
  before the action is looked up: a foreign origin, and the opaque `null` a sandboxed frame
  sends, are refused; the panel's own and — from a client that is not a browser, which has no
  victim's cookie to send — none at all are let through. `serverActions.allowedOrigins` is not
  set. `verify:terminal` pins all four behaviours against a running panel, so a change of
  Next's rule, or of this config, is found there. The panel's own route handlers that take
  the session cookie outside `/api/v1` — the four of the terminal — are the only ones there
  are, and each checks the origin itself.
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
- A node terminal on Windows is that same account's shell, and can read
  `agent.json` — the node's token — as the account can. That access outlives
  the permission that opened the shell, and the panel's audit log does not see
  it; only a token rotation takes it back. This is why the consent lives on
  the machine and the permission with the owner alone.
- A node terminal on Linux is a shell inside the agent's container, where the
  Docker socket is mounted, and the socket is root-equivalent on the host, as
  the agent is. The same boundary as the agent's own: the token in front of
  its port, and now the owner's code in front of the shell.
- Terminal sessions live in the panel process's memory, like the attempt
  limits: a second instance would not know the first's, and a panel restart
  ends every open shell. See [One instance](#one-instance-and-what-changes-with-more).
- `SECRETS_KEY` derives its AES key with a fixed salt. Acceptable because the
  input is already a high-entropy secret rather than a chosen password, but it
  means the same secret always yields the same key.
