import "./load-env.mts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import process from "node:process";

/* The panel finds out that a newer Geeboard is out. Against a stand-in for the place the release file lives (it can answer 304 for an ETag it
   gave, redirect as GitHub does, fail in every way a server fails, and writes down every request it gets) and a real Postgres. What is proved:
   a request is made at most every twelve hours (an hour after a failure, never twice in half a minute for the button), it carries nothing about
   this panel, a failure is a sentence in the row and keeps the release that was known, a file that is not a release file is refused for the
   reason, and the audit line that the notification channels read is written once for a release and what it makes of this panel and its agents. */

process.env.GEEBOARD_VERSION = "0.9.0";
const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
await seed();
const ops = await import("../src/lib/panel-update-ops");

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

/* ── The place the file lives ── */
interface Seen {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
}
const seen: Seen[] = [];
let answer: { status: number; body: string; etag: string | null } = { status: 200, body: "", etag: null };
const file = (version: string, extra: Record<string, unknown> = {}) => JSON.stringify({ schema: 1, version, date: "2026-10-09", ...extra });
const serving = (version: string, extra: Record<string, unknown> = {}, etag = `"v-${version}"`) => {
  answer = { status: 200, body: file(version, extra), etag };
};

const stand = createServer((req: IncomingMessage, res: ServerResponse) => {
  seen.push({ method: req.method ?? "", url: req.url ?? "", headers: { ...req.headers } });
  // GitHub answers the stable address with a redirect to the asset's own.
  if (req.url === "/releases/latest/download/release.json") {
    res.writeHead(302, { location: "/assets/release.json" });
    res.end();
    return;
  }
  if (req.headers["if-none-match"] && answer.etag && req.headers["if-none-match"] === answer.etag && answer.status === 200) {
    res.writeHead(304, { etag: answer.etag });
    res.end();
    return;
  }
  res.writeHead(answer.status, { "content-type": "application/json", ...(answer.etag ? { etag: answer.etag } : {}) });
  res.end(answer.body);
});
await new Promise<void>((resolve) => stand.listen(0, "127.0.0.1", resolve));
const port = (stand.address() as AddressInfo).port;
const URL_OF = `http://127.0.0.1:${port}/releases/latest/download/release.json`;
const env = { GEEBOARD_UPDATE_URL: URL_OF };

const T0 = new Date("2026-10-09T10:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const H = 3600_000;
const row = () => db.updateCheck.findUnique({ where: { id: "panel" } });
const events = (action = "panel.update.available") => db.activityEvent.findMany({ where: { action }, orderBy: { createdAt: "asc" } });

try {
  console.log("\n== off, and an address that is not used ==");
  let r = await ops.checkForUpdates({ env: { GEEBOARD_UPDATE_CHECK: "off", ...env }, now: T0 });
  check("GEEBOARD_UPDATE_CHECK=off asks nobody", !r.ran && r.skipped === "off" && seen.length === 0, JSON.stringify(r));
  check("and writes nothing", (await row()) === null);
  r = await ops.checkForUpdates({ env: { GEEBOARD_UPDATE_URL: "http://example.com/release.json" }, now: T0 });
  check("an http address that is not this machine is refused for the reason, without a request", r.ran && !r.ok && /not an https address/.test(r.error ?? "") && seen.length === 0, JSON.stringify(r));
  await db.updateCheck.deleteMany();

  console.log("\n== the first look ==");
  serving("0.9.5", { url: "https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.9.5", changelog: "https://github.com/DanieleMarino70/Geeboard/blob/main/CHANGELOG.md" });
  r = await ops.checkForUpdates({ env, now: T0 });
  check("it reads the file, through the redirect", r.ran && r.ok === true && r.latest === "0.9.5" && r.changed === true, JSON.stringify(r));
  check("one request, plus the redirect it followed", seen.length === 2 && seen[0]!.url === "/releases/latest/download/release.json" && seen[1]!.url === "/assets/release.json", JSON.stringify(seen.map((s) => s.url)));
  const sent = seen[0]!.headers;
  check("it says what it is, with the one name every request of the panel carries, and asks for JSON", /^Geeboard\/0\.9\.0 \(\+https:\/\/github\.com\/DanieleMarino70\/Geeboard\)$/.test(String(sent["user-agent"])) && sent["accept"] === "application/json", String(sent["user-agent"]));
  check(
    "and nothing else about itself: no cookie, no credential, no address, no referrer, no identifier of this installation",
    !["cookie", "authorization", "x-forwarded-for", "referer", "x-geeboard-version", "x-request-id"].some((h) => h in sent),
    JSON.stringify(sent),
  );
  const first = await row();
  check("the row has the release, its ETag and the time", first?.etag === '"v-0.9.5"' && first.checkedAt?.getTime() === T0.getTime() && first.error === null && (first.release as { version?: string } | null)?.version === "0.9.5");

  console.log("\n== how often ==");
  const before = seen.length;
  r = await ops.checkForUpdates({ env, now: later(11 * H) });
  check("within twelve hours it asks nobody", !r.ran && r.skipped === "recent" && seen.length === before, JSON.stringify(r));
  r = await ops.checkForUpdates({ env, now: later(13 * H) });
  const conditional = seen[seen.length - 2]!;
  check("after twelve hours it asks again, with the ETag it was given", r.ran && r.ok === true && conditional.headers["if-none-match"] === '"v-0.9.5"', JSON.stringify(conditional.headers));
  check("an unchanged file is a 304: still the release it knew, and not news", r.latest === "0.9.5" && r.changed === false, JSON.stringify(r));
  r = await ops.checkForUpdates({ env, force: true, now: new Date(later(13 * H).getTime() + 10_000) });
  check("the button is not heard twice in half a minute", !r.ran && r.skipped === "recent", JSON.stringify(r));
  r = await ops.checkForUpdates({ env, force: true, now: new Date(later(13 * H).getTime() + 31_000) });
  check("and is heard after it, whatever the clock says", r.ran && r.ok === true, JSON.stringify(r));

  console.log("\n== what it makes of this panel ==");
  let status = await ops.readUpdateStatus();
  check("this panel is 0.9.0 and the release 0.9.5: an update, not a warning", status.installed === "0.9.0" && status.panel?.state === "update" && ops.wantsAttention(status) === "info", JSON.stringify(status.panel));
  check("the release's links are kept, and they are https", status.release?.url?.startsWith("https://github.com/") === true);
  process.env.GEEBOARD_UPDATE_URL = URL_OF;
  check("the host it reads from is shown, and not a path", (await ops.readUpdateStatus()).source === `127.0.0.1:${port}`, (await ops.readUpdateStatus()).source);
  delete process.env.GEEBOARD_UPDATE_URL;

  console.log("\n== said once ==");
  check("the news is written", (await ops.recordPanelUpdateNews()) === true);
  let news = await events();
  check("as one audit line, by Updates, in the info tone, with what changed", news.length === 1 && news[0]!.actor === "Updates" && news[0]!.tone === "INFO" && news[0]!.target === "Geeboard 0.9.5", JSON.stringify(news));
  const changes = news[0]!.changes as Record<string, { from: string; to: string }>;
  check("naming this release, the state in words, and the link", changes.Release?.to === "0.9.5" && changes.Release?.from === "0.9.0" && changes.State?.to === "Update available" && changes.Link?.to?.startsWith("https://"), JSON.stringify(changes));
  check("and not again while nothing changes", (await ops.recordPanelUpdateNews()) === false && (await events()).length === 1);

  console.log("\n== a security update, a recommended one, and the panel catching up ==");
  serving("0.9.6", { securityFloor: "0.9.5" });
  r = await ops.checkForUpdates({ env, now: later(26 * H) });
  check("a release whose security floor is above this panel is the security state", r.ok === true && r.changed === true && (await ops.readUpdateStatus()).panel?.state === "security");
  check("it is announced again, in the danger tone, as that", (await ops.recordPanelUpdateNews()) === true);
  news = await events();
  check("two lines now, the second a danger", news.length === 2 && news[1]!.tone === "DANGER" && (news[1]!.changes as Record<string, { to: string }>).State?.to === "Security update", JSON.stringify(news.map((n) => n.tone)));
  serving("0.9.7", { recommended: true });
  await ops.checkForUpdates({ env, now: later(39 * H) });
  check("a recommended release is the warning", (await ops.readUpdateStatus()).panel?.state === "recommended" && ops.wantsAttention(await ops.readUpdateStatus()) === "warning");
  await ops.recordPanelUpdateNews();
  check("and its line is a warning", (await events()).at(-1)?.tone === "WARNING");
  serving("0.9.0");
  await ops.checkForUpdates({ env, now: later(52 * H) });
  status = await ops.readUpdateStatus();
  check("a panel on the newest release has nothing to say", status.panel?.state === "current" && ops.wantsAttention(status) === null && (await ops.recordPanelUpdateNews()) === false);
  check("and the next release is news again", (serving("0.9.8"), await ops.checkForUpdates({ env, now: later(65 * H) }), await ops.recordPanelUpdateNews()) === true);

  console.log("\n== the agents ==");
  const nodes = await db.node.findMany({ orderBy: { name: "asc" }, take: 2 });
  await db.node.update({ where: { id: nodes[0]!.id }, data: { daemon: "0.8.1" } });
  await db.node.update({ where: { id: nodes[1]!.id }, data: { daemon: "0.9.0" } });
  serving("0.9.9", { agentFloor: "0.9.0", agentSecurityFloor: "0.9.0" });
  await ops.checkForUpdates({ env, now: later(78 * H) });
  status = await ops.readUpdateStatus();
  const byName = new Map(status.agents.map((a) => [a.node, a.verdict.state]));
  check("an agent below the security floor is that", byName.get(nodes[0]!.name) === "security", JSON.stringify([...byName]));
  check("one on the floor is fine", byName.get(nodes[1]!.name) === "ok");
  check("and is named, with its version, for the page", ops.agentsToUpgrade(status).map((a) => `${a.node}@${a.version}`).join() === `${nodes[0]!.name}@0.8.1`);
  await ops.recordPanelUpdateNews();
  const last = (await events()).at(-1)!;
  check("the line names the agent and is a danger", (last.changes as Record<string, { to: string }>).Agents?.to.includes(`${nodes[0]!.name} (0.8.1: security update)`) === true && last.tone === "DANGER", JSON.stringify(last.changes));

  console.log("\n== every way the answer can be wrong ==");
  serving("0.9.9", { agentFloor: "0.9.0" });
  await ops.checkForUpdates({ env, now: later(91 * H) });
  const known = (await row())!.release as { version: string };
  const fails: Array<[string, () => void, RegExp]> = [
    ["a 500", () => (answer = { status: 500, body: "boom", etag: null }), /answered HTTP 500/],
    ["a 404", () => (answer = { status: 404, body: "", etag: null }), /No release has been published/],
    ["a body that is not JSON", () => (answer = { status: 200, body: "<html>captive portal</html>", etag: null }), /not JSON/],
    ["a body far larger than any release file", () => (answer = { status: 200, body: JSON.stringify({ schema: 1, pad: "x".repeat(100_000) }), etag: null }), /larger than 64 KB/],
    ["a schema this panel does not read", () => (answer = { status: 200, body: JSON.stringify({ schema: 2, version: "1.0.0", date: "2027-01-01" }), etag: null }), /refused: its schema/],
    ["a floor above the release", () => (answer = { status: 200, body: file("0.9.9", { securityFloor: "0.9.10" }), etag: null }), /above the release itself/],
    ["a version that is not one", () => (answer = { status: 200, body: file("latest"), etag: null }), /major\.minor\.patch/],
  ];
  let t = 104;
  for (const [label, arrange, expected] of fails) {
    arrange();
    r = await ops.checkForUpdates({ env, now: later(t * H) });
    check(`${label} is a sentence, not an exception`, r.ran && r.ok === false && expected.test(r.error ?? ""), JSON.stringify(r));
    const after = (await row())!;
    check(`  the row says why, and keeps the release it knew (${known.version})`, expected.test(after.error ?? "") && (after.release as { version: string }).version === known.version);
    t += 13;
  }
  // Nothing listening: the connection is refused.
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const deadPort = (closed.address() as AddressInfo).port;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
  r = await ops.checkForUpdates({ env: { GEEBOARD_UPDATE_URL: `http://127.0.0.1:${deadPort}/x.json` }, now: later(t * H) });
  check("a connection that is refused is a sentence naming the host", r.ran && r.ok === false && new RegExp(`127\\.0\\.0\\.1:${deadPort} could not be reached`).test(r.error ?? ""), JSON.stringify(r));
  const failedAt = later(t * H);
  t += 13;

  console.log("\n== after a failure it tries again sooner, and not at once ==");
  serving("0.9.9", { agentFloor: "0.9.0" });
  r = await ops.checkForUpdates({ env, now: new Date(failedAt.getTime() + 50 * 60_000) });
  check("fifty minutes later, still waiting", !r.ran && r.skipped === "recent", JSON.stringify(r));
  r = await ops.checkForUpdates({ env, now: new Date(failedAt.getTime() + 61 * 60_000) });
  check("an hour later, it asks, and a good answer clears the error", r.ran && r.ok === true && (await row())!.error === null, JSON.stringify(r));

  console.log("\n== a panel whose database does not have the table ==");
  check("the page's read of it says so and does not throw", typeof (await ops.readUpdateStatus()).unavailable === "boolean");
} finally {
  await db.updateCheck.deleteMany();
  await db.activityEvent.deleteMany({ where: { action: "panel.update.available" } });
  stand.close();
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
