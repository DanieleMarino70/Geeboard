import "./load-env.mts";
import { spawnSync } from "node:child_process";
import process from "node:process";

/* Changing the key stored secrets are sealed with, without losing any.

   Five kinds of value are sealed with it — a node's token, an account's two-factor
   secret, the off-site bucket's key, the Steam key, a DNS provider's token — and
   until `rekey` existed a new key made all of them unreadable at once. So this
   makes one of each kind, sealed with an old key, and then tries to get the
   operation to do the wrong thing: to write when something does not open, to
   write a value that changed under it, to accept a key that is not one. What it
   must do, in the end, is leave the data either entirely as it was or entirely
   under the new key, with the old one no longer opening any of it, and never say
   a key or a secret anywhere. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
const { rekeyOp } = await import("../src/lib/rekey-ops");
const { decryptSecret, openWith, sealWith } = await import("../src/lib/secrets");

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

const OLD = "rekey-old-Qm7Lx2Vc9Bn4Kp6Jh8Gf3Ds5Aa1Zz";
const NEW = "rekey-new-Yt5Re3Wq1Pl9Ok7Ij2Uh4Yg6Tf8Rd0";
// Fixed, and not the environment's: a development .env carries a placeholder here, and what is being tried is the equality.
const SESSION = "rekey-session-Vb6Nm8Kj2Hg4Fd1Sa3Pq5We7Ry9Tu";
const PLAIN = {
  node: (name: string) => `node-token-of-${name}-long-enough-to-look-real`,
  totp: (email: string) => `totp-secret-of-${email}`,
  bucket: "bucket-secret-access-key-0123456789",
  steam: "0123456789ABCDEF0123456789ABCDEF",
  dns: "dns-provider-token-0123456789abcdef",
  channelUrl: (name: string) => `https://discord.com/api/webhooks/123456789012345678/token-of-${name}-0123456789abcdefghij`,
  channelKey: "webhook-signing-key-0123456789abcdef0123",
};

const everyStored = async () => {
  const nodes = await db.node.findMany({ where: { daemonToken: { not: null } }, select: { name: true, daemonToken: true }, orderBy: { name: "asc" } });
  const users = await db.user.findMany({ where: { totpSecret: { not: null } }, select: { email: true, totpSecret: true }, orderBy: { email: "asc" } });
  return {
    nodes,
    users,
    bucket: (await db.backupStorage.findFirst())?.secretAccessKey ?? null,
    steam: (await db.workshopKey.findFirst())?.apiKey ?? null,
    dns: (await db.dnsProvider.findFirst())?.token ?? null,
    channels: await db.notificationChannel.findMany({ select: { name: true, url: true, signingSecret: true }, orderBy: { name: "asc" } }),
  };
};
const snapshot = async () => JSON.stringify(await everyStored());
const opensWith = (key: string, stored: string | null) => {
  if (stored === null) return false;
  try {
    openWith(key, stored);
    return true;
  } catch {
    return false;
  }
};

try {
  await seed();
  await Promise.all([db.backupStorage.deleteMany(), db.workshopKey.deleteMany(), db.dnsProvider.deleteMany(), db.notificationChannel.deleteMany()]);

  console.log("\n== one of each kind, sealed with the old key ==");
  const nodes = await db.node.findMany({ orderBy: { name: "asc" }, take: 2 });
  for (const node of nodes) await db.node.update({ where: { id: node.id }, data: { daemonToken: sealWith(OLD, PLAIN.node(node.name)) } });
  const users = await db.user.findMany({ orderBy: { email: "asc" }, take: 2 });
  for (const user of users) await db.user.update({ where: { id: user.id }, data: { totpSecret: sealWith(OLD, PLAIN.totp(user.email)) } });
  await db.backupStorage.create({ data: { endpoint: "https://s3.example.invalid", region: "x", bucket: "b", accessKeyId: "AKIAEXAMPLE", secretAccessKey: sealWith(OLD, PLAIN.bucket) } });
  await db.workshopKey.create({ data: { apiKey: sealWith(OLD, PLAIN.steam) } });
  await db.dnsProvider.create({ data: { kind: "duckdns", token: sealWith(OLD, PLAIN.dns), zone: "duckdns.org" } });
  // Two channels: a Discord one, whose address holds its token, and a webhook, which also has a signing key.
  await db.notificationChannel.create({ data: { name: "crew", kind: "DISCORD", url: sealWith(OLD, PLAIN.channelUrl("crew")), events: ["server.crashed"] } });
  await db.notificationChannel.create({ data: { name: "ops", kind: "WEBHOOK", url: sealWith(OLD, PLAIN.channelUrl("ops")), signingSecret: sealWith(OLD, PLAIN.channelKey), events: ["node.unreachable"] } });
  const start = await snapshot();
  const total = 2 + 2 + 1 + 1 + 1 + 2 + 1;
  check("two node tokens, two two-factor secrets, a bucket key, a Steam key, a DNS token, two channel addresses and a signing key are stored", (await db.node.count({ where: { daemonToken: { not: null } } })) === 2 && total === 10);

  console.log("\n== a dry run says what it would do, and does nothing ==");
  let r = await rekeyOp({ currentKey: OLD, newKey: NEW, sessionSecret: SESSION, dryRun: true });
  check("it reports ten values of seven kinds", r.ok && r.dryRun && r.counts.reduce((n, c) => n + c.values, 0) === 10 && r.counts.filter((c) => c.values > 0).length === 7, JSON.stringify(r));
  check("and nothing in the database moved", (await snapshot()) === start);
  check("and nothing was written to the audit log", (await db.activityEvent.count({ where: { action: "secrets.rekeyed" } })) === 0);

  console.log("\n== a new key that is not a key is refused ==");
  for (const [label, key, expected] of [
    ["too short", "short", /SECRETS_KEY_NEW is 5 characters/],
    ["missing", undefined, /SECRETS_KEY_NEW is not set/],
    ["a placeholder", "generate-with-openssl-rand-base64-32-xxxxxxxxxxxx", /placeholder/],
    ["the one already in use", OLD, /already sealed with/],
    ["the session secret", SESSION, /same as SESSION_SECRET/],
  ] as const) {
    r = await rekeyOp({ currentKey: OLD, newKey: key, sessionSecret: SESSION });
    check(`${label}: said so, and nothing written`, !r.ok && expected.test(r.problem ?? "") && (await snapshot()) === start, r.problem);
  }
  r = await rekeyOp({ currentKey: undefined, newKey: NEW, sessionSecret: SESSION });
  check("no current key is said to be missing", !r.ok && /current key is missing/.test(r.problem ?? ""));

  console.log("\n== the current key is not the one they were written with ==");
  r = await rekeyOp({ currentKey: "rekey-wrong-Zz9Yx8Ww7Vv6Uu5Tt4Ss3Rr2Qq1Pp0", newKey: NEW, sessionSecret: SESSION });
  check("nothing opens, and it says the key was probably changed first", !r.ok && /Nothing the panel has stored opens/.test(r.problem ?? "") && /changed in the environment before/.test(r.problem ?? ""), r.problem);
  check("and nothing was written", (await snapshot()) === start);

  console.log("\n== one value does not open ==");
  const victim = nodes[1]!;
  await db.node.update({ where: { id: victim.id }, data: { daemonToken: sealWith("rekey-other-Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj", "someone else's") } });
  const torn = await snapshot();
  r = await rekeyOp({ currentKey: OLD, newKey: NEW, sessionSecret: SESSION });
  check("the whole run stops, naming the node and the kind and not the value", !r.ok && r.problem!.includes(victim.name) && /node tokens/.test(r.problem!) && /1 of 10/.test(r.problem!) && !r.problem!.includes("someone else"), r.problem);
  check("and says why it leaves the rest alone", /two keys in use/.test(r.problem ?? ""));
  check("and not one of the six that did open was sealed with the new key", (await snapshot()) === torn);
  await db.node.update({ where: { id: victim.id }, data: { daemonToken: sealWith(OLD, PLAIN.node(victim.name)) } });
  check("set right, it opens to what it was", openWith(OLD, (await db.node.findUniqueOrThrow({ where: { id: victim.id } })).daemonToken!) === PLAIN.node(victim.name));

  console.log("\n== a secret that changes while it runs ==");
  r = await rekeyOp({
    currentKey: OLD,
    newKey: NEW,
    sessionSecret: SESSION,
    beforeWrite: async () => {
      await db.dnsProvider.updateMany({ data: { token: sealWith(OLD, "a newer token, written in between") } });
    },
  });
  check("the whole write is undone and it says to stop the panel first", !r.ok && /changed while this ran/.test(r.problem ?? "") && /Stop the panel and the poller/.test(r.problem ?? ""), r.problem);
  const after = await everyStored();
  check("the rows it had already written are back under the old key", after.nodes.every((n) => opensWith(OLD, n.daemonToken)) && after.users.every((u) => opensWith(OLD, u.totpSecret)) && opensWith(OLD, after.bucket) && opensWith(OLD, after.steam));
  check("and the value that changed is the newer one, not lost", opensWith(OLD, after.dns) && openWith(OLD, after.dns!) === "a newer token, written in between");
  check("and nothing was written to the audit log", (await db.activityEvent.count({ where: { action: "secrets.rekeyed" } })) === 0);
  await db.dnsProvider.updateMany({ data: { token: sealWith(OLD, PLAIN.dns) } });

  console.log("\n== the real run ==");
  r = await rekeyOp({ currentKey: OLD, newKey: NEW, sessionSecret: SESSION });
  check("it succeeds, for ten values", r.ok && !r.dryRun && r.counts.reduce((n, c) => n + c.values, 0) === 10, JSON.stringify(r));
  const done = await everyStored();
  check("every node token opens with the new key, to what it was", done.nodes.every((n) => opensWith(NEW, n.daemonToken) && openWith(NEW, n.daemonToken!) === PLAIN.node(n.name)));
  check("every two-factor secret too", done.users.every((u) => openWith(NEW, u.totpSecret!) === PLAIN.totp(u.email)));
  check("the bucket key, the Steam key and the DNS token too", openWith(NEW, done.bucket!) === PLAIN.bucket && openWith(NEW, done.steam!) === PLAIN.steam && openWith(NEW, done.dns!) === PLAIN.dns);
  check("and so do the channels' addresses and the webhook's signing key", done.channels.length === 2 && done.channels.every((c) => openWith(NEW, c.url) === PLAIN.channelUrl(c.name)) && openWith(NEW, done.channels.find((c) => c.name === "ops")!.signingSecret!) === PLAIN.channelKey && done.channels.find((c) => c.name === "crew")!.signingSecret === null);
  check("and not one of them opens with the old key any more", [...done.nodes.map((n) => n.daemonToken), ...done.users.map((u) => u.totpSecret), done.bucket, done.steam, done.dns, ...done.channels.flatMap((c) => [c.url, c.signingSecret])].every((s) => !opensWith(OLD, s)));

  const events = await db.activityEvent.findMany({ where: { action: "secrets.rekeyed" } });
  check("the audit log has one line, by the operator, as a warning, with how many of each", events.length === 1 && events[0]!.actor === "Operator" && events[0]!.tone === "WARNING" && JSON.stringify(events[0]!.changes).includes("node tokens") && JSON.stringify(events[0]!.changes).includes("new key · 2"), JSON.stringify(events));
  const everything = JSON.stringify([events, r]);
  const leaks = [OLD, NEW, ...Object.values(PLAIN).filter((x) => typeof x === "string"), PLAIN.node(nodes[0]!.name), PLAIN.totp(users[0]!.email), PLAIN.channelUrl("crew"), PLAIN.channelUrl("ops")];
  check("neither the audit log nor the report has a key or a secret in it", leaks.every((s) => !everything.includes(s)));

  console.log("\n== the panel, given the new key, reads what it always read ==");
  const was = process.env.SECRETS_KEY;
  process.env.SECRETS_KEY = NEW;
  try {
    const node = done.nodes[0]!;
    check("decryptSecret, which is what a node's token, a two-factor check and the rest go through, opens them", decryptSecret(node.daemonToken!) === PLAIN.node(node.name) && decryptSecret(done.dns!) === PLAIN.dns);
  } finally {
    if (was === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = was;
  }

  console.log("\n== run again with the old key: nothing opens, nothing is written ==");
  const settled = await snapshot();
  r = await rekeyOp({ currentKey: OLD, newKey: "rekey-third-Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2", sessionSecret: SESSION });
  check("a second run with the old key is refused as nothing opening, not as a success", !r.ok && /Nothing the panel has stored opens/.test(r.problem ?? ""));
  check("and the data is as the first run left it", (await snapshot()) === settled);

  console.log("\n== the command ==");
  const run = (env: Record<string, string | undefined>, ...args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "--conditions=react-server", "scripts/rekey.mts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env, NODE_ENV: "development" },
      encoding: "utf8",
    });
  const noKey = run({ SECRETS_KEY: NEW, SECRETS_KEY_NEW: undefined });
  check("without SECRETS_KEY_NEW it stops and says where the new key comes from", noKey.status === 2 && /SECRETS_KEY_NEW/.test(noKey.stderr) && /not from the command line/.test(noKey.stderr), `${noKey.status} ${noKey.stderr}`);
  const asArg = run({ SECRETS_KEY: NEW, SECRETS_KEY_NEW: "rekey-fourth-Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2Mm3" }, "--key", "whatever");
  check("a key on the command line is refused", asArg.status === 2 && /Unknown option/.test(asArg.stderr), `${asArg.status} ${asArg.stderr}`);
  const dry = run({ SECRETS_KEY: NEW, SECRETS_KEY_NEW: "rekey-fourth-Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2Mm3" }, "--dry-run");
  check("a dry run through the command counts the ten and writes nothing", dry.status === 0 && /Would seal again 10 stored secrets/.test(dry.stderr) && /Nothing was written/.test(dry.stderr) && (await snapshot()) === settled, `${dry.status} ${dry.stderr}`);
  check("the command prints no key", !`${dry.stdout}${dry.stderr}`.includes("rekey-fourth") && !`${dry.stdout}${dry.stderr}`.includes(NEW));
  const wrong = run({ SECRETS_KEY: OLD, SECRETS_KEY_NEW: "rekey-fourth-Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2Mm3" });
  check("with the wrong current key it exits non-zero and says nothing opens", wrong.status === 3 && /Nothing the panel has stored opens/.test(wrong.stderr), `${wrong.status} ${wrong.stderr}`);
} finally {
  await Promise.all([db.backupStorage.deleteMany(), db.workshopKey.deleteMany(), db.dnsProvider.deleteMany(), db.notificationChannel.deleteMany()]);
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
