import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import {
  discordBody,
  escapeMarkdown,
  newSigningSecret,
  signatureMatches,
  signBody,
  webhookPayload,
  type NotificationMessage,
} from "../src/domain/notify/format.ts";
import { sendNotification, type Channel } from "../src/lib/notify/send.ts";

/* What goes out, and what the panel does with what comes back. The receiver
   is a stand-in on 127.0.0.1, which a webhook may never call, so these send
   with the one policy parameter that exists for tests. */

const MESSAGE: NotificationMessage = {
  kind: "server.crashed",
  at: "2026-10-02T10:00:00.000Z",
  tone: "danger",
  title: "Aurora SMP crashed",
  text: "Aurora SMP stopped with exit code 1 on fra-node-02 and was restarted (1 of 3).",
  server: { name: "Aurora SMP", slug: "aurora" },
  node: { name: "fra-node-02" },
  count: 1,
  link: "https://panel.example.com/servers/aurora",
  details: { "Exit code": "1", Restart: "1 of 3" },
};

const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-ABCDEFG";
const forTests = { allowPrivate: true, allowLoopback: true };

interface Got {
  method: string | undefined;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}
const got: Got[] = [];
let answer: { status: number; location?: string } = { status: 204 };
let PORT = 0;
const receiver = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    got.push({ method: req.method, url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
    res.writeHead(answer.status, answer.location ? { location: answer.location } : {});
    res.end(answer.status >= 400 ? "the receiver says: your secret is hunter2" : "");
  });
});
before(async () => {
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  PORT = (receiver.address() as AddressInfo).port;
});
after(() => {
  receiver.closeAllConnections();
  receiver.close();
});

const webhook = (secret: string | null = "gbwh_test-signing-secret"): Channel => ({ kind: "WEBHOOK", url: `http://127.0.0.1:${PORT}/in/${TOKEN}`, signingSecret: secret });

test("a webhook gets JSON, the event in a header, and a signature a receiver can check", async () => {
  got.length = 0;
  answer = { status: 204 };
  const result = await sendNotification(webhook(), MESSAGE, { policy: forTests, now: () => 1_790_000_000_000 });
  assert.deepEqual(result, { ok: true, status: 204 });
  assert.equal(got.length, 1);
  const sent = got[0]!;
  assert.equal(sent.method, "POST");
  assert.equal(sent.url, `/in/${TOKEN}`);
  assert.equal(sent.headers["content-type"], "application/json");
  assert.equal(sent.headers["x-geeboard-event"], "server.crashed");
  assert.equal(sent.headers["x-geeboard-timestamp"], "1790000000");
  assert.match(String(sent.headers["user-agent"]), /^Geeboard\//);
  assert.ok(signatureMatches("gbwh_test-signing-secret", 1_790_000_000, sent.body, String(sent.headers["x-geeboard-signature"])), "the signature checks out over the timestamp and the body as sent");
  assert.ok(!signatureMatches("another-secret", 1_790_000_000, sent.body, String(sent.headers["x-geeboard-signature"])));
  assert.ok(!signatureMatches("gbwh_test-signing-secret", 1_790_000_001, sent.body, String(sent.headers["x-geeboard-signature"])), "a different timestamp is a different message");
  assert.deepEqual(JSON.parse(sent.body), webhookPayload(MESSAGE));
});

test("a webhook with no signing key sends no signature", async () => {
  got.length = 0;
  await sendNotification(webhook(null), MESSAGE, { policy: forTests });
  assert.equal(got[0]!.headers["x-geeboard-signature"], undefined);
});

test("the JSON has the fields the documentation promises, and no more", () => {
  const payload = webhookPayload({ ...MESSAGE, server: null, node: undefined, count: undefined, link: undefined, details: undefined });
  assert.deepEqual(Object.keys(payload).sort(), ["at", "count", "details", "event", "link", "node", "server", "text", "title", "tone", "version"]);
  assert.equal(payload.version, 1, "the number of the body's own shape, which docs/notifications.md says moves only for a break");
  assert.deepEqual({ server: payload.server, node: payload.node, count: payload.count, link: payload.link, details: payload.details }, { server: null, node: null, count: 1, link: null, details: {} });
});

test("a signature is over the exact bytes, and a fresh key is long and unguessable", () => {
  assert.notEqual(signBody("k", 1, "{}"), signBody("k", 1, "{ }"));
  assert.match(signBody("k", 1, "{}"), /^sha256=[0-9a-f]{64}$/);
  const a = newSigningSecret();
  assert.match(a, /^gbwh_[0-9a-f]{64}$/);
  assert.notEqual(a, newSigningSecret());
});

test("a Discord message is an embed that cannot ping anybody or carry a link of the server's choosing", () => {
  const body = discordBody({ ...MESSAGE, title: "@everyone [click](https://evil.example) crashed", server: { name: "@everyone", slug: null } });
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  const embed = (body.embeds as Array<Record<string, unknown>>)[0]!;
  assert.equal(embed.color, 0xe5484d);
  assert.equal(embed.timestamp, MESSAGE.at);
  assert.equal(embed.url, MESSAGE.link);
  assert.ok(!/(^|[^\\])\[click\]\(/.test(String(embed.title)), String(embed.title));
  assert.ok(String(embed.title).includes("\\@everyone"));
  assert.deepEqual((embed.fields as Array<{ name: string }>).map((f) => f.name.replace(/\\/g, "")), ["Exit code", "Restart"]);
  assert.equal(escapeMarkdown("a_b*c`d"), "a\\_b\\*c\\`d");
});

test("Discord's limits are kept: nothing in an embed is longer than it allows", () => {
  const long = "x".repeat(10_000);
  const body = discordBody({ ...MESSAGE, title: long, text: long, details: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, long])) });
  const embed = (body.embeds as Array<Record<string, unknown>>)[0]!;
  assert.ok(String(embed.title).length <= 256);
  assert.ok(String(embed.description).length <= 4096);
  const fields = embed.fields as Array<{ name: string; value: string }>;
  assert.ok(fields.length <= 25 && fields.every((f) => f.value.length <= 1024 && f.name.length <= 256));
});

test("a Discord channel is sent to what it is, and the body is the embed", async () => {
  const calls: Array<{ url: string; body: string; headers: Record<string, string> | undefined }> = [];
  const channel: Channel = { kind: "DISCORD", url: `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`, signingSecret: null };
  const result = await sendNotification(channel, MESSAGE, {
    call: async (url, options) => {
      calls.push({ url: url.toString(), body: String(options.body), headers: options.headers });
      assert.deepEqual(options.judge(["162.159.135.232"]), { ok: true });
      assert.equal(options.judge(["10.0.0.5"]).ok, false, "whatever discord.com resolves to has to be public");
      return new Response(null, { status: 204 });
    },
  });
  assert.deepEqual(result, { ok: true, status: 204 });
  assert.equal(calls[0]!.url, channel.url);
  assert.deepEqual(JSON.parse(calls[0]!.body), discordBody(MESSAGE));
  assert.equal(calls[0]!.headers?.["x-geeboard-signature"], undefined, "Discord has no use for ours");
});

test("an address that is not allowed is refused without a call, and says why", async () => {
  let called = false;
  const refuse = async (channel: Channel, policy = { allowPrivate: false }) => {
    called = false;
    const result = await sendNotification(channel, MESSAGE, { policy, call: async () => ((called = true), new Response(null, { status: 204 })) });
    return result;
  };
  let r = await refuse({ kind: "WEBHOOK", url: "https://169.254.169.254/latest/meta-data/", signingSecret: null }, { allowPrivate: true });
  assert.ok(!r.ok && !r.retry && /may never call/.test(r.reason) && !called);
  r = await refuse({ kind: "WEBHOOK", url: "http://hooks.example.com/in", signingSecret: null });
  assert.ok(!r.ok && !r.retry && /https/.test(r.reason) && !called);
  r = await refuse({ kind: "DISCORD", url: "https://evil.example/api/webhooks/123456789012345678/" + TOKEN, signingSecret: null });
  assert.ok(!r.ok && !r.retry && /not a Discord webhook address/.test(r.reason) && !called);
});

test("a name that resolves somewhere it may not is refused, whatever the call would have done", async () => {
  const channel: Channel = { kind: "WEBHOOK", url: "https://hooks.example.test/in", signingSecret: null };
  const result = await sendNotification(channel, MESSAGE, { policy: { allowPrivate: false }, resolve: async () => ["203.0.113.9", "10.0.0.5"], timeoutMs: 500 });
  assert.ok(!result.ok && !result.retry && /private network address/.test(result.reason), JSON.stringify(result));
  assert.ok(!result.ok && !result.reason.includes("10.0.0.5"), "the address it resolved to is not repeated");
});

test("what the receiver answers decides whether trying again is worth it, and is never repeated", async () => {
  const cases: Array<[number, boolean, RegExp]> = [
    [200, true, /./],
    [429, false, /HTTP 429/],
    [500, false, /HTTP 500/],
    [503, false, /HTTP 503/],
    [404, false, /usually means it was deleted/],
    [401, false, /HTTP 401/],
    [400, false, /HTTP 400/],
  ];
  for (const [status, ok, reason] of cases) {
    answer = { status };
    const result = await sendNotification(webhook(), MESSAGE, { policy: forTests });
    assert.equal(result.ok, ok, String(status));
    if (!result.ok) {
      assert.match(result.reason, reason, String(status));
      assert.equal(result.retry, status === 429 || status >= 500, `retry for ${status}`);
      assert.ok(!result.reason.includes("hunter2") && !result.reason.includes(TOKEN), "nothing the receiver said, and not the token in the path");
    }
  }
});

test("a redirect is a failure that is not retried, and is not followed", async () => {
  got.length = 0;
  answer = { status: 302, location: "http://169.254.169.254/latest/meta-data/" };
  const result = await sendNotification(webhook(), MESSAGE, { policy: forTests });
  assert.ok(!result.ok && !result.retry && /redirect/.test(result.reason), JSON.stringify(result));
  assert.equal(got.length, 1);
});

test("a receiver that is down is a failure worth retrying, in a fixed phrase with no address in it", async () => {
  const dead = createServer();
  await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
  const deadPort = (dead.address() as AddressInfo).port;
  await new Promise((resolve) => dead.close(resolve));
  const result = await sendNotification({ kind: "WEBHOOK", url: `http://127.0.0.1:${deadPort}/in/${TOKEN}`, signingSecret: null }, MESSAGE, { policy: forTests });
  assert.ok(!result.ok && result.retry, JSON.stringify(result));
  // The host, as the person typed it, and a fixed phrase: not the port, not the path with its token.
  assert.ok(!result.ok && result.reason === "127.0.0.1 refused the connection.", JSON.stringify(result));
});
