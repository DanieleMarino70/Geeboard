import "./load-env.mts";
import process from "node:process";

/* The hot paths and the sign-in, measured: what 0.9 changed about the cost of saying no, and about who can say yes.

   In process, like verify:api: the routes are functions of a Request. What it proves that the unit tests cannot is the
   part with a database and a clock in it:

     scrypt         reading a sealed secret is under a millisecond after the first, where it was 30 ms a time
     sign-in        an address nobody has and one somebody has answer in the same time (it was 0.01 ms against 264 ms)
     the heartbeat  a source that is refused is refused without being read, and cannot choose its own bucket
     api keys       the proof of a key is remembered, and a revoked, reset or recovered key is refused at once
     registration   an address that can only be the cloud's metadata service is refused, and the token is not spent
     the console    a carriage return inside a command is refused
     recovery codes salted scrypt now, and a row from before still works

   The numbers are printed, so that a run on another machine says how fast that machine is. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
const { syncCatalog } = await import("../src/lib/catalog-sync");
const { encryptSecret, decryptSecret } = await import("../src/lib/secrets");
const { verifyCredentials } = await import("../src/lib/auth");
const { createApiKeyOp, revokeApiKeyOp, sendConsoleCommandOp } = await import("../src/lib/server-ops");
const { issueResetLinkOp, signOutEverywhereOp, beginTwoFactorOp, confirmTwoFactorOp, verifySecondFactorOp } = await import("../src/lib/account-ops");
const { recoverOwnerOp } = await import("../src/lib/setup-ops");
const { createRegistrationTokenOp, registerNode } = await import("../src/lib/node-ops");
const { base32Decode, totp } = await import("../src/domain/access/totp");
const bcrypt = (await import("bcryptjs")).default;
const { createHash } = await import("node:crypto");

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

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = "http://panel.test";
const route = async (path: string) => (await import(`../src/app/api/v1/${path}/route`)) as Record<string, Handler>;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const timed = async <T,>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t = performance.now();
  const value = await fn();
  return [value, performance.now() - t];
};

try {
  await seed();
  await syncCatalog({ offline: true });
  const mara = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });
  // A node of its own, with a token this script knows: the seeded ones have no agent.
  const nodeToken = "z".repeat(40);
  const beatMint = await createRegistrationTokenOp(mara, { nodeName: "beat-node" });
  await registerNode({
    token: beatMint.secret!,
    advertiseUrl: "http://127.0.0.1:1",
    agentToken: nodeToken,
    agentVersion: "0.9.0",
    agentContract: 1,
    capabilities: [],
    resources: { cpuCores: 1, ramTotalGb: 1, diskTotalGb: 1 },
  });
  const node = await db.node.findUniqueOrThrow({ where: { name: "beat-node" } });

  console.log("\n== reading a sealed secret ==");
  const sealed = encryptSecret("the node's token, as the panel keeps it");
  decryptSecret(sealed);
  const reads = 500;
  const [, spent] = await timed(async () => {
    for (let i = 0; i < reads; i++) decryptSecret(sealed);
  });
  console.log(`       ${(spent / reads).toFixed(4)} ms a read (scrypt alone is about 30 ms)`);
  check("a read after the first is under a millisecond", spent / reads < 1, `${(spent / reads).toFixed(3)} ms`);
  check("and is the same secret", decryptSecret(sealed) === "the node's token, as the panel keeps it");

  console.log("\n== sign-in: an address nobody has, and one somebody has ==");
  const passwordHash = await bcrypt.hash("the right password", 12);
  await db.user.upsert({ where: { email: "timing@ashfold.gg" }, update: { passwordHash }, create: { email: "timing@ashfold.gg", name: "Timing", initials: "TI", role: "MEMBER", passwordHash } });
  await verifyCredentials("warmup@nobody.example", "x"); // the dummy hash is made on first use
  const unknown: number[] = [];
  const known: number[] = [];
  for (let i = 0; i < 50; i++) {
    unknown.push((await timed(() => verifyCredentials(`nobody-${i}@nobody.example`, "a wrong password")))[1]);
    known.push((await timed(() => verifyCredentials("timing@ashfold.gg", "a wrong password")))[1]);
  }
  const [mu, mk] = [median(unknown), median(known)];
  console.log(`       median ${mu.toFixed(1)} ms for an address nobody has, ${mk.toFixed(1)} ms for one somebody has`);
  check("an address nobody has takes a real hash's time, not a refused one's", mu > 50, `${mu.toFixed(2)} ms`);
  check("and the two medians are within noise of each other (a quarter)", Math.abs(mu - mk) / Math.max(mu, mk) < 0.25, `${mu.toFixed(1)} against ${mk.toFixed(1)}`);
  check("the right password still signs in", (await verifyCredentials("timing@ashfold.gg", "the right password"))?.email === "timing@ashfold.gg");

  console.log("\n== the heartbeat, from sources of its own ==");
  const beat = (await route("nodes/heartbeat")).POST!;
  const send = (token: string, forwarded: string, name = node.name) =>
    beat(new Request(`${BASE}/api/v1/nodes/heartbeat`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": forwarded }, body: JSON.stringify({ name, token }) }));
  const codes = async (n: number, token: string, forwardedAt: (i: number) => string) => {
    const seen: number[] = [];
    for (let i = 0; i < n; i++) seen.push((await send(token, forwardedAt(i))).status);
    return seen;
  };

  // A script that sends a different first entry with every try: what the proxy wrote is the last, and is the same.
  const spoof = await codes(60, "wrong-token", (i) => `10.1.${i}.${i}, 198.51.100.7`);
  const refused = spoof.filter((s) => s === 401).length;
  const limited = spoof.filter((s) => s === 429).length;
  console.log(`       60 wrong tokens, a new first entry each: ${refused} refused as not-a-node, ${limited} not read at all`);
  check("a source that fails thirty times is then refused without being read", refused === 30 && limited === 30, `${refused}/${limited}`);
  check("whatever it writes in the first entry", spoof.slice(30).every((s) => s === 429));
  check("a different source is unaffected", (await send("wrong-token", "10.1.0.1, 198.51.100.8")).status === 401);
  const [, flood] = await timed(async () => {
    for (let i = 0; i < 1000; i++) await send("wrong-token", `x, 198.51.100.7`);
  });
  console.log(`       1000 more from the refused source: ${flood.toFixed(0)} ms in all`);
  check("a thousand more from it cost under two seconds in all", flood < 2000, `${flood.toFixed(0)} ms`);

  // Reached a moment ago, so that a beat is not followed by a call to the seeded node's address, which is nowhere.
  await db.node.update({ where: { id: node.id }, data: { lastReachedAt: new Date() } });
  const good = await send(nodeToken, "10.9.9.9, 198.51.100.9");
  check("the node that knows its token still gets through, from another source", good.status === 200, String(good.status));
  const goodBurst = await codes(40, nodeToken, () => "10.9.9.9, 198.51.100.10");
  check("one node beating faster than a fleet ever would is told to wait", goodBurst.filter((s) => s === 200).length <= 30 && goodBurst.includes(429), JSON.stringify(goodBurst.slice(25, 35)));

  const body429 = (await (await send("wrong-token", "x, 198.51.100.7")).json()) as { code?: string };
  check("the refusal says what it is", body429.code === "RATE_LIMITED", JSON.stringify(body429));

  console.log("\n== registration: a token guessed at, and an address that is not a node's ==");
  const register = (await route("nodes/register")).POST!;
  const attemptRegister = (token: string, forwarded: string, extra: Record<string, unknown> = {}) =>
    register(new Request(`${BASE}/api/v1/nodes/register`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": forwarded }, body: JSON.stringify({ token, advertiseUrl: "http://127.0.0.1:1", agentToken: "x".repeat(40), ...extra }) }));
  const guesses: number[] = [];
  for (let i = 0; i < 16; i++) guesses.push((await attemptRegister(`gbn_notatoken${i}`, "1.1.1.1, 198.51.100.20")).status);
  console.log(`       16 wrong tokens: ${guesses.filter((s) => s === 401).length} refused, ${guesses.filter((s) => s === 429).length} not read`);
  check("a source that has guessed ten registration tokens wrong is refused without being read", guesses.filter((s) => s === 401).length === 10 && guesses.slice(10).every((s) => s === 429), JSON.stringify(guesses));

  const minted = await createRegistrationTokenOp(mara, { nodeName: "hardening-node" });
  check("a token can be minted", minted.ok && Boolean(minted.secret), minted.body);
  const join = (advertiseUrl: string) =>
    registerNode({ token: minted.secret!, advertiseUrl, agentToken: "y".repeat(40), agentVersion: "0.9.0", agentContract: 1, capabilities: [], resources: { cpuCores: 1, ramTotalGb: 1, diskTotalGb: 1 } });
  for (const [label, address] of [
    ["the cloud metadata service", "http://169.254.169.254:80"],
    ["the same, as IPv4 in IPv6", "http://[::ffff:169.254.169.254]:80"],
    ["an address with a password in it", "http://admin:secret@203.0.113.10:8080"],
  ] as const) {
    let said = "";
    try {
      await join(address);
    } catch (error) {
      said = (error as Error).message;
    }
    check(`${label} is refused at registration`, said !== "" && !/panel and that agent/.test(said), said || "it was accepted");
  }
  check("without spending the token", !(await db.nodeRegistrationToken.findFirstOrThrow({ where: { nodeName: "hardening-node" } })).usedAt);
  check("and without writing a node", (await db.node.count({ where: { name: "hardening-node" } })) === 0);

  console.log("\n== api keys: proved once, refused the moment they are revoked ==");
  const ownerHash = await bcrypt.hash("x", 4);
  const owner = await db.user.upsert({ where: { email: "keys-owner@ashfold.gg" }, update: {}, create: { email: "keys-owner@ashfold.gg", name: "Keys Owner", initials: "KO", role: "OWNER", passwordHash: ownerHash, passwordSetAt: new Date() } });
  const listServers = (await route("servers")).GET!;
  const withKey = (secret: string) => listServers(new Request(`${BASE}/api/v1/servers`, { headers: { authorization: `Bearer ${secret}` } }));
  const made = await createApiKeyOp(owner, "Hardening", ["servers:read"]);
  const secret = (made as { secret?: string }).secret!;
  check("a key can be made", made.ok && Boolean(secret), JSON.stringify(made));
  const row = await db.apiKey.findFirstOrThrow({ where: { userId: owner.id, name: "Hardening" } });
  const yearOut = row.expiresAt ? (row.expiresAt.getTime() - Date.now()) / 86_400_000 : 0;
  check("it expires in a year by default", yearOut > 364 && yearOut < 366, `${yearOut.toFixed(1)} days`);
  const [first, tFirst] = await timed(() => withKey(secret));
  const later: number[] = [];
  for (let i = 0; i < 20; i++) later.push((await timed(() => withKey(secret)))[1]);
  console.log(`       first request ${tFirst.toFixed(0)} ms (bcrypt), then a median of ${median(later).toFixed(1)} ms`);
  check("it works", first.status === 200, String(first.status));
  check("the second and later requests do not pay bcrypt again", median(later) < tFirst / 3 && median(later) < 25, `${median(later).toFixed(1)} ms against ${tFirst.toFixed(0)} ms`);

  await revokeApiKeyOp(owner, row.id);
  check("a revoked key is refused at once, though its proof is remembered", (await withKey(secret)).status === 401);

  const keyFor = async (user: typeof owner, name: string) => (await createApiKeyOp(user, name, ["servers:read"]) as { secret?: string }).secret!;
  const member = await db.user.upsert({ where: { email: "keys-member@ashfold.gg" }, update: { role: "MODERATOR" }, create: { email: "keys-member@ashfold.gg", name: "Keys Moderator", initials: "KM", role: "MODERATOR", passwordHash: ownerHash, passwordSetAt: new Date() } });
  const memberKey = await keyFor(member, "Reset me");
  check("a moderator's key works", (await withKey(memberKey)).status === 200);
  await issueResetLinkOp(owner, member.id, BASE);
  check("an admin's reset of the account revokes its keys", (await withKey(memberKey)).status === 401);

  const ownKey = await keyFor(owner, "Sign out");
  check("another key works", (await withKey(ownKey)).status === 200);
  const out = await signOutEverywhereOp(owner, null);
  check("signing out everywhere revokes the keys, and says so", (await withKey(ownKey)).status === 401 && /revoked/.test(out.body ?? ""), out.body ?? "");

  const recoverKey = await keyFor(owner, "Recover");
  check("a key made before a recovery works", (await withKey(recoverKey)).status === 200);
  const recovered = await recoverOwnerOp({ email: "keys-owner@ashfold.gg" });
  check("the recovery runs", recovered.ok, JSON.stringify(recovered));
  check("and a key created before it returns 401 after", (await withKey(recoverKey)).status === 401);
  const audit = await db.activityEvent.findFirst({ where: { action: "installation.owner.recovered", target: "keys-owner@ashfold.gg" }, orderBy: { createdAt: "desc" } });
  check("the audit row says how many keys went", JSON.stringify(audit?.changes ?? {}).includes("API keys"), JSON.stringify(audit?.changes));

  console.log("\n== the console: one line, and a carriage return is a line ==");
  const aurora = await db.server.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const sent = await sendConsoleCommandOp(mara, aurora.slug, "say hello\rop somebody");
  check("a carriage return inside a command is refused", !sent.ok && sent.title === "One line only", `${sent.title}`);
  const sentLf = await sendConsoleCommandOp(mara, aurora.slug, "say hello\nop somebody");
  check("and so is a newline, as before", !sentLf.ok && sentLf.title === "One line only", `${sentLf.title}`);

  console.log("\n== recovery codes: salted, slow to guess, and the old ones still work ==");
  const twoFactorUser = await db.user.upsert({ where: { email: "codes@ashfold.gg" }, update: { twoFactor: false, totpSecret: null, passwordSetAt: new Date() }, create: { email: "codes@ashfold.gg", name: "Codes", initials: "CO", role: "MODERATOR", passwordHash: ownerHash, passwordSetAt: new Date() } });
  await db.recoveryCode.deleteMany({ where: { userId: twoFactorUser.id } });
  const begun = await beginTwoFactorOp(twoFactorUser);
  const secretText = (begun as { secret?: string }).secret!;
  const confirmed = await confirmTwoFactorOp(await db.user.findUniqueOrThrow({ where: { id: twoFactorUser.id } }), totp(base32Decode(secretText), Date.now()));
  const codes10 = (confirmed as { codes?: string[] }).codes ?? [];
  check("two-factor is on and ten codes came back", codes10.length === 10, JSON.stringify(confirmed).slice(0, 120));
  const stored = await db.recoveryCode.findMany({ where: { userId: twoFactorUser.id } });
  check("each is kept as a salted scrypt hash, not SHA-256", stored.length === 10 && stored.every((r) => r.hash.startsWith("s1$") && r.hash.length > 64), stored[0]?.hash.slice(0, 12));
  check("and no two are alike, as the same code would be under SHA-256 with no salt", new Set(stored.map((r) => r.hash)).size === 10);
  const norm = (c: string) => c.replace("-", "");
  check("a hash is not the SHA-256 of any code", !stored.some((r) => codes10.some((c) => r.hash === createHash("sha256").update(norm(c)).digest("hex"))));
  const [used, tUse] = await timed(() => verifySecondFactorOp(twoFactorUser.id, codes10[3]!.toUpperCase()));
  console.log(`       a code checked against ten: ${tUse.toFixed(0)} ms`);
  check("a recovery code signs in, typed in capitals", used.ok && (used as { via?: string }).via === "recovery", JSON.stringify(used));
  check("once", !(await verifySecondFactorOp(twoFactorUser.id, codes10[3]!)).ok);
  check("and a code that is not one is refused", !(await verifySecondFactorOp(twoFactorUser.id, "zzzzz-zzzzz")).ok);
  // A row from before: SHA-256 as hex, as 0.8 wrote it.
  await db.recoveryCode.create({ data: { userId: twoFactorUser.id, hash: createHash("sha256").update("abcdefghjk").digest("hex") } });
  const legacy = await verifySecondFactorOp(twoFactorUser.id, "ABCDE-FGHJK");
  check("a code stored the old way, before 0.9, still works", legacy.ok, JSON.stringify(legacy));
} finally {
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
