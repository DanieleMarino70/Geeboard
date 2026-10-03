import "./load-env.mts";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { networkInterfaces } from "node:os";
import type { AddressInfo } from "node:net";
import process from "node:process";

/* Notifications, from the audit log to a receiver.

   The dispatcher reads rows the panel already writes, so these rows are
   written here as the poller writes them (the shapes were measured: see
   .claude/prompts/0.5.0-parte-0-nota.md) and the real dispatcher, the real
   delivery and the real call do the rest. The receiver is a stand-in on
   127.0.0.1, which a webhook may never call; the delivery is given the one
   policy parameter that exists for tests. Discord's own address cannot be
   stood in for, so a Discord channel is delivered through a stub that is
   handed exactly what the real call would have been. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
const { encryptSecret, decryptSecret } = await import("../src/lib/secrets");
const { dispatchNotifications, deliverPending, recordUpdatesAvailable, sweepDeliveries } = await import("../src/lib/notify/ops");
const { sendNotification } = await import("../src/lib/notify/send");
const { signatureMatches, discordBody } = await import("../src/domain/notify/format");
const { ALL_KINDS, AUDIT_ACTIONS_READ } = await import("../src/domain/notify/events");
const channelOps = await import("../src/lib/notify/channel-ops");

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} ${detail}`);
  }
};

interface Got {
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}
const got: Got[] = [];
let answer = 204;
const receiver = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    got.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
    res.writeHead(answer);
    res.end(answer >= 400 ? "the receiver says: the secret is hunter2" : "");
  });
});
await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
const PORT = (receiver.address() as AddressInfo).port;

const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-ABCDEFG";
const DISCORD_URL = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`;
const HOOK_URL = `http://127.0.0.1:${PORT}/in/${TOKEN}`;
const KEY = "gbwh_verify-signing-secret-0123456789";
const forTests = { allowPrivate: true, allowLoopback: true };

const discordSeen: Array<{ url: string; body: Record<string, unknown> }> = [];
const send: NonNullable<Parameters<typeof deliverPending>[1]>["send"] = async (channel, message, options) => {
  if (channel.kind === "DISCORD") {
    const result = await sendNotification(channel, message, {
      ...options,
      call: async (url, o) => {
        discordSeen.push({ url: url.toString(), body: JSON.parse(String(o.body)) });
        return new Response(null, { status: 204 });
      },
    });
    return result;
  }
  return sendNotification(channel, message, { ...options, policy: forTests });
};

let clock = new Date();
const at = (seconds: number) => new Date(clock.getTime() + seconds * 1000);
const advance = (seconds: number) => {
  clock = at(seconds);
  return clock;
};

async function row(action: string, over: { actor?: string; target?: string; server?: string; changes?: object; at?: Date } = {}) {
  const server = over.server ? await db.server.findUniqueOrThrow({ where: { slug: over.server } }) : null;
  return db.activityEvent.create({
    data: {
      actor: over.actor ?? "Watchdog",
      action,
      target: over.target ?? server?.name ?? null,
      tone: "INFO",
      serverId: server?.id ?? null,
      createdAt: over.at ?? at(1),
      changes: (over.changes ?? { State: { from: "RUNNING", to: "CRASHED" } }) as never,
    },
  });
}
const deliveries = () => db.notificationDelivery.findMany({ orderBy: { createdAt: "asc" }, include: { channel: { select: { name: true } } } });
const dispatch = async (secondsLater = 10) => dispatchNotifications(advance(secondsLater), { panelUrl: "https://panel.example.com" });

try {
  await seed();
  await db.notificationDelivery.deleteMany();
  await db.notificationChannel.deleteMany();
  await db.notificationCursor.deleteMany();
  const aurora = await db.server.findUniqueOrThrow({ where: { slug: "aurora" }, include: { node: true } });
  const slugs = (await db.server.findMany({ select: { slug: true }, orderBy: { slug: "asc" } })).map((s) => s.slug);

  console.log("\n== with no channel, nothing is called and nothing is queued ==");
  let r = await dispatch(0);
  check("the first look starts from here, and reads nothing", r.read === 0 && r.queued === 0);
  const cursorAtStart = await db.notificationCursor.findUnique({ where: { id: "events" } });
  check("a cursor was made", cursorAtStart !== null);
  await row("server.crashed", { server: "aurora" });
  r = await dispatch();
  check("a crash is read, and there is nobody to tell", r.read === 1 && r.messages === 0 && r.queued === 0, JSON.stringify(r));
  check("no delivery was made", (await db.notificationDelivery.count()) === 0);
  check("and the cursor moved past it, so a channel made later is not told about it", (await db.notificationCursor.findUniqueOrThrow({ where: { id: "events" } })).lastEventAt > cursorAtStart!.lastEventAt);

  console.log("\n== channels ==");
  const sealed = (u: string) => encryptSecret(u);
  const hook = await db.notificationChannel.create({ data: { name: "ops-webhook", kind: "WEBHOOK", url: sealed(HOOK_URL), signingSecret: sealed(KEY), events: [...ALL_KINDS] } });
  const crew = await db.notificationChannel.create({ data: { name: "crew-discord", kind: "DISCORD", url: sealed(DISCORD_URL), events: ["server.crashed"] } });
  await db.notificationChannel.create({ data: { name: "nodes-webhook", kind: "WEBHOOK", url: sealed(`${HOOK_URL}/nodes`), events: ["node.unreachable", "node.recovered"] } });
  await db.notificationChannel.create({ data: { name: "off-webhook", kind: "WEBHOOK", url: sealed(`${HOOK_URL}/off`), events: [...ALL_KINDS], enabled: false } });
  check("the address and the key are stored sealed", !JSON.stringify([hook, crew]).includes(TOKEN) && !JSON.stringify(hook).includes(KEY));

  console.log("\n== a crash the panel put right: two rows, one message, to the channels that asked ==");
  await row("server.crashed", { server: "aurora", at: at(1) });
  await row("server.recovered", { server: "aurora", at: at(1.1), changes: { Attempt: { from: "-", to: "1 of 3" } } });
  r = await dispatch();
  check("two rows were read and made one message", r.read === 2 && r.messages === 1, JSON.stringify(r));
  const queued = await deliveries();
  check("queued for the webhook and the Discord channel, not for the node-only one or the one that is off", queued.map((d) => d.channel.name).sort().join(",") === "crew-discord,ops-webhook", queued.map((d) => d.channel.name).join(","));
  const first = queued.find((d) => d.channel.name === "ops-webhook")!;
  const payload = first.payload as { kind: string; title: string; text: string; link: string | null; details?: Record<string, string> };
  check("it says the server was restarted, and links to its page", payload.kind === "server.crashed" && /restarted it \(1 of 3\)/.test(payload.text) && payload.link === `https://panel.example.com/servers/${aurora.slug}`, JSON.stringify(payload));
  check("and holds no address, token or path", !JSON.stringify(payload).includes(TOKEN) && !JSON.stringify(payload).includes(aurora.node.daemonUrl ?? "never"));

  console.log("\n== delivery ==");
  got.length = 0;
  let d = await deliverPending(clock, { send });
  check("both were sent", d.attempted === 2 && d.sent === 2, JSON.stringify(d));
  check("the webhook got one signed POST with the event in a header", got.length === 1 && got[0]!.path === `/in/${TOKEN}` && got[0]!.headers["x-geeboard-event"] === "server.crashed");
  check("the signature checks out with the channel's own key", signatureMatches(KEY, Number(got[0]!.headers["x-geeboard-timestamp"]), got[0]!.body, String(got[0]!.headers["x-geeboard-signature"])));
  check("Discord was handed the embed, to its own address", discordSeen.length === 1 && discordSeen[0]!.url === DISCORD_URL && JSON.stringify(discordSeen[0]!.body) === JSON.stringify(discordBody(first.payload as never)));
  const sent = await deliveries();
  check("the rows say sent, once", sent.every((x) => x.state === "SENT" && x.attempts === 1 && x.sentAt !== null));
  check("the channel remembers the last good one", (await db.notificationChannel.findUniqueOrThrow({ where: { id: hook.id } })).lastOkAt !== null);
  got.length = 0;
  d = await deliverPending(advance(5), { send });
  r = await dispatch();
  check("nothing is sent twice, and nothing is read again", d.attempted === 0 && r.read === 0 && got.length === 0);

  console.log("\n== a host that restarted: every server down in one pass is one message ==");
  for (const slug of slugs) await row("server.crashed", { server: slug });
  r = await dispatch();
  check(`${slugs.length} crashes made one message`, r.read === slugs.length && r.messages === 1, JSON.stringify(r));
  const grouped = (await deliveries()).filter((x) => x.state === "PENDING");
  check("queued for the two channels that want crashes", grouped.length === 2);
  check("and it counts them", (grouped[0]!.payload as { count: number; title: string }).count === slugs.length && /servers crashed/.test((grouped[0]!.payload as { title: string }).title), JSON.stringify(grouped[0]!.payload));
  await deliverPending(advance(1), { send });

  console.log("\n== a node, and a backup that failed because of it ==");
  await row("node.unreachable", { target: aurora.node.name, changes: { State: { from: "HEALTHY", to: "UNREACHABLE" } } });
  await row("backup.failed", { server: "aurora", target: "auto-10-02", actor: "Scheduler", changes: { Reason: { from: "-", to: `${aurora.node.name} is unreachable` } } });
  r = await dispatch();
  check("the node is the news; the backup it broke is not a second message", r.messages === 1, JSON.stringify(r));
  got.length = 0;
  await deliverPending(advance(1), { send });
  const toNodes = got.filter((g) => g.path.endsWith("/nodes"));
  const toHook = got.filter((g) => g.path === `/in/${TOKEN}`);
  check("the node-only channel got it, and the all-events one", toNodes.length === 1 && toHook.length === 1);
  check("and it is the node message", JSON.parse(toNodes[0]!.body).event === "node.unreachable" && !JSON.parse(toNodes[0]!.body).text.includes("/"), toNodes[0]?.body);

  console.log("\n== a backup that failed for its own reason ==");
  await row("backup.failed", { server: "aurora", target: "manual-10-02", actor: "Mara Kessler", changes: { Reason: { from: "-", to: "There is not enough free space under /var/lib/geeboard/servers/abc for the archive." } } });
  await dispatch();
  got.length = 0;
  await deliverPending(advance(1), { send });
  const backup = got.find((g) => JSON.parse(g.body).event === "backup.failed");
  check("it reaches the channel that wants backups, with the reason and without the path", Boolean(backup) && /not enough free space/.test(JSON.parse(backup!.body).text) && !JSON.parse(backup!.body).text.includes("/var/lib"), backup?.body);
  check("and not the Discord channel, which only asked for crashes", discordSeen.length === 2);

  console.log("\n== a receiver that is down: tried again after a minute, five, thirty, then given up on ==");
  await row("node.recovered", { target: aurora.node.name, changes: { State: { from: "UNREACHABLE", to: "HEALTHY" } } });
  await dispatch();
  answer = 503;
  got.length = 0;
  const t0 = clock;
  await deliverPending(clock, { send });
  let pending = (await deliveries()).filter((x) => x.kind === "node.recovered" && x.channel.name === "ops-webhook")[0]!;
  check("a 503 is kept to try again, a minute on", pending.state === "PENDING" && pending.attempts === 1 && Math.abs(pending.nextAttemptAt.getTime() - (t0.getTime() + 60_000)) < 1000, `${pending.state} ${pending.attempts} ${pending.nextAttemptAt.toISOString()}`);
  check("the reason is the status and the host, never what the receiver said, and never the token", /HTTP 503/.test(pending.lastError ?? "") && !(pending.lastError ?? "").includes("hunter2") && !(pending.lastError ?? "").includes(TOKEN), String(pending.lastError));
  check("the channel keeps it for the page to show", /HTTP 503/.test((await db.notificationChannel.findUniqueOrThrow({ where: { id: hook.id } })).lastError ?? ""));
  const before = got.length;
  await deliverPending(at(30), { send });
  check("it is not tried before its time", got.length === before);
  for (const minutes of [1.1, 5.1, 30.1]) await deliverPending(advance(minutes * 60), { send });
  pending = (await deliveries()).filter((x) => x.kind === "node.recovered" && x.channel.name === "ops-webhook")[0]!;
  check("after the last retry it is given up on, with the reason", pending.state === "FAILED" && pending.attempts === 4 && /HTTP 503/.test(pending.lastError ?? ""), `${pending.state} ${pending.attempts}`);
  answer = 204;

  console.log("\n== a webhook that was deleted is not retried ==");
  await row("node.unreachable", { target: aurora.node.name });
  await dispatch();
  answer = 404;
  await deliverPending(clock, { send });
  const gone = (await deliveries()).filter((x) => x.kind === "node.unreachable").pop()!;
  check("404 is final, and says it was probably deleted", gone.state === "FAILED" && gone.attempts === 1 && /deleted/.test(gone.lastError ?? ""), `${gone.state} ${gone.attempts} ${gone.lastError}`);
  answer = 204;

  console.log("\n== a channel whose key was changed without rekey ==");
  const broken = await db.notificationChannel.create({ data: { name: "broken", kind: "WEBHOOK", url: "v1.aaaa.bbbb.cccc", events: ["node.recovered"] } });
  await row("node.recovered", { target: aurora.node.name });
  await dispatch();
  await deliverPending(clock, { send });
  const unreadable = (await deliveries()).filter((x) => x.channel.name === "broken")[0]!;
  check("it fails at once, naming rekey, and does not retry", unreadable.state === "FAILED" && /rekey/.test(unreadable.lastError ?? "") && unreadable.attempts === 1, `${unreadable.state} ${unreadable.lastError}`);
  await db.notificationChannel.delete({ where: { id: broken.id } });

  console.log("\n== a storm is held to ten messages a minute, with one notice ==");
  await db.notificationChannel.updateMany({ where: { name: { not: "ops-webhook" } }, data: { enabled: false } });
  await db.notificationDelivery.deleteMany();
  const startOfMinute = clock;
  for (let i = 0; i < 14; i++) {
    await row("backup.failed", { server: "aurora", target: `auto-${i}`, at: new Date(startOfMinute.getTime() + 100 + i * 10) , changes: { Reason: { from: "-", to: `The archive could not be written (${i}).` } } });
    clock = new Date(startOfMinute.getTime() + 6_000 + i * 1000);
    await dispatchNotifications(clock, { panelUrl: null, settleMs: 0 });
  }
  const storm = await db.notificationDelivery.findMany({ where: { channel: { name: "ops-webhook" } } });
  const notices = storm.filter((x) => x.kind === "notifications.suppressed");
  check("ten messages and one notice were queued, not fourteen", storm.length === 11 && notices.length === 1, `${storm.length} queued, ${notices.length} notices`);
  check("the notice says how many were held back", /not sent/.test((notices[0]!.payload as { title: string }).title));

  console.log("\n== rows that are a day old are not news ==");
  await db.notificationDelivery.deleteMany();
  await db.activityEvent.deleteMany({ where: { action: { in: [...AUDIT_ACTIONS_READ] } } });
  await db.notificationChannel.update({ where: { id: hook.id }, data: { enabled: true } });
  await db.notificationCursor.update({ where: { id: "events" }, data: { lastEventAt: new Date(clock.getTime() - 3 * 24 * 3600_000), lastEventId: null } });
  await row("node.unreachable", { target: aurora.node.name, at: new Date(clock.getTime() - 2 * 24 * 3600_000) });
  const stale = await dispatchNotifications(advance(600), { panelUrl: null });
  check("read, and not announced", stale.read >= 1 && stale.messages === 0 && (await db.notificationDelivery.count()) === 0, JSON.stringify(stale));

  console.log("\n== an update is written once, for the server and the version ==");
  const game = await db.game.findUniqueOrThrow({ where: { id: aurora.gameId! } });
  const versions = await db.gameVersion.findMany({ where: { gameId: game.id }, orderBy: { releasedAt: "asc" } });
  const old = versions.find((v) => v.supported !== false) ?? versions[0]!;
  await db.server.update({ where: { id: aurora.id }, data: { gameVersionId: old.id, updateNotifiedKey: null } });
  const wrote = await recordUpdatesAvailable();
  const asked = await db.activityEvent.findMany({ where: { action: "server.update.available", serverId: aurora.id } });
  check("an old version is announced", wrote >= 1 && asked.length === 1 && asked[0]!.actor === "Catalog", `${wrote} ${asked.length}`);
  check("with what it moves from and to", JSON.stringify(asked[0]!.changes).includes("Update"));
  check("and the server remembers it was told", (await db.server.findUniqueOrThrow({ where: { id: aurora.id } })).updateNotifiedKey !== null);
  check("a second look says nothing more", (await recordUpdatesAvailable()) === 0 && (await db.activityEvent.count({ where: { action: "server.update.available", serverId: aurora.id } })) === 1);
  await db.server.update({ where: { id: aurora.id }, data: { updateNotifiedKey: "left-over" } });
  const newest = versions.filter((v) => v.supported !== false).pop() ?? versions[versions.length - 1]!;
  await db.server.update({ where: { id: aurora.id }, data: { gameVersionId: newest.id } });
  await recordUpdatesAvailable();
  check("brought up to date, the key is cleared, so the next update is news", (await db.server.findUniqueOrThrow({ where: { id: aurora.id } })).updateNotifiedKey === null);

  console.log("\n== old deliveries go ==");
  await db.notificationDelivery.deleteMany();
  const channel = await db.notificationChannel.findFirstOrThrow();
  const mk = (state: "SENT" | "FAILED", days: number) =>
    db.notificationDelivery.create({ data: { channelId: channel.id, kind: "node.recovered", payload: {}, state, createdAt: new Date(clock.getTime() - days * 24 * 3600_000) } });
  await mk("SENT", 8);
  await mk("SENT", 2);
  await mk("FAILED", 20);
  await mk("FAILED", 40);
  await db.notificationDelivery.create({ data: { channelId: channel.id, kind: "node.recovered", payload: {}, state: "PENDING", createdAt: new Date(clock.getTime() - 50 * 24 * 3600_000) } });
  const swept = await sweepDeliveries(clock);
  check("a week for what was sent, a month for what was given up on, and what is waiting is never swept", swept === 2 && (await db.notificationDelivery.count()) === 3, `${swept} swept, ${await db.notificationDelivery.count()} left`);

  console.log("\n== nothing a person pasted is anywhere it should not be ==");
  const everything = JSON.stringify([await db.notificationDelivery.findMany(), await db.activityEvent.findMany(), await db.notificationChannel.findMany()]);
  check("the webhook's path and token are in no delivery, no audit row, and the channels hold them sealed", !everything.includes(TOKEN) && !everything.includes(KEY));
  check("and open with the key the panel holds", decryptSecret((await db.notificationChannel.findUniqueOrThrow({ where: { id: hook.id } })).url) === HOOK_URL);

  console.log("\n== the page's operations: who may, and what is saved ==");
  await db.notificationDelivery.deleteMany();
  await db.notificationChannel.deleteMany();
  await db.activityEvent.deleteMany({ where: { action: { startsWith: "notifications." } } });
  const owner = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });
  const member = await db.user.findFirstOrThrow({ where: { role: "MODERATOR" } });
  const all = (await channelOps.notificationsView()).choices.map((c) => c.id);
  const deps = { policy: forTests };

  const nope = await channelOps.createChannelOp(member, { name: "mine", kind: "WEBHOOK", url: HOOK_URL, choices: all }, deps);
  check("a member may not add a channel", !nope.ok && nope.title === "Not permitted" && (await db.notificationChannel.count()) === 0);

  const strict = { policy: { allowPrivate: false } };
  for (const url of ["http://169.254.169.254/latest/meta-data/", "https://10.0.0.5/hook", "http://hooks.example.com/in", "https://user:pw@hooks.example.com/in"]) {
    const r = await channelOps.createChannelOp(owner, { name: "refused", kind: "WEBHOOK", url, choices: all }, strict);
    check(`${url.replace(/:\/\/.*@/, "://...@")}: refused, with the reason, nothing saved`, !r.ok && r.title === "That address cannot be used", JSON.stringify(r));
  }
  const notDiscord = await channelOps.createChannelOp(owner, { name: "refused", kind: "DISCORD", url: "https://evil.example/api/webhooks/123456789012345678/" + TOKEN, choices: all }, strict);
  check("an address that is not Discord's is refused as a Discord channel", !notDiscord.ok && /not a Discord webhook address/.test(notDiscord.body));
  check("nothing was saved by any of them", (await db.notificationChannel.count()) === 0);
  const mistakes = [
    await channelOps.createChannelOp(owner, { name: "x", kind: "WEBHOOK", url: HOOK_URL, choices: all }, deps),
    await channelOps.createChannelOp(owner, { name: "ok name", kind: "FAX", url: HOOK_URL, choices: all }, deps),
    await channelOps.createChannelOp(owner, { name: "ok name", kind: "WEBHOOK", url: HOOK_URL, choices: [] }, deps),
    await channelOps.createChannelOp(owner, { name: "ok name", kind: "WEBHOOK", url: HOOK_URL, choices: ["made-up"] }, deps),
  ];
  check("and the form's own mistakes are named", mistakes.every((r) => !r.ok && r.title === "Check the form"), JSON.stringify(mistakes));

  console.log("\n== a webhook is tested before it is saved, and signed with a key shown once ==");
  got.length = 0;
  answer = 500;
  const bad = await channelOps.createChannelOp(owner, { name: "ops", kind: "WEBHOOK", url: HOOK_URL, choices: all }, deps);
  check("a receiver that refuses the test is not saved", !bad.ok && bad.title === "The test message did not go through" && /HTTP 500/.test(bad.body) && (await db.notificationChannel.count()) === 0, JSON.stringify(bad));
  check("and nothing it said, nor the token, comes back", !JSON.stringify(bad).includes("hunter2") && !JSON.stringify(bad).includes(TOKEN));
  answer = 204;
  got.length = 0;
  const added = await channelOps.createChannelOp(owner, { name: "ops", kind: "WEBHOOK", url: HOOK_URL, choices: all }, deps);
  check("it is added once the test goes through", added.ok && /^gbwh_/.test(added.secret ?? ""), JSON.stringify(added));
  check("the test message was a real signed POST, to the path it was given", got.length === 1 && got[0]!.path === `/in/${TOKEN}` && got[0]!.headers["x-geeboard-event"] === "notifications.test");
  check("signed with the very key it was handed", signatureMatches(added.secret!, Number(got[0]!.headers["x-geeboard-timestamp"]), got[0]!.body, String(got[0]!.headers["x-geeboard-signature"])));
  const saved = await db.notificationChannel.findFirstOrThrow({ where: { name: "ops" } });
  check("stored sealed, and opening to what was typed", !saved.url.includes(TOKEN) && decryptSecret(saved.url) === HOOK_URL && decryptSecret(saved.signingSecret!) === added.secret);
  check("with the events that were ticked, and the channel marked as having worked", saved.events.length === ALL_KINDS.length && saved.lastOkAt !== null);
  const dup = await channelOps.createChannelOp(owner, { name: "ops", kind: "WEBHOOK", url: HOOK_URL, choices: all }, deps);
  check("a second channel of the same name is refused", !dup.ok && dup.title === "Name in use");

  console.log("\n== Discord has no key to show ==");
  let discordTest: { channel: { kind: string; url: string } } | null = null;
  const discord = await channelOps.createChannelOp(owner, { name: "crew", kind: "DISCORD", url: DISCORD_URL, choices: ["crash", "gave-up"] }, {
    ...deps,
    send: async (channel) => {
      discordTest = { channel };
      return { ok: true, status: 204 } as const;
    },
  });
  check("added, and no secret handed back", discord.ok && discord.secret === undefined, JSON.stringify(discord));
  check("the test went out as Discord, to its address", discordTest !== null && (discordTest as { channel: { kind: string } }).channel.kind === "DISCORD" && (discordTest as { channel: { url: string } }).channel.url === DISCORD_URL);
  const crewRow = await db.notificationChannel.findFirstOrThrow({ where: { name: "crew" } });
  check("two choices stand for two kinds", crewRow.events.join() === "server.crashed,server.recovery.abandoned" && crewRow.signingSecret === null, crewRow.events.join());

  console.log("\n== changing a channel ==");
  const crewBefore = await db.notificationChannel.findFirstOrThrow({ where: { name: "crew" } });
  const changed = await channelOps.updateChannelOp(owner, crewBefore.id, { name: "crew chat", enabled: false, choices: ["crash", "backup"] });
  const crewAfter = await db.notificationChannel.findUniqueOrThrow({ where: { id: crewBefore.id } });
  check("name, switch and events change", changed.ok && crewAfter.name === "crew chat" && crewAfter.enabled === false && crewAfter.events.join() === "server.crashed,backup.failed,backup.damaged", crewAfter.events.join());
  check("the address is not touched", crewAfter.url === crewBefore.url);
  check("no events at all is refused: that is a channel to turn off, not one that hears nothing", !(await channelOps.updateChannelOp(owner, crewBefore.id, { choices: [] })).ok);
  check("a name taken by another channel is refused", !(await channelOps.updateChannelOp(owner, crewBefore.id, { name: "ops" })).ok);
  check("a member may not change it", !(await channelOps.updateChannelOp(member, crewBefore.id, { enabled: true })).ok);
  check("changing nothing says so", (await channelOps.updateChannelOp(owner, crewBefore.id, { name: "crew chat" })).title === "Nothing to change");

  console.log("\n== the test button, and the key replaced ==");
  got.length = 0;
  const again = await channelOps.testChannelOp(owner, saved.id, deps);
  check("a test goes through the same call and says so", again.ok && got.length === 1);
  answer = 503;
  const failedTest = await channelOps.testChannelOp(owner, saved.id, deps);
  check("one that fails says why, and the channel keeps it", !failedTest.ok && /HTTP 503/.test((await db.notificationChannel.findUniqueOrThrow({ where: { id: saved.id } })).lastError ?? ""));
  answer = 204;
  const rotated = await channelOps.rotateSigningSecretOp(owner, saved.id);
  check("a new key is handed back once, and differs", rotated.ok && rotated.secret !== undefined && rotated.secret !== added.secret);
  got.length = 0;
  await channelOps.testChannelOp(owner, saved.id, deps);
  const h = got[0]!.headers;
  check(
    "messages are now signed with the new key and no longer with the old",
    signatureMatches(rotated.secret!, Number(h["x-geeboard-timestamp"]), got[0]!.body, String(h["x-geeboard-signature"])) &&
      !signatureMatches(added.secret!, Number(h["x-geeboard-timestamp"]), got[0]!.body, String(h["x-geeboard-signature"])),
  );
  check("Discord has no key to replace", !(await channelOps.rotateSigningSecretOp(owner, crewBefore.id)).ok);

  console.log("\n== what the page is shown ==");
  const view = await channelOps.notificationsView();
  check(
    "each channel by name, kind and where it goes",
    view.channels.map((c) => `${c.name}:${c.kind}:${c.goes}`).sort().join("|") === "crew chat:DISCORD:discord.com/api/webhooks/123456789012345678/•••|ops:WEBHOOK:127.0.0.1",
    view.channels.map((c) => c.goes).join("|"),
  );
  check("with whether the events are all ticked", view.channels.find((c) => c.name === "ops")!.choices.length === 6 && view.channels.find((c) => c.name === "crew chat")!.choices.join() === "crash,backup");
  check("and not the token, the path or a key anywhere in it", !JSON.stringify(view).includes(TOKEN) && !JSON.stringify(view).includes(added.secret!) && !JSON.stringify(view).includes(rotated.secret!));
  check("the page says whether private networks are allowed, and by which variable", view.privateAllowed === false && view.variable === "GEEBOARD_WEBHOOK_ALLOW_PRIVATE");

  console.log("\n== removing one ==");
  await db.notificationDelivery.create({ data: { channelId: saved.id, kind: "node.recovered", payload: { title: "x" }, state: "PENDING" } });
  const removed = await channelOps.removeChannelOp(owner, saved.id);
  check("it goes, and its waiting messages with it, saying so", removed.ok && /1 waiting message/.test(removed.body) && (await db.notificationDelivery.count()) === 0 && (await db.notificationChannel.count()) === 1);
  check("a member may not remove one", !(await channelOps.removeChannelOp(member, crewBefore.id)).ok);

  console.log("\n== the audit log says what was done, and not where, or with what ==");
  const audit = await db.activityEvent.findMany({ where: { action: { startsWith: "notifications." } }, orderBy: { createdAt: "asc" } });
  check("a line each for adding, changing, testing, the key and removing", ["created", "updated", "tested", "key", "removed"].every((a) => audit.some((e) => e.action === `notifications.channel.${a}`)), audit.map((e) => e.action).join());
  const said = JSON.stringify(audit);
  check("with no address, token or key in any of them", !said.includes(TOKEN) && !said.includes(added.secret!) && !said.includes(rotated.secret!) && !said.includes(HOOK_URL));

  console.log("\n== the poller does it: a row in the audit log, one pass, a signed message at the receiver ==");
  /* The poller is its own process and reads the policy from its own environment, where loopback is never allowed.
     So the stand-in listens on this machine's private address and the process is given the operator's switch,
     which is exactly how somebody with ntfy on the LAN would run it. */
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => Boolean(i) && i!.family === "IPv4" && !i!.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i!.address))
    .map((i) => i.address);
  // A machine has adapters nothing can reach it through (a hypervisor's, a VPN's): the first address the receiver answers on.
  const probe = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => probe.listen(0, "0.0.0.0", resolve));
  const probePort = (probe.address() as AddressInfo).port;
  let lan: string | undefined;
  for (const address of candidates) {
    const answered = await fetch(`http://${address}:${probePort}/`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
    if (answered) {
      lan = address;
      break;
    }
  }
  probe.closeAllConnections();
  probe.close();
  if (!lan) {
    console.log("  skip no private IPv4 address on this machine, so the poller's process cannot be given a receiver");
  } else {
    await db.notificationDelivery.deleteMany();
    await db.notificationChannel.deleteMany();
    await db.notificationCursor.deleteMany();
    const lanGot: Got[] = [];
    const lanReceiver = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        lanGot.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise<void>((resolve) => lanReceiver.listen(0, "0.0.0.0", resolve));
    const lanPort = (lanReceiver.address() as AddressInfo).port;
    try {
      await db.notificationChannel.create({
        data: { name: "lan", kind: "WEBHOOK", url: encryptSecret(`http://${lan}:${lanPort}/poller/${TOKEN}`), signingSecret: encryptSecret(KEY), events: [...ALL_KINDS] },
      });
      /* A child process, waited for without blocking this one: the receiver is in this process, and a process that
         is waiting synchronously cannot answer. */
      const pollOnce = () =>
        new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
          const child = spawn(process.execPath, ["--import", "tsx", "--conditions=react-server", "scripts/poller.mts", "--once"], {
            cwd: process.cwd(),
            env: { ...process.env, GEEBOARD_WEBHOOK_ALLOW_PRIVATE: "1", PANEL_URL: "https://panel.example.com" },
          });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
          child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
          const timer = setTimeout(() => child.kill(), 120_000);
          child.on("close", (status) => {
            clearTimeout(timer);
            resolve({ status, stdout, stderr });
          });
        });
      const first = await pollOnce();
      check("a pass of the poller runs", first.status === 0, `${first.status} ${first.stderr?.slice(0, 300)}`);
      check("the first pass makes the cursor and sends nothing", (await db.notificationCursor.count()) === 1 && lanGot.length === 0);
      // After the cursor, and old enough to have settled: the dispatcher leaves the last few seconds for the next look.
      await row("server.crashed", { server: "aurora", at: new Date() });
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      const second = await pollOnce();
      check("the next pass runs", second.status === 0, `${second.status} ${second.stderr?.slice(0, 300)}`);
      const crash = lanGot.find((g) => JSON.parse(g.body).event === "server.crashed");
      check("the receiver was sent the crash, by the poller's own process", Boolean(crash) && crash!.path === `/poller/${TOKEN}`, JSON.stringify(lanGot.map((g) => g.path)));
      check("signed, as a webhook is", Boolean(crash) && signatureMatches(KEY, Number(crash!.headers["x-geeboard-timestamp"]), crash!.body, String(crash!.headers["x-geeboard-signature"])));
      check("with a link back to the panel it was told about", Boolean(crash) && JSON.parse(crash!.body).link === `https://panel.example.com/servers/${aurora.slug}`, crash?.body);
      const sentRows = await db.notificationDelivery.findMany({ where: { kind: "server.crashed" } });
      check("and the delivery says sent", sentRows.length === 1 && sentRows[0]!.state === "SENT", JSON.stringify(sentRows.map((d) => `${d.state} ${d.lastError ?? ""}`)) + " | " + (second.stdout ?? "").split(String.fromCharCode(10)).filter((l) => /notif/.test(l)).join(" ; "));
      const third = await pollOnce();
      check("a pass after that sends nothing again", third.status === 0 && lanGot.filter((g) => JSON.parse(g.body).event === "server.crashed").length === 1);
    } finally {
      lanReceiver.closeAllConnections();
      lanReceiver.close();
    }
  }
} finally {
  receiver.closeAllConnections();
  receiver.close();
  await db.notificationDelivery.deleteMany().catch(() => {});
  await db.notificationChannel.deleteMany().catch(() => {});
  await db.notificationCursor.deleteMany().catch(() => {});
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
