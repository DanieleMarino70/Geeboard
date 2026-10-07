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
      // A field this receiver does not know is ignored: the panel adds fields without changing the version. A version it does not know is
      // a change the panel says would break a receiver like this one, so it is refused, and the panel reports it, instead of guessed at.
      if (body.version !== undefined && body.version !== 1) return reply(422);
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
