import "./load-env.mts";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import Docker from "dockerode";

/* Games that somebody wrote, from a pasted manifest to a container on a node.

   The unit tests hold every rule of the manifest, the registry and the matcher.
   This runs what they cannot: the operations against a database, a real
   authenticator code that is spent and cannot be used twice, a tampered row, a
   second process that has to find a game the first approved, a node that has
   not said it will run an image somebody chose, and then — the part worth the
   most — a real agent making a real container from an image named by digest,
   whose options are read back from Docker. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
const { encryptSecret } = await import("../src/lib/secrets");
const account = await import("../src/lib/account-ops");
const community = await import("../src/lib/community-games");
const { createServerOp } = await import("../src/lib/create-ops");
const { deleteServerOp } = await import("../src/lib/server-ops");
const { profileOf } = await import("../src/lib/create-ops");
const { cannotRun, checkCompatibility } = await import("../src/domain/nodes/compatibility");
const { allGames, findGame, setCommunityGames } = await import("../src/domain/games/registry");
const { consolePatternsOf, isGuarded } = await import("../src/domain/games/matcher");
const { base32Decode, totp } = await import("../src/domain/access/totp");
const { canonicalJson } = await import("../src/domain/games/manifest");
const { gameShape } = await import("../src/app/api/v1/_shape");

if (!/geeboard_verify/.test(process.env.DATABASE_URL ?? "")) throw new Error("refusing: DATABASE_URL is not the verify database");

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

const run = promisify(execFile);
const docker = new Docker();
const TOKEN = "community-agent-token-long-enough!!";
const PORT = 8700 + Math.floor(Math.random() * 90);
const LABEL = "gg.geeboard.verify-community";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let agent: ChildProcess | undefined;
let dataRoot = "";

async function waitFor(fn: () => Promise<boolean>, label: string, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await fn()) return;
    } catch {
      /* not ready */
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/* The image, pinned by the digest Docker holds for it. Pulled first so there is one. */
await run("docker", ["pull", "-q", "alpine:3.20"]);
const repoDigest = (await run("docker", ["image", "inspect", "alpine:3.20", "--format", "{{index .RepoDigests 0}}"])).stdout.trim();
const DIGEST = repoDigest.slice(repoDigest.indexOf("@") + 1);
if (!/^sha256:[a-f0-9]{64}$/.test(DIGEST)) throw new Error(`no digest for alpine: ${repoDigest}`);
const IMAGE = `alpine@${DIGEST}`;

/* A small game that is really a shell reading its console: it says "up", echoes what it is told, and leaves on "stop". */
const SCRIPT = 'echo up; while read l; do [ "$l" = stop ] && exit 0; echo "recv: $l"; done';
const manifest = (over: Record<string, unknown> = {}) => ({
  manifest: 1,
  id: "community-echo",
  name: "Echo",
  family: "Echo Community",
  art: "ECHO\nCOMM",
  blurb: "A shell that reads its console, written as a manifest.",
  portBase: 26500,
  portSpan: 40,
  ports: [{ id: "game", label: "Game", offset: 0, container: 26500, protocol: "tcp", primary: true }],
  defaults: { memoryGb: 1, cpuLimit: 50, diskGb: 5, playersMax: 8 },
  limits: { memoryGb: [1, 4], cpuLimit: [50, 200], diskGb: [1, 20] },
  requirements: { memoryGbMin: 1, cpuPctMin: 50, diskGbMin: 1, os: ["linux", "windows"], arch: ["x64", "arm64"] },
  install: { kind: "image" },
  config: [
    { key: "motd", label: "Message", type: "string", target: { kind: "env", name: "MOTD" }, default: "hello", maxLength: 60 },
    { key: "joinPassword", label: "Join password", type: "string", target: { kind: "env", name: "JOIN_PASSWORD" }, default: "", secret: true },
  ],
  health: { probes: [{ kind: "log", pattern: "^up$" }], bootGraceSeconds: 20, readyPattern: "^up$" },
  console: { stopCommand: "stop", examples: ["hello"] },
  versions: [
    { id: "r1", label: "r1", image: IMAGE, note: "the only one", released: "2026-10-03", channel: "stable", recommended: true, args: ["sh", "-c", SCRIPT] },
  ],
  templates: [{ id: "default", name: "Default", blurb: "As it comes.", summary: "Says hello.", config: { motd: "hello" } }],
  ...over,
});

const hostile: Array<[string, Record<string, unknown>]> = [
  ["an image with no digest", manifest({ versions: [{ ...manifest().versions[0], image: "alpine:3.20" }] })],
  ["a registry nobody listed", manifest({ versions: [{ ...manifest().versions[0], image: `quay.io/x/y@${DIGEST}` }] })],
  ["a download install", manifest({ install: { kind: "download", archive: "zip" } })],
  ["mods", manifest({ mods: { provider: "steam-workshop", appId: 1 } })],
  ["an exponential expression", manifest({ health: { probes: [{ kind: "log", pattern: "^up$" }], bootGraceSeconds: 20, readyPattern: "^(a+)+$" } })],
  ["port 8080, where the agent listens", manifest({ portBase: 8070, portSpan: 40 })],
  ["a field that would widen the container", manifest({ privileged: true })],
];

try {
  await seed();
  await db.server.deleteMany({ where: { gameId: { startsWith: "community-" } } });
  await db.game.deleteMany({ where: { id: { startsWith: "community-" } } });
  await db.gameManifest.deleteMany();
  await db.communityPolicy.deleteMany();
  community.forgetCommunityGames();
  dataRoot = await mkdtemp(path.join(tmpdir(), "gb-community-"));

  const mara = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });
  const devi = await db.user.findUniqueOrThrow({ where: { email: "devi@ashfold.gg" } });
  const tomas = await db.user.findUniqueOrThrow({ where: { email: "tomas@ashfold.gg" } });

  // The owner needs two-factor to approve: enrolled here, in the verify database, with a secret kept in this process.
  const begun = await account.beginTwoFactorOp(mara);
  if (!begun.ok || !("secret" in begun)) throw new Error("enrolment did not begin");
  const secret = base32Decode(begun.secret);
  const enrolled = await account.confirmTwoFactorOp((await db.user.findUniqueOrThrow({ where: { id: mara.id } })), totp(secret, Date.now()));
  if (!enrolled.ok) throw new Error("enrolment did not confirm");
  const owner = await db.user.findUniqueOrThrow({ where: { id: mara.id } });
  /* The code for the current step, which the replay rule says may be used once. Where a second use is the point, it
     is used twice; where a second approval is the point, the clock is taken to have moved on. */
  const fresh = async () => {
    await db.user.update({ where: { id: mara.id }, data: { totpLastStep: null } });
    return totp(secret, Date.now());
  };
  const asOwner = async () => db.user.findUniqueOrThrow({ where: { id: mara.id } });

  console.log("\n== who may propose ==");
  const notMod = await community.submitManifestOp(tomas, JSON.stringify(manifest()));
  check("a moderator may not propose a game", !notMod.ok && notMod.title === "Not permitted", JSON.stringify(notMod));
  check("and nothing was written", (await db.gameManifest.count()) === 0);

  console.log("\n== a hostile manifest is refused before anything is written ==");
  for (const [label, body] of hostile) {
    const r = await community.submitManifestOp(devi, JSON.stringify(body));
    check(`${label}: refused, saying where`, !r.ok && r.title === "The manifest was refused" && (r.problems?.length ?? 0) > 0 && /\b[a-zA-Z]/.test(r.body), JSON.stringify(r));
  }
  const notJson = await community.submitManifestOp(devi, "{ not json");
  check("text that is not JSON is refused too", !notJson.ok && /not JSON/.test(JSON.stringify(notJson)));
  check("none of them is a row", (await db.gameManifest.count()) === 0);
  check("each is a warning in the audit log, with the hash and not the manifest", (await db.activityEvent.count({ where: { action: "community.manifest.refused" } })) === hostile.length + 1);
  const refusedLine = JSON.stringify(await db.activityEvent.findMany({ where: { action: "community.manifest.refused" } }));
  check("and the log holds no image, no digest and no expression", !refusedLine.includes(DIGEST) && !refusedLine.includes("(a+)+"));

  console.log("\n== a valid one waits, and runs nothing ==");
  const proposed = await community.submitManifestOp(devi, JSON.stringify(manifest()));
  check("an admin may propose it", proposed.ok && proposed.revisionId !== undefined, JSON.stringify(proposed));
  const pending = await db.gameManifest.findFirstOrThrow({ where: { gameId: "community-echo" } });
  check("it is PENDING, revision 1, with the hash of what was given", pending.state === "PENDING" && pending.revision === 1 && pending.hash === (await import("../src/domain/games/manifest")).hashOf(canonicalJson(manifest())), `${pending.state} ${pending.revision}`);
  await community.refreshCommunityGames({ force: true });
  check("a pending game is not in the registry, and so in no wizard", findGame("community-echo") === undefined && !allGames().some((g) => g.id === "community-echo"));
  check("nor is it in the catalog", (await db.game.count({ where: { id: "community-echo" } })) === 0);
  const again = await community.submitManifestOp(devi, JSON.stringify(manifest()));
  check("proposing the very same manifest again is refused, naming the revision", !again.ok && again.title === "Already here" && /revision 1/.test(again.body), JSON.stringify(again));

  console.log("\n== who may approve, and what is read ==");
  const byAdmin = await community.approveManifestOp(devi, pending.id, { hash: pending.hash, code: await fresh() });
  check("an admin may not approve", !byAdmin.ok && byAdmin.title === "Not permitted");
  const stale = await community.approveManifestOp(await asOwner(), pending.id, { hash: "0".repeat(64), code: await fresh() });
  check("a page that showed another revision cannot approve this one", !stale.ok && stale.title === "That is not what you read", JSON.stringify(stale));
  const noCode = await community.approveManifestOp(await asOwner(), pending.id, { hash: pending.hash, code: "000000" });
  check("a wrong code is refused", !noCode.ok && /did not match/.test(noCode.title), JSON.stringify(noCode));
  check("and the revision is still waiting", (await db.gameManifest.findUniqueOrThrow({ where: { id: pending.id } })).state === "PENDING");
  const noFactor = await community.approveManifestOp({ ...(await asOwner()), twoFactor: false }, pending.id, { hash: pending.hash, code: await fresh() });
  check("an owner without two-factor cannot approve", !noFactor.ok && noFactor.title === "Two-factor first" && /approving a game/.test(noFactor.body), JSON.stringify(noFactor));

  console.log("\n== the stored manifest is checked again, and a row somebody edited does not load ==");
  const original = pending.manifest;
  await db.gameManifest.update({ where: { id: pending.id }, data: { manifest: { ...(original as object), blurb: "edited by hand" } as never } });
  const tampered = await community.approveManifestOp(await asOwner(), pending.id, { hash: pending.hash, code: await fresh() });
  check("an edited row cannot be approved: it no longer hashes to what was proposed", !tampered.ok && tampered.title === "The stored manifest was changed", JSON.stringify(tampered));
  await db.gameManifest.update({ where: { id: pending.id }, data: { manifest: original as never } });

  console.log("\n== approved, with a code that works once ==");
  const code = await fresh();
  const approved = await community.approveManifestOp(await asOwner(), pending.id, { hash: pending.hash, code });
  check("the owner approves with a fresh code", approved.ok, JSON.stringify(approved));
  const echo = findGame("community-echo");
  check("the game is in the registry, listed, and not official", echo !== undefined && allGames().some((g) => g.id === "community-echo") && echo.official === false);
  check("it is in the catalog, with its version", (await db.game.findUnique({ where: { id: "community-echo" } }))?.official === false && (await db.gameVersion.count({ where: { gameId: "community-echo" } })) === 1);
  check("it requires the node's consent, whatever the author wrote", echo?.requirements.capabilities.includes("community-games") === true);
  check("every expression it carries is now matched under a time limit", echo !== undefined && consolePatternsOf(echo).length > 0 && consolePatternsOf(echo).every(isGuarded));
  const replay = await community.submitManifestOp(devi, JSON.stringify(manifest({ blurb: "revision two, to be approved with the same code" })));
  const second = await db.gameManifest.findFirstOrThrow({ where: { gameId: "community-echo", revision: 2 } });
  const reused = await community.approveManifestOp(await asOwner(), second.id, { hash: second.hash, code });
  check("the same code cannot approve a second thing", replay.ok && !reused.ok && /already used|did not match/.test(reused.title), JSON.stringify(reused));
  check("the approval is in the audit log, as a warning, with the hash and the image", (await db.activityEvent.findMany({ where: { action: "community.manifest.approved" } })).every((e) => e.tone === "WARNING" && JSON.stringify(e.changes).includes(DIGEST.slice(0, 20))));

  console.log("\n== a second process finds what the first approved ==");
  const runChild = async (id: string) => {
    const out = await run(process.execPath, ["--import", "tsx", "--conditions=react-server", "scripts/verify-community-child.mts", id], { cwd: process.cwd(), env: process.env, timeout: 60_000 });
    return JSON.parse(out.stdout.trim().split("\n").at(-1)!) as { before: { found: boolean }; found: boolean; listed: boolean; official: boolean | null; guarded: boolean | null };
  };
  const child = await runChild("community-echo");
  check("a process that started knowing nothing loads it from the database, checked, and guards its expressions", !child.before.found && child.found && child.listed && child.official === false && child.guarded === true, JSON.stringify(child));

  console.log("\n== a newer revision replaces it, and only one is approved ==");
  const code2 = await fresh();
  const r2 = await community.approveManifestOp(await asOwner(), second.id, { hash: second.hash, code: code2 });
  check("revision 2 is approved", r2.ok, JSON.stringify(r2));
  const states = (await db.gameManifest.findMany({ where: { gameId: "community-echo" }, orderBy: { revision: "asc" } })).map((r) => r.state);
  check("revision 1 is superseded, 2 is approved: never two", states.join() === "SUPERSEDED,APPROVED", states.join());
  check("the registry holds the newer text", findGame("community-echo")?.blurb === "revision two, to be approved with the same code");
  const r2Row = await db.gameManifest.findUniqueOrThrow({ where: { id: second.id } });
  const shape = gameShape(findGame("community-echo")!, (await community.approvedRevisions()).get("community-echo"));
  check("the API says it is a community game, not retired, and names the revision and hash that were approved", shape.community === true && shape.retired === false && shape.official === false && shape.revision?.number === 2 && shape.revision.hash === r2Row.hash, JSON.stringify(shape.revision));
  const shipped = gameShape(findGame("terraria")!, (await community.approvedRevisions()).get("terraria"));
  check("and a game Geeboard ships says it is none of that", shipped.community === false && shipped.retired === false && shipped.revision === null);

  console.log("\n== a node that has not said it will run an image somebody chose ==");
  const node = await db.node.findUniqueOrThrow({ where: { name: "fra-node-02" } });
  await db.node.update({ where: { id: node.id }, data: { capabilities: ["docker", "ipv6"] } });
  const plain = await profileOf(await db.node.findUniqueOrThrow({ where: { id: node.id } }));
  const refused = cannotRun(checkCompatibility(findGame("community-echo")!, plain, { memoryGb: 1, cpuLimit: 50, diskGb: 5 }));
  check("it is refused, naming the capability", refused.length > 0 && refused.some((r) => /Community games/.test(r)), refused.join(" | "));
  const asked = await createServerOp(owner, { name: "Echo One", host: "echo1.ashfold.gg", gameId: "community-echo", versionId: "r1", templateId: "default", nodeName: "fra-node-02", memoryGb: 1, cpuLimit: 50, diskGb: 5 });
  check("and a create there is refused with that sentence, writing nothing", !asked.ok && /Community games/.test(asked.body) && (await db.server.count({ where: { gameId: "community-echo" } })) === 0, JSON.stringify(asked));
  await db.node.update({ where: { id: node.id }, data: { capabilities: ["docker", "ipv6", "community-games"] } });
  const consenting = await profileOf(await db.node.findUniqueOrThrow({ where: { id: node.id } }));
  check("with the node's own declaration it is accepted", cannotRun(checkCompatibility(findGame("community-echo")!, consenting, { memoryGb: 1, cpuLimit: 50, diskGb: 5 })).length === 0);
  const wrongPlace = await db.node.findUniqueOrThrow({ where: { name: "ash-node-01" } });
  const elsewhere = cannotRun(checkCompatibility(findGame("community-echo")!, await profileOf(wrongPlace), { memoryGb: 1, cpuLimit: 50, diskGb: 5 }));
  check("and a node that never declared it is still refused", elsewhere.some((r) => /Community games/.test(r)));

  console.log("\n== a real agent makes a real container from the image, by digest ==");
  agent = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: { ...process.env, GEEBOARD_DAEMON_TOKEN: TOKEN, GEEBOARD_DAEMON_PORT: String(PORT), GEEBOARD_NODE_NAME: "fra-node-02", GEEBOARD_MANAGED_LABEL: LABEL, GEEBOARD_DATA_ROOT: dataRoot },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/health`)).ok, "agent");
  await db.node.update({ where: { id: node.id }, data: { daemonUrl: `http://127.0.0.1:${PORT}`, daemonToken: encryptSecret(TOKEN), state: "HEALTHY", lastSeenAt: new Date(), lastReachedAt: new Date() } });
  const created = await createServerOp(owner, {
    name: "Echo One",
    host: "echo1.ashfold.gg",
    gameId: "community-echo",
    versionId: "r1",
    templateId: "default",
    config: { motd: "from a manifest", joinPassword: "hunter2" },
    nodeName: "fra-node-02",
    memoryGb: 1,
    cpuLimit: 50,
    diskGb: 5,
  });
  check("a server is created from the game", created.ok, JSON.stringify(created));
  const server = await db.server.findUniqueOrThrow({ where: { slug: "echo-one" } });
  check("it is the game's, on the family the manifest named", server.gameId === "community-echo" && server.game === "Echo Community");
  const container = server.runtimeId ? await docker.getContainer(server.runtimeId).inspect() : null;
  check("Docker made a container from the digest, and not from a tag", container?.Config.Image === IMAGE, String(container?.Config.Image));
  check("it is running, and its console says what the game prints", container?.State.Running === true);
  const logs = server.runtimeId ? ((await docker.getContainer(server.runtimeId).logs({ stdout: true, stderr: true, tail: 20 })) as unknown as Buffer).toString("latin1") : "";
  check("the game's own start command ran: it printed up", /\bup\b/.test(logs), logs.slice(0, 80));
  const host = container?.HostConfig;
  check("the container is not privileged and has no added capabilities, devices or host network", host?.Privileged === false && !(host?.CapAdd?.length) && !(host?.Devices?.length) && host?.NetworkMode !== "host" && host?.PidMode === "", JSON.stringify({ p: host?.Privileged, c: host?.CapAdd, n: host?.NetworkMode }));
  check("its only mount from the node is the server's own folder", (host?.Binds ?? []).length === 1 && (host?.Binds ?? [])[0]!.startsWith(dataRoot.replace(/\\/g, "\\")) === true, JSON.stringify(host?.Binds));
  check("the setting reached it as the manifest said", (container?.Config.Env ?? []).includes("MOTD=from a manifest"));
  const created2 = await db.activityEvent.findFirst({ where: { action: "server.created", target: "Echo One" } });
  check("the creation line says the game, and holds no password", created2 !== null && !JSON.stringify(created2).includes("hunter2"));

  console.log("\n== retired: out of the wizard, and the server goes on ==");
  const retired = await community.retireGameOp(devi, "community-echo");
  check("an admin may retire it", retired.ok && /1 server/.test(retired.body), JSON.stringify(retired));
  check("it is no longer offered", !allGames().some((g) => g.id === "community-echo"));
  const goneShape = gameShape(findGame("community-echo")!, (await community.approvedRevisions()).get("community-echo"));
  check("the API says it is retired and names no revision", goneShape.community === true && goneShape.retired === true && goneShape.revision === null, JSON.stringify(goneShape.revision));
  check("but it is still found, so its server is still known", findGame("community-echo")?.id === "community-echo");
  const refusedNew = await createServerOp(owner, { name: "Echo Two", host: "echo2.ashfold.gg", gameId: "community-echo", versionId: "r1", templateId: "default", nodeName: "fra-node-02", memoryGb: 1, cpuLimit: 50, diskGb: 5 });
  check("a new server of it is refused, saying it was retired", !refusedNew.ok && /has been retired/.test(refusedNew.body), JSON.stringify(refusedNew));
  check("and nothing was written for it", (await db.server.count({ where: { slug: "echo-two" } })) === 0);
  check("the server and its container are untouched", (await db.server.findUniqueOrThrow({ where: { slug: "echo-one" } })).state !== "ERROR" && (await docker.getContainer(server.runtimeId!).inspect()).State.Running === true);
  check("the catalog marks the game retired and keeps its row", (await db.game.findUnique({ where: { id: "community-echo" } }))?.retiredAt !== null);
  const leftover = await runChild("community-echo");
  check("a second process sees it retired too: found, and not listed", leftover.found && !leftover.listed, JSON.stringify(leftover));
  await deleteServerOp(owner, "echo-one", "Echo One");

  console.log("\n== the registries an image may come from ==");
  const fresh2 = await community.submitManifestOp(devi, JSON.stringify(manifest({ id: "community-quay", name: "Quay", versions: [{ ...manifest().versions[0], image: `quay.io/org/echo@${DIGEST}` }] })));
  check("quay.io is refused by default", !fresh2.ok && /quay\.io is not on this workspace's list/.test(JSON.stringify(fresh2.problems)), JSON.stringify(fresh2));
  const byAdminList = await community.setRegistriesOp(devi, ["docker.io", "quay.io"]);
  check("an admin may not widen the list", !byAdminList.ok && byAdminList.title === "Not permitted");
  const widened = await community.setRegistriesOp(owner, ["docker.io", "ghcr.io", "quay.io"]);
  check("the owner may", widened.ok, JSON.stringify(widened));
  const quay = await community.submitManifestOp(devi, JSON.stringify(manifest({ id: "community-quay", name: "Quay", versions: [{ ...manifest().versions[0], image: `quay.io/org/echo@${DIGEST}` }] })));
  check("and then it is accepted as a proposal", quay.ok, JSON.stringify(quay));
  check("an empty list is refused, and so is a name that is not a host", !(await community.setRegistriesOp(owner, [])).ok && !(await community.setRegistriesOp(owner, ["https://quay.io/x"])).ok);
  await community.setRegistriesOp(owner, ["docker.io", "ghcr.io"]);
  const quayRow = await db.gameManifest.findFirstOrThrow({ where: { gameId: "community-quay" } });
  const lateRefusal = await community.approveManifestOp(await asOwner(), quayRow.id, { hash: quayRow.hash, code: await fresh() });
  check("narrowing the list again stops a proposal from being approved: it is checked against the list as it is now", !lateRefusal.ok && lateRefusal.title === "It no longer passes" && /quay\.io/.test(lateRefusal.body), JSON.stringify(lateRefusal));
  check("while a game already approved is not unapproved by a change to the list", (await db.gameManifest.count({ where: { gameId: "community-echo", state: "RETIRED" } })) === 1);

  console.log("\n== turning one down ==");
  const rejected = await community.rejectManifestOp(devi, quayRow.id, "not from a registry we use\u0007");
  check("an admin may turn a waiting one down", rejected.ok, JSON.stringify(rejected));
  const row = await db.gameManifest.findUniqueOrThrow({ where: { id: quayRow.id } });
  check("it is REJECTED, with the note cleaned of control characters", row.state === "REJECTED" && row.note === "not from a registry we use", JSON.stringify([row.state, row.note]));
  check("a decided one cannot be decided again", !(await community.rejectManifestOp(devi, quayRow.id)).ok && !(await community.approveManifestOp(await asOwner(), quayRow.id, { hash: quayRow.hash, code: await fresh() })).ok);

  console.log("\n== nothing a manifest carries is where it should not be ==");
  const everything = JSON.stringify(await db.activityEvent.findMany({ where: { action: { startsWith: "community." } } }));
  check("the audit log holds names, hashes and counts, never a password, a setting or an expression", !everything.includes("hunter2") && !everything.includes("^up$") && !everything.includes("from a manifest"));
  check("each step is a line: proposed, refused, approved, rejected, retired, registries", ["proposed", "refused", "approved", "rejected"].every((a) => everything.includes(`community.manifest.${a}`)) && everything.includes("community.game.retired") && everything.includes("community.registries.changed"));
} finally {
  agent?.kill();
  for (const c of await docker.listContainers({ all: true, filters: { label: [LABEL] } })) await docker.getContainer(c.Id).remove({ force: true, v: true }).catch(() => {});
  if (dataRoot) await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
  await db.server.deleteMany({ where: { gameId: { startsWith: "community-" } } }).catch(() => {});
  await db.game.deleteMany({ where: { id: { startsWith: "community-" } } }).catch(() => {});
  await db.gameManifest.deleteMany().catch(() => {});
  await db.communityPolicy.deleteMany().catch(() => {});
  setCommunityGames({ active: [], retired: [] });
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
