# Notifications

The panel can tell a Discord channel, or anything that takes a webhook, when
something needs a person: a server crashed, a node went quiet, a backup failed,
an update is available. It is opt-in and it is narrow. With no channel set up
nothing is sent and nothing about a server changes; with one, the panel says
what it already knows, in a message short enough to read on a phone.

It does not send email. The project has no mail server and does not want one.

## What it tells you

Seven things can be ticked on each channel, and a channel made now starts with all of
them (a channel made before 0.9 keeps what it had, and the new one is unticked there):

| | What it means |
| --- | --- |
| **A server crashed** | One message for a crash, with whether the panel restarted it (*restarted it, 1 of 3*). Several servers at once are one message |
| **The panel gave up restarting a server** | It crashed again and again, or ran out of memory. Somebody has to look at it |
| **A server was left stopped** | Something other than the panel stopped it, often a restart of the machine or Docker, and its restart policy does not start it again, so it is down. One message, with what is known about why, the policy and what to do; several servers at once are one message. A server whose policy does start it again is not one: it is started, and that is the recovery row |
| **A node went offline** | The panel has not heard from it for several minutes. Its servers are probably still running |
| **A node came back** | The panel can reach it again |
| **A backup failed, or one is damaged** | A backup that could not be made, or an archive that is gone from its storage or no longer matches its checksum |
| **An update is available for a server** | Once for each server and each version it could move to |

Left out on purpose. A stop somebody asked the panel for, including one typed at the
game's console from the panel, is not an alarm. A server's health flapping
is too noisy. Everything a person did is in the audit log already, and a message
for each would be a second audit log in a chat.

The messages are made from what the panel already writes to its
[audit log](security.md#audit-log), after the fact: nothing in the place a server
is started, stopped or restarted knows about notifications, so they cannot slow
it down or make it fail.

### One cause, one message

The panel's own rows were written for an audit log and not for a phone, so they
are tidied before they are sent:

- A crash the panel puts right is two rows in the same pass. It is one message:
  *Aurora SMP crashed. The panel restarted it (1 of 3).*
- Servers that fall over together — a node's host restarted — are one message
  naming them, not twenty.
- A backup that failed because its node is unreachable is the node being down,
  and is not sent again as a failed backup.
- A channel is sent at most ten messages a minute. Past that, the rest are not
  sent, and one message says how many were held back. A server in a crash loop
  cannot reach it on its own: the panel gives up after three restarts, with
  waits of 0, 30 and 120 seconds; the limit is for a whole node going down.

A message is not news after a day. A panel that was off for a week does not
announce the week when it starts again.

## Setting a channel up

**Notifications**, under Infrastructure, is for owners and admins. Pick Discord
or a webhook, name it, paste its address, tick what it should hear, and press
*Send a test and save*. The channel is saved only if the test message goes
through, the way the DNS token and the bucket are: the check is the same call the
real messages will make, so the first surprise is not the first crash.

**Discord.** In the channel's settings, Integrations, Webhooks, make a webhook
and copy its address. It looks like
`https://discord.com/api/webhooks/<id>/<token>`, and only an address of that shape,
on Discord's own hosts, is accepted. Messages arrive as an embed, coloured by how
serious it is, and cannot ping anybody: a server named `@everyone` is text.

**A webhook.** Anything that takes a `POST` of JSON: ntfy, Gotify, Home Assistant,
a script of your own. The messages are signed — [below](#what-a-webhook-receives)
— so a receiver can tell they are Geeboard's. The signing key is made when the
channel is, **shown once**, and cannot be shown again; *New key* replaces it.

The address is a secret. It is stored encrypted, the page shows only where it goes
(the host; for Discord, the webhook's id), and it is in no audit line, no API
response and no log. A channel can be turned off without deleting it, its events
changed at any time, and removed, which drops its waiting messages with it. Ten
channels is the most.

## Where a webhook may point

A webhook is an address a person types, and the panel calls it from inside its own
network — where the database, the agent on `127.0.0.1` and, on a VPS, the cloud's
metadata service answer. So the panel does not call whatever it is given:

| | Allowed |
| --- | --- |
| **Discord** | Only Discord's own webhook addresses, and whatever they resolve to has to be public |
| **A webhook** | `https` to a **public** address. A name is looked up by the panel, **every** address it gives has to be public, and the call goes to one of those addresses — not to a second lookup, which is how a name that answers differently the second time would walk round the check |
| **Never, in any setting** | This machine's own address, link-local addresses (`169.254.0.0/16`, where cloud metadata answers, and `fe80::/10`), and the unspecified, multicast and reserved ranges — in any spelling, including `127.1`, `2130706433`, `::ffff:127.0.0.1` and the addresses a NAT64 or 6to4 gateway would forward there |
| **Never followed** | A redirect. The answer is a failure that says so |

For ntfy or Home Assistant on your own network the person who runs the panel sets
one environment variable and restarts it:

```
GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1
```

It lets a webhook reach private networks (`10.x`, `172.16–31.x`, `192.168.x`,
`100.64–127.x`, unique-local IPv6) and, there only, use plain `http`. It is a
setting on the machine and not on the page, on purpose: whoever can type an
address into the page can then make the panel call anything on its network, and
that is a decision for the person who owns the machine. The page says whether it
is set. With the compose file it is a line in `deploy/panel/.env`.

What a failure says is a fixed phrase and the host's name — *hooks.example.com
refused the connection*, *answered HTTP 503* — never the address that was tried,
the path (which holds a token) or what the receiver replied.

## What a webhook receives

A `POST` with `Content-Type: application/json` and these headers:

| Header | |
| --- | --- |
| `X-Geeboard-Event` | The event, such as `server.crashed` |
| `X-Geeboard-Timestamp` | Seconds since 1970, when it was signed |
| `X-Geeboard-Signature` | `sha256=` and the hex HMAC-SHA256, with the channel's key, of the timestamp, a dot and the body exactly as sent |
| `User-Agent` | `Geeboard/<version>` |

The body:

```json
{
  "version": 1,
  "event": "server.crashed",
  "at": "2026-10-02T10:00:00.000Z",
  "tone": "warning",
  "title": "Aurora SMP crashed",
  "text": "Aurora SMP stopped without being asked on fra-node-02. The panel restarted it (1 of 3).",
  "server": { "name": "Aurora SMP", "slug": "aurora-smp" },
  "node": { "name": "fra-node-02" },
  "count": 1,
  "link": "https://panel.example.com/servers/aurora-smp",
  "details": { "Exit code": "1", "Restart": "1 of 3" }
}
```

`event` is one of `server.crashed`, `server.recovery.abandoned`, `server.left.stopped`,
`node.unreachable`, `node.recovered`, `backup.failed`, `backup.damaged`,
`server.update.available`, and `notifications.test` for the test message and
`notifications.suppressed` for the one that says some were held back. `tone` is
`danger`, `warning`, `success` or `info`. `server` and `node` are `null` where the
message is not about one; `count` is how many events a grouped message stands for;
`link` is `null` unless `PANEL_URL` is set. `version` is the number of the body's own shape, `1`.

This is a contract. **A release that is not a new major version may add fields to the
body, events to `event`, and entries to `details`; it will not rename or remove one, or
change what one means.** A receiver reads the fields it knows and ignores the rest, and
treats an `event` it does not know as one it has nothing to do for. `version` moves only
for a change that would break a receiver that follows that — there has not been one — and
a payload from a panel older than 0.9 has none: read it as `1`. The Discord body is
Discord's and is not versioned by the panel.

Checking the signature, which also rejects a captured request replayed later:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, headers, rawBody) {
  const timestamp = headers["x-geeboard-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const given = String(headers["x-geeboard-signature"]);
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

```python
import hashlib, hmac, time

def verify(secret: str, headers: dict, raw_body: str) -> bool:
    timestamp = headers["x-geeboard-timestamp"]
    if abs(time.time() - int(timestamp)) > 300:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), f"{timestamp}.{raw_body}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(headers["x-geeboard-signature"], expected)
```

A receiver that answers `2xx` has the message. Anything else is a failure, and the
body of the answer is not read beyond what it takes to know that.

## Delivery

A message is queued when the poller reads the row, and sent beside the poller's
pass, not in it: a receiver that takes five seconds to answer does not hold up the
watch on the servers. The poller reads the audit log a few seconds behind the
present so that a crash and its restart are read together, which is why a message
arrives up to about a pass (fifteen seconds) after the event.

Delivery is **at least once**. A failure that could pass — the receiver is down, a
`429`, a `5xx`, no answer in five seconds — is tried again after a minute, five
minutes and thirty, and then given up on. One that would not — a `404`, which for a
webhook usually means it was deleted; a `4xx`; an address the panel will not call —
is final at once. A message older than a day is not sent late. The page lists the
latest messages with their state and why, and a channel remembers its last
failure. Sent messages are kept for a week and ones given up on for a month.

Because it is at least once, a receiver that must not act twice should keep the
timestamp and signature of what it handled.

## What is not here

- No email, and no per-person notifications: a channel is the workspace's, set by
  an owner or admin. A member receives nothing.
- No answering from the chat. A message says what happened and links to the panel,
  which is where it is dealt with.
- It is not a monitoring system. The poller sees a node every fifteen seconds and
  decides a node is down after several minutes of silence; a message about a node
  that is down for a minute is not a thing it will send.
- Nothing is sent about a server that is not the panel's to know about: messages
  carry names and what happened, never a token, an agent's address, a file path or
  what a console printed.

Channels are owners' and admins' — the `notifications.manage` permission — and in
no API-key scope. The address and the signing key are encrypted with `SECRETS_KEY`
and covered by [`rekey`](security.md#changing-secrets_key).
