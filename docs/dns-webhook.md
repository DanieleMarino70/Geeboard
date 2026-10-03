# A DNS webhook

Cloudflare and DuckDNS are the two DNS providers the panel can talk to itself. For
any other DNS — BIND, Knot, PowerDNS, a router, a host with an API of its own — there
is a third kind: **a webhook**. The panel does not write the records. It tells a small
receiver, which you run, what should be set and what should be removed, and the receiver
does the writing with whatever it has. One piece of code on your side covers a DNS the
panel will never have a client for.

What the panel promises is narrower than with the other two, and this page says where.
A record there is **accepted** by the receiver, not *written*: a `2xx` says the receiver
will act, and the panel cannot look at your DNS to see that it did.

## Setting it up

In this order, because the receiver has to hold the secret before the panel's first
call is signed with it.

1. **Make the secret.** On the DNS page, choose *Webhook* and press *Make one*. The
   panel makes a signing secret, shows it in the form, and stores it nowhere yet.
2. **Give it to the receiver**, and start the receiver. The [reference one](#a-receiver-that-runs-nsupdate)
   below takes it as `GEEBOARD_SECRET`.
3. **Give the panel the address and the zone.** The address is where the receiver
   listens; the zone is the domain it writes in, like `example.com`. Press *Test and
   save*. The panel sends a signed `dns.test`, and **saves nothing unless the receiver
   answers it `2xx`** — which proves the address and the secret together.
4. **Create a server** whose address is under the zone, or change an existing one's
   address in its Settings. Its records are sent as it is saved.

Once saved, the secret and the address are stored encrypted, and **neither is shown
again**: not on the page, not in the audit log, not in the API. The page says the
receiver's host and nothing of its path, which may hold a secret of its own. To change
either, press *Replace* and do the steps again. `rekey` seals both with the new key
([security.md](security.md#changing-secrets_key)).

The address has the rules of a [notification webhook](notifications.md#setting-a-channel-up):
`https`, to a public address, unless the person who runs the panel has set
`GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1` on the machine, which also allows plain `http` to a
private network — the usual place for a receiver on a home server's own LAN. The machine
itself, link-local addresses and the ranges that mean nothing are never allowed. There is
no setting of its own for this: it is the same one.

## What the receiver is sent

A `POST` with `Content-Type: application/json` and these headers:

| Header | |
| --- | --- |
| `X-Geeboard-Event` | `dns.test`, `dns.set` or `dns.remove` |
| `X-Geeboard-Timestamp` | Seconds since 1970, when it was signed |
| `X-Geeboard-Signature` | `sha256=` and the hex HMAC-SHA256, with the secret, of the timestamp, a dot and the body exactly as sent — the same as a [notification's](notifications.md#what-a-webhook-receives), and checked the same way |
| `X-Geeboard-Delivery` | An identifier made of what is asked and not of when: the same record sent again has the same one |
| `User-Agent` | `Geeboard/<version>` |

**A receiver checks the signature and the timestamp, and refuses what it cannot verify.**
It is all that stands between the Internet and your DNS. A request more than five minutes
old is refused too, which is what stops a captured one being replayed. The
[notifications page](notifications.md#what-a-webhook-receives) has the check in Node and
in Python.

### `dns.set`

The whole record that should be there.

```json
{
  "event": "dns.set",
  "zone": "example.com",
  "record": {
    "type": "SRV",
    "name": "_minecraft._tcp.aurora.example.com",
    "content": "0 5 25568 aurora.example.com",
    "ttl": 60,
    "comment": "geeboard:cmgq3h0f20001abc",
    "srv": { "priority": 0, "weight": 5, "port": 25568, "target": "aurora.example.com" }
  },
  "sentAt": "2026-10-04T10:00:00.000Z"
}
```

`type` is `A`, `AAAA` or `SRV`. For an `A` or an `AAAA`, `content` is the address and
there is no `srv`. For an `SRV`, `content` is `priority weight port target` and `srv` has
the same four fields, so that a receiver need not split a string. `comment` is what the
panel marks its own records with — `geeboard:` and the server's id — for a receiver that
keeps records of other people's and wants to tell these apart. DNS has no place for it;
keep it where you keep such things, or ignore it.

**Setting is replacing.** A record is identified by its type and its name: there is one
of each at a name, and a `dns.set` makes it say this. The same request twice leaves the
same DNS, which is what makes a retry safe.

### `dns.remove`

```json
{ "event": "dns.remove", "zone": "example.com", "record": { "type": "A", "name": "aurora.example.com" }, "sentAt": "2026-10-04T10:00:00.000Z" }
```

Whatever is of that type at that name goes. **Removing what is not there is removed**: a
receiver may answer `204`, or `404` or `410`, and the panel counts all of them as done.

### `dns.test`

```json
{ "event": "dns.test", "zone": "example.com", "sentAt": "2026-10-04T10:00:00.000Z" }
```

Sent when the webhook is saved and when *Check* is pressed. Answer `2xx` and change
nothing.

## What the panel makes of the answer

Only the status counts. The body of an answer is not read and not kept, because it is the
one thing in the exchange that somebody else wrote; a failure on the page says the status
and the receiver's host, never its words.

| The receiver answers | The panel |
| --- | --- |
| `2xx` | The record is **accepted** |
| `404` or `410` to a `dns.remove` | The record is gone |
| `401` or `403` | The secret does not match. Saving is refused; a record already kept shows *not taken* with that reason |
| `408`, `429`, `5xx`, no answer in five seconds, or no connection | It could not be taken just now. The panel tries again in five minutes |
| any other `4xx`, such as `422` | The receiver refuses **that record**. A receiver that keeps no SRV records may answer `422` to them: the server's address is accepted, the SRV is *not taken*, and the page does not say players need only the name |
| a redirect | A failure. The panel never follows one |

The panel sends **what changed** and not everything again: a node that moved sends the
`A` and not the `SRV`; a server that took another port sends the `SRV` and not the `A`.
*Retry now*, on the DNS page, is the one thing that sends every record of a server again.

## What the panel does not do

- **It does not read.** There is nothing in this contract that asks the receiver what is
  at a name. So the panel cannot tell a record somebody else made from its own, and
  cannot refuse to overwrite one: **that protection is the receiver's**, which is why it
  is sent the marker. A record removed by hand at the DNS is not noticed either — the
  panel sends a record when it changes, not on a timer.
- **It does not wait for a receiver that is not there.** Creating, moving and deleting a
  server wait for this call, so it has a timeout of five seconds. A receiver that does not
  answer is waited for once in a pass of the poller and not once for every server: the
  rest are left for the next try, and the poller does not ask again for five minutes.
  Measured with a receiver that never answers: a pass over six servers took 5.1 seconds.
  A server is created, moved and deleted all the same; the failure is on its page and in
  the audit log.
- **It does not send a name outside the zone.** A server whose address is not under the
  zone is not the panel's to keep, as with the other providers.
- **It does not remove records when the provider is removed.** As with Cloudflare and
  DuckDNS: they stay where they are, and are yours.

## A receiver that runs nsupdate

`nsupdate` (RFC 2136) is how BIND, Knot and PowerDNS take a change, so a receiver that
runs it covers all three. This one is [`examples/dns-webhook/receiver.mjs`](https://github.com/DanieleMarino70/Geeboard/blob/main/examples/dns-webhook/receiver.mjs)
in the repository, about a hundred lines, with no dependencies and Node 20 or later. It
checks the signature and the timestamp, refuses a name outside its zone and a content that
is not what its type says, and turns a `dns.set` into a delete and an add in one update.

```js
#!/usr/bin/env node
/* A receiver for Geeboard's DNS webhook: it checks that a request is the panel's, and changes DNS with nsupdate (RFC 2136),
   which BIND, Knot and PowerDNS all take. No dependencies; Node 20 or later.

     GEEBOARD_SECRET  the signing secret the panel made          (required)
     ZONE             the zone you gave the panel, example.com   (required)
     NSUPDATE         the command that runs nsupdate, with its key, e.g. "nsupdate -k /etc/bind/ddns.key"
     DNS_SERVER       the server to update                        (default 127.0.0.1)
     HOST, PORT       where to listen                             (default 0.0.0.0, 8787)

   docs/dns-webhook.md says what each request means. */
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";

const SECRET = process.env.GEEBOARD_SECRET ?? "";
const ZONE = (process.env.ZONE ?? "").toLowerCase().replace(/\.$/, "");
const SERVER = process.env.DNS_SERVER ?? "127.0.0.1";
const [COMMAND, ...ARGS] = (process.env.NSUPDATE ?? "nsupdate").split(" ");
if (!SECRET || !ZONE) {
  console.error("Set GEEBOARD_SECRET and ZONE.");
  process.exit(1);
}

/* The panel signs "<timestamp>.<body>" with the secret. A request that does not verify, or is more than five minutes old,
   is nobody's: it is refused and nothing is done with it. */
function signedByThePanel(raw, headers) {
  const timestamp = Number(headers["x-geeboard-timestamp"]);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = "sha256=" + createHmac("sha256", SECRET).update(`${timestamp}.${raw}`).digest("hex");
  const given = String(headers["x-geeboard-signature"] ?? "");
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const NAME = /^[a-z0-9_]([a-z0-9_.-]*[a-z0-9])?$/;
const CONTENT = {
  A: /^\d{1,3}(\.\d{1,3}){3}$/,
  AAAA: /^[0-9a-f:]+$/i,
  SRV: /^\d+ \d+ \d+ [a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i,
};
const fqdn = (name) => (name.endsWith(".") ? name : `${name}.`);

class Refused extends Error {}

/* What to tell the name server. A set is a delete and an add in one update, so it replaces what was there and can be said
   twice; a remove is the delete alone, and is fine when there is nothing to delete. */
function update(body) {
  const { type, name, content, ttl } = body.record;
  if (!(type in CONTENT) || !NAME.test(name)) throw new Refused("not a record this receiver keeps");
  if (name !== ZONE && !name.endsWith(`.${ZONE}`)) throw new Refused("outside the zone");
  const lines = [`server ${SERVER}`, `zone ${ZONE}`, `update delete ${fqdn(name)} ${type}`];
  if (body.event === "dns.set") {
    if (!CONTENT[type].test(content)) throw new Refused("not content for that type");
    const text = type === "SRV" ? content.replace(/ ([^ ]+)$/, (_, target) => ` ${fqdn(target)}`) : content;
    lines.push(`update add ${fqdn(name)} ${Number(ttl) || 60} ${type} ${text}`);
  }
  return [...lines, "send", ""].join("\n");
}

const run = (input) =>
  new Promise((resolve, reject) => {
    const child = spawn(COMMAND, ARGS, { stdio: ["pipe", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`nsupdate exited ${code}`))));
    child.stdin.end(input);
  });

createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 16_384) req.destroy();
  });
  req.on("end", async () => {
    const reply = (status) => (res.writeHead(status), res.end());
    if (req.method !== "POST" || !signedByThePanel(raw, req.headers)) return reply(401);
    try {
      const body = JSON.parse(raw);
      console.log(`${new Date().toISOString()} ${body.event} ${body.record?.type ?? ""} ${body.record?.name ?? ""} ${req.headers["x-geeboard-delivery"]}`);
      if (body.zone !== ZONE) return reply(422);
      if (body.event === "dns.test") return reply(204);
      if (body.event !== "dns.set" && body.event !== "dns.remove") return reply(422);
      await run(update(body));
      reply(204);
    } catch (error) {
      console.error(String(error instanceof Error ? error.message : error));
      reply(error instanceof Refused ? 422 : 502);
    }
  });
}).listen(Number(process.env.PORT ?? 8787), process.env.HOST ?? "0.0.0.0", () => console.log(`receiver for ${ZONE} on port ${process.env.PORT ?? 8787}`));
```

It is run with the secret, the zone and the command that runs `nsupdate` with its key:

```sh
GEEBOARD_SECRET=gbwh_… ZONE=example.com \
NSUPDATE="nsupdate -k /etc/bind/ddns.key" node receiver.mjs
```

and the zone has to take updates signed with that key. In BIND:

```
key "ddns" { algorithm hmac-sha256; secret "…"; };            # tsig-keygen ddns
zone "example.com" { type primary; file "…"; allow-update { key "ddns"; }; };
```

It was run against BIND 9.20 in a container, with the panel creating a Minecraft: Java
server: `dig` answered the `A`, the `AAAA` and the `SRV` at `_minecraft._tcp` with the
server's port; a change of port changed only the `SRV`; deleting the server removed all
three; and a request with a wrong signature changed nothing. See the
[roadmap](roadmap.md#a-dns-webhook-and-s3-proved-080).
