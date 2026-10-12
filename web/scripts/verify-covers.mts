import "./load-env.mts";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import process from "node:process";
import { SVG, png } from "../test/fixtures/poster-images.ts";

/* The panel fetches each game's poster once, keeps it in its own database, and serves it offline. Against a stand-in for the CDNs (it
   answers for the real host names, through a transport that sends the panel's requests to it, so the allow-list is the real one; it can
   answer 304, 404, a redirect, an SVG called a JPEG, a file too large, and another image than the one a definition pins; and it writes down
   every request) and a real Postgres. What is proved: GEEBOARD_COVERS=off makes no request and the pages get nothing; the poller stores a
   poster it was given and refuses what is not one, keeping what it had; a request carries nothing about this panel; the schedule (a month
   after a fetch that worked, an hour, six hours, a day after one that failed, at once for a new source); the route serves the stored bytes
   with the headers a picture needs to a signed-in person who may read the games and to nobody else; and with the network gone the pages
   still have every poster the database has. */

process.env.GEEBOARD_VERSION = "0.12.0";
const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
await seed();
const ops = await import("../src/lib/poster-ops");
const read = await import("../src/lib/game-posters");
const route = await import("../src/app/games/[id]/poster/route");
const { GuardedFailure, guardedFetch } = await import("../src/lib/net/guarded-fetch");
const { judgePosterAddresses } = await import("../src/domain/games/poster");

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
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/* ── The CDNs ── */
const STEAM = "shared.akamai.steamstatic.com";
const STORE = "store-images.s-microsoft.com";
const steamPath = (app: number, file = "library_600x900_2x.jpg") => `/store_item_assets/steam/apps/${app}/${file}`;

interface Served {
  status: number;
  body?: Buffer;
  type?: string;
  etag?: string;
  location?: string;
}
const served = new Map<string, Served>();
const serve = (host: string, path: string, answer: Served) => served.set(`${host}${path}`, answer);
interface Seen {
  host: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
}
const seen: Seen[] = [];

const cdn = createServer((req: IncomingMessage, res: ServerResponse) => {
  // The transport puts the real host first in the path: /<host>/<path>.
  const [, host = "", ...rest] = (req.url ?? "").split("?")[0]!.split("/");
  const path = `/${rest.join("/")}`;
  seen.push({ host, path, headers: { ...req.headers } });
  const answer = served.get(`${host}${path}`) ?? { status: 404 };
  if (answer.status === 200 && answer.etag && req.headers["if-none-match"] === answer.etag) {
    res.writeHead(304, { etag: answer.etag });
    res.end();
    return;
  }
  res.writeHead(answer.status, {
    ...(answer.type ? { "content-type": answer.type } : {}),
    ...(answer.etag ? { etag: answer.etag } : {}),
    ...(answer.location ? { location: answer.location } : {}),
    ...(answer.body ? { "content-length": String(answer.body.length) } : {}),
  });
  res.end(answer.body);
});
await new Promise<void>((resolve) => cdn.listen(0, "127.0.0.1", resolve));
const port = (cdn.address() as AddressInfo).port;
/* What the panel asked for, sent to the stand-in. The address it hands over is the real one, after the panel's own allow-list judged it;
   a redirect is handed back to the panel to judge, as the guarded fetch does. */
const transport: import("../src/lib/poster-ops").PosterTransport = (url, headers) =>
  fetch(`http://127.0.0.1:${port}/${url.hostname}${url.pathname}${url.search}`, { headers, redirect: "manual" });
const requests = () => seen.length;

/* ── The games, as definitions name their posters ── */
const VALHEIM_1 = png(400, 600, 1);
const GMOD = png(300, 450, 3);
const JAVA = png(200, 300, 4);
const BEDROCK_SERVED = png(200, 300, 5);
const BEDROCK_PINNED = png(200, 300, 6);
const javaSource = { url: `https://${STORE}/image/fake-java`, sha256: sha(JAVA), width: 200, height: 300 };
let games: Array<{ id: string; poster: import("../src/domain/games/types").PosterSource }> = [
  { id: "valheim", poster: { steam: 892970 } },
  { id: "garrys-mod", poster: { steam: 4000 } },
  { id: "minecraft-java", poster: javaSource },
  { id: "minecraft-bedrock", poster: { url: `https://${STORE}/image/fake-bedrock`, sha256: sha(BEDROCK_PINNED), width: 200, height: 300 } },
  { id: "terraria", poster: { steam: 105600 } },
  { id: "project-zomboid", poster: { steam: 108600 } },
];
serve(STEAM, steamPath(892970), { status: 200, body: VALHEIM_1, type: "image/jpeg", etag: '"v1"' });
// Garry's Mod's store page has only the smaller poster: the larger is a 404, and the next address is asked.
serve(STEAM, steamPath(4000, "library_600x900.jpg"), { status: 200, body: GMOD, type: "image/jpeg" });
serve(STORE, "/image/fake-java", { status: 200, body: JAVA, type: "image/jpeg" });
serve(STORE, "/image/fake-bedrock", { status: 200, body: BEDROCK_SERVED, type: "image/jpeg" });
serve(STEAM, steamPath(105600), { status: 200, body: SVG, type: "image/jpeg" });
serve(STEAM, steamPath(108600), { status: 200, body: Buffer.concat([png(400, 600, 9), Buffer.alloc(2 * 1024 * 1024, 7)]), type: "image/jpeg" });

const T0 = new Date("2026-10-12T10:00:00Z");
const H = 3600_000;
const D = 24 * H;
const at = (ms: number) => new Date(T0.getTime() + ms);
const refresh = (when: Date, extra: Partial<import("../src/lib/poster-ops").RefreshOptions> = {}) => ops.refreshPosters({ now: when, env: {}, transport, games, ...extra });
const row = (gameId: string) => db.gamePoster.findUnique({ where: { gameId } });
const outcome = (report: { outcomes: Array<{ game: string; result: string; why?: string }> }, game: string) => report.outcomes.find((o) => o.game === game);
const ALL_IDS = ["valheim", "garrys-mod", "minecraft-java", "minecraft-bedrock", "terraria", "project-zomboid", "community-terraria", "no-such-game"];

const tomas = await db.user.findUniqueOrThrow({ where: { email: "tomas@ashfold.gg" } });
const devi = await db.user.findUniqueOrThrow({ where: { email: "devi@ashfold.gg" } });
const member = await db.user.create({ data: { email: "pia@ashfold.gg", name: "Pia Member", initials: "PM", role: "MEMBER", passwordHash: "not a hash: nobody signs in as Pia", passwordSetAt: new Date() } });
const ask = (gameId: string, query = "", headers: Record<string, string> = {}) => new Request(`http://127.0.0.1:3620/games/${gameId}/poster${query}`, { headers });

try {
  await db.gamePoster.deleteMany();

  console.log("\n== GEEBOARD_COVERS=off ==");
  let r = await refresh(T0, { env: { GEEBOARD_COVERS: "off" } });
  check("asks nobody", !r.ran && r.skipped === "off" && requests() === 0, JSON.stringify(r));
  check("and writes nothing", (await db.gamePoster.count()) === 0);

  console.log("\n== the first look ==");
  r = await refresh(T0);
  check("it ran, for the six games", r.ran && r.outcomes.length === 6, JSON.stringify(r.outcomes));
  check("Valheim's poster is stored", outcome(r, "valheim")?.result === "stored", JSON.stringify(outcome(r, "valheim")));
  check("Garry's Mod's, from the smaller address after a 404 for the larger", outcome(r, "garrys-mod")?.result === "stored" && seen.some((s) => s.path === steamPath(4000)) && seen.some((s) => s.path === steamPath(4000, "library_600x900.jpg")));
  check("Minecraft Java's, at the fixed address, with the hash the definition names", outcome(r, "minecraft-java")?.result === "stored");
  const bedrock = outcome(r, "minecraft-bedrock");
  check("another image than the one Bedrock's definition pins is not stored, and the reason says the site moved or changed it", bedrock?.result === "refused" && /not the one the definition names/.test(bedrock.why ?? "") && /moved or changed/.test(bedrock.why ?? ""), JSON.stringify(bedrock));
  const terraria = outcome(r, "terraria");
  check("an SVG the server calls a JPEG is refused, for what its bytes are", terraria?.result === "refused" && /not a JPEG, PNG or WebP/.test(terraria.why ?? ""), JSON.stringify(terraria));
  const zomboid = outcome(r, "project-zomboid");
  check("a file of more than 2 MB is refused", zomboid?.result === "refused" && /larger than 2 MB/.test(zomboid.why ?? ""), JSON.stringify(zomboid));

  const sent = seen[0]!.headers;
  check("a request says what it is, with the name every request of the panel carries", /^Geeboard\/0\.12\.0 \(\+https:\/\/github\.com\/DanieleMarino70\/Geeboard\)$/.test(String(sent["user-agent"])), String(sent["user-agent"]));
  check("and asks for the original JPEG or PNG, never AVIF", sent["accept"] === "image/jpeg, image/png", String(sent["accept"]));
  check("and nothing else about this panel: no cookie, no credential, no referrer, no address", !["cookie", "authorization", "referer", "x-forwarded-for", "x-request-id"].some((h) => seen.some((s) => h in s.headers)));
  check("and no request was conditional the first time", seen.every((s) => !("if-none-match" in s.headers) && !("if-modified-since" in s.headers)));

  let v = await row("valheim");
  check(
    "the row has the bytes, their type, hash and size, where they came from, and when to ask again",
    v !== null &&
      Buffer.from(v.bytes!).equals(VALHEIM_1) &&
      v.contentType === "image/png" &&
      v.sha256 === sha(VALHEIM_1) &&
      v.width === 400 &&
      v.height === 600 &&
      v.sourceUrl === `https://${STEAM}${steamPath(892970)}` &&
      v.sourceKey === "steam:892970" &&
      v.etag === '"v1"' &&
      v.fetchedAt?.getTime() === T0.getTime() &&
      v.nextAttemptAt?.getTime() === at(30 * D).getTime() &&
      v.failures === 0 &&
      v.error === null,
    JSON.stringify({ ...v, bytes: v?.bytes?.length }),
  );
  const b = await row("minecraft-bedrock");
  check("a refused poster leaves no bytes, counts a failure, waits an hour and says why", b !== null && b.bytes === null && b.failures === 1 && b.nextAttemptAt?.getTime() === at(H).getTime() && /moved or changed/.test(b.error ?? ""), JSON.stringify({ ...b, bytes: null }));

  console.log("\n== what the pages read ==");
  let posters = await read.postersFor(ALL_IDS);
  check("the three stored, and nothing for the rest: those are drawn", [...posters.keys()].sort().join() === "garrys-mod,minecraft-java,valheim", JSON.stringify([...posters]));
  const ref = posters.get("valheim");
  check("each with its address, carrying the start of its hash, and its size", ref?.src === `/games/valheim/poster?v=${sha(VALHEIM_1).slice(0, 12)}` && ref.width === 400 && ref.height === 600, JSON.stringify(ref));
  check("an empty list asks nothing", (await read.postersFor([])).size === 0);

  console.log("\n== the route ==");
  const v12 = sha(VALHEIM_1).slice(0, 12);
  let res = await read.posterResponse(ask("valheim", `?v=${v12}`), "valheim", tomas);
  const body = Buffer.from(await res.arrayBuffer());
  check("a signed-in moderator gets the stored bytes", res.status === 200 && body.equals(VALHEIM_1), String(res.status));
  check("as the type its bytes are, with nosniff", res.headers.get("content-type") === "image/png" && res.headers.get("x-content-type-options") === "nosniff");
  check("under a policy that lets the file do nothing but be shown", /default-src 'none'/.test(res.headers.get("content-security-policy") ?? "") && /sandbox/.test(res.headers.get("content-security-policy") ?? ""), res.headers.get("content-security-policy") ?? "");
  check("cached by this browser only, for a year, when the address carries the hash", res.headers.get("cache-control") === "private, max-age=31536000, immutable" && res.headers.get("etag") === `"${sha(VALHEIM_1)}"`, `${res.headers.get("cache-control")} ${res.headers.get("etag")}`);
  res = await read.posterResponse(ask("valheim"), "valheim", tomas);
  check("asked again each time when it does not", res.headers.get("cache-control") === "private, no-cache");
  res = await read.posterResponse(ask("valheim", "", { "if-none-match": `"${sha(VALHEIM_1)}"` }), "valheim", tomas);
  check("and answered 304 while it is the same image", res.status === 304 && (await res.arrayBuffer()).byteLength === 0);
  res = await read.posterResponse(ask("valheim"), "valheim", member);
  check("a member, who may read the games, gets it too", res.status === 200);
  res = await read.posterResponse(ask("valheim"), "valheim", null);
  check("nobody signed in gets 401", res.status === 401 && res.headers.get("cache-control") === "no-store");
  res = await route.GET(ask("valheim"), { params: Promise.resolve({ id: "valheim" }) });
  check("and so does the route itself, asked with no session", res.status === 401, String(res.status));
  res = await read.posterResponse(ask("valheim"), "valheim", devi);
  check("an admin who has not set up two-factor gets 403, as every page sends them to their account", res.status === 403);
  for (const id of ["minecraft-bedrock", "no-such-game", "community-terraria"]) {
    res = await read.posterResponse(ask(id), id, tomas);
    check(`a game with nothing stored (${id}) is a 404: its cover is drawn`, res.status === 404);
  }

  console.log("\n== how often ==");
  let before = requests();
  r = await refresh(at(10 * 60_000));
  check("ten minutes later nothing is due, and nobody is asked", r.outcomes.length === 0 && requests() === before, JSON.stringify(r.outcomes));
  r = await refresh(at(61 * 60_000));
  check("an hour after the failures, the three refused are asked again", r.outcomes.map((o) => o.game).sort().join() === "minecraft-bedrock,project-zomboid,terraria", JSON.stringify(r.outcomes));
  check("and the next wait is six hours", (await row("terraria"))?.failures === 2 && (await row("terraria"))?.nextAttemptAt?.getTime() === at(61 * 60_000 + 6 * H).getTime());
  before = requests();
  r = await refresh(at(5 * H));
  check("five hours on, still waiting", r.outcomes.length === 0 && requests() === before);
  r = await refresh(at(8 * H));
  check("after six, asked, and then a day", r.outcomes.length === 3 && (await row("terraria"))?.nextAttemptAt?.getTime() === at(8 * H + D).getTime() && (await row("terraria"))?.failures === 3);
  r = await refresh(at(8 * H + D + 60_000));
  check("and a day for as long as it goes on", r.outcomes.length === 3 && (await row("terraria"))?.nextAttemptAt?.getTime() === at(8 * H + 2 * D + 60_000).getTime());

  console.log("\n== a month later ==");
  const month = at(31 * D);
  before = seen.length;
  r = await refresh(month);
  const valheimAsk = seen.slice(before).find((s) => s.path === steamPath(892970));
  check("a stored poster is asked about again, with the ETag it came with", valheimAsk?.headers["if-none-match"] === '"v1"', JSON.stringify(valheimAsk?.headers));
  check("an unchanged image is a 304, and kept", outcome(r, "valheim")?.result === "unchanged" && Buffer.from((await row("valheim"))!.bytes!).equals(VALHEIM_1));
  v = await row("valheim");
  check("the row says when it was asked and when to ask next, and when the bytes came is still the first time", v?.checkedAt?.getTime() === month.getTime() && v.nextAttemptAt?.getTime() === month.getTime() + 30 * D && v.fetchedAt?.getTime() === T0.getTime());
  check("an address that gives no ETag gives the same bytes, which are the same poster", outcome(r, "minecraft-java")?.result === "unchanged");

  console.log("\n== the site changes the image ==");
  const JAVA_CHANGED = png(200, 300, 7);
  serve(STORE, "/image/fake-java", { status: 200, body: JAVA_CHANGED, type: "image/jpeg" });
  // And Steam its own, which is the store's to change: both are looked at in the same pass.
  const VALHEIM_2 = png(400, 600, 2);
  serve(STEAM, steamPath(892970), { status: 200, body: VALHEIM_2, type: "image/jpeg", etag: '"v2"' });
  r = await refresh(at(62 * D));
  const java = outcome(r, "minecraft-java");
  check("another image at Java's pinned address is not stored, and the log line says why", java?.result === "refused" && /moved or changed/.test(java.why ?? ""), JSON.stringify(java));
  const javaRow = await row("minecraft-java");
  check("the poster stored before stays, as it was", Buffer.from(javaRow!.bytes!).equals(JAVA) && javaRow!.sha256 === sha(JAVA) && javaRow!.failures === 1 && /moved or changed/.test(javaRow!.error ?? ""));
  check("and the pages still show it", (await read.postersFor(["minecraft-java"])).get("minecraft-java")?.src === `/games/minecraft-java/poster?v=${sha(JAVA).slice(0, 12)}`);

  console.log("\n== Steam changes its poster ==");
  check("a Steam poster is the store's to change: the new one is stored", outcome(r, "valheim")?.result === "stored" && Buffer.from((await row("valheim"))!.bytes!).equals(VALHEIM_2), JSON.stringify(outcome(r, "valheim")));
  posters = await read.postersFor(["valheim"]);
  check("and its address changes with it, so no browser keeps the old one", posters.get("valheim")?.src === `/games/valheim/poster?v=${sha(VALHEIM_2).slice(0, 12)}`);

  console.log("\n== a release names another source ==");
  const OTHER = png(400, 600, 8);
  serve(STEAM, steamPath(999), { status: 200, body: OTHER, type: "image/jpeg" });
  games = games.map((g) => (g.id === "valheim" ? { id: g.id, poster: { steam: 999 } } : g));
  r = await refresh(at(62 * D + 60_000));
  check("it is fetched at once, though the row said a month", outcome(r, "valheim")?.result === "stored" && (await row("valheim"))?.sourceKey === "steam:999" && Buffer.from((await row("valheim"))!.bytes!).equals(OTHER), JSON.stringify(outcome(r, "valheim")));
  games = games.map((g) => (g.id === "minecraft-bedrock" ? { id: g.id, poster: { ...g.poster, sha256: sha(BEDROCK_SERVED) } as typeof g.poster } : g));
  r = await refresh(at(62 * D + 2 * 60_000));
  check("a new hash for the same address is a new source too: Bedrock's poster is stored now, whatever the backoff said", outcome(r, "minecraft-bedrock")?.result === "stored", JSON.stringify(outcome(r, "minecraft-bedrock")));

  console.log("\n== where a redirect may lead ==");
  serve(STEAM, steamPath(4000), { status: 302, location: "https://evil.example.net/poster.jpg" });
  serve(STEAM, steamPath(4000, "library_600x900.jpg"), { status: 302, location: "https://evil.example.net/poster.jpg" });
  games = games.map((g) => (g.id === "garrys-mod" ? { id: g.id, poster: { steam: 4001 } } : g));
  serve(STEAM, steamPath(4001), { status: 302, location: "http://shared.akamai.steamstatic.com/plain.jpg" });
  r = await refresh(at(63 * D));
  const hop = outcome(r, "garrys-mod");
  check("a redirect off https is refused, and nothing is asked there", hop?.result === "refused" && /not https/.test(hop.why ?? "") && !seen.some((s) => s.path === "/plain.jpg"), JSON.stringify(hop));
  games = games.map((g) => (g.id === "garrys-mod" ? { id: g.id, poster: { steam: 4002 } } : g));
  serve(STEAM, steamPath(4002), { status: 302, location: "https://evil.example.net/poster.jpg" });
  r = await refresh(at(63 * D + 60_000));
  check("a redirect to a host that is not on the list is refused, and named", /evil\.example\.net, which is not a host posters are fetched from/.test(outcome(r, "garrys-mod")?.why ?? "") && !seen.some((s) => s.host === "evil.example.net"), JSON.stringify(outcome(r, "garrys-mod")));
  games = games.map((g) => (g.id === "garrys-mod" ? { id: g.id, poster: { steam: 4003 } } : g));
  serve(STEAM, steamPath(4003), { status: 302, location: `https://${STEAM}${steamPath(4000, "library_600x900.jpg")}?moved=1` });
  serve(STEAM, steamPath(4000, "library_600x900.jpg"), { status: 200, body: GMOD, type: "image/jpeg" });
  r = await refresh(at(63 * D + 2 * 60_000));
  // The same bytes as the poster it has, from the address the hop led to.
  check("one to another address of the list is followed", outcome(r, "garrys-mod")?.result === "unchanged" && (await row("garrys-mod"))?.sourceUrl === `https://${STEAM}${steamPath(4000, "library_600x900.jpg")}?moved=1`, JSON.stringify([outcome(r, "garrys-mod"), (await row("garrys-mod"))?.sourceUrl]));

  console.log("\n== a listed host that answers from this machine's network ==");
  const lying: import("../src/lib/poster-ops").PosterTransport = (url, headers) =>
    guardedFetch(url, { headers, timeoutMs: 2000, maxBytes: 64, judge: judgePosterAddresses, resolve: async () => ["127.0.0.1"] });
  games = games.map((g) => (g.id === "terraria" ? { id: g.id, poster: { steam: 105601 } } : g));
  r = await refresh(at(64 * D), { transport: lying });
  check("is not called: the guarded fetch judges every address the name gave", /not on the internet/.test(outcome(r, "terraria")?.why ?? ""), JSON.stringify(outcome(r, "terraria")));

  console.log("\n== the network is gone ==");
  const offline: import("../src/lib/poster-ops").PosterTransport = async () => {
    throw new GuardedFailure("does not resolve", "ENOTFOUND");
  };
  const stored = [...(await read.postersFor(ALL_IDS)).keys()].sort().join();
  r = await refresh(at(200 * D), { transport: offline });
  check("every poster that was due fails, in a sentence naming the host and no path", r.outcomes.length > 0 && r.outcomes.every((o) => o.result === "failed" && /^(shared\.akamai\.steamstatic\.com|store-images\.s-microsoft\.com) does not resolve$/.test(o.why ?? "")), JSON.stringify(r.outcomes));
  check("and the pages still have every poster the database has", [...(await read.postersFor(ALL_IDS)).keys()].sort().join() === stored && stored.split(",").length >= 4, stored);
  res = await read.posterResponse(ask("valheim"), "valheim", tomas);
  check("and the route still serves them", res.status === 200 && Buffer.from(await res.arrayBuffer()).equals(OTHER));

  console.log("\n== GEEBOARD_COVERS=off, with posters stored ==");
  process.env.GEEBOARD_COVERS = "off";
  before = requests();
  r = await ops.refreshPosters({ now: at(400 * D), transport, games });
  check("the poller asks nobody", !r.ran && requests() === before);
  check("the pages get no poster, and draw every cover", (await read.postersFor(ALL_IDS)).size === 0);
  check("and the route serves none", (await read.posterResponse(ask("valheim"), "valheim", tomas)).status === 404);
  delete process.env.GEEBOARD_COVERS;
  check("on again, they are there", (await read.postersFor(ALL_IDS)).size >= 4);

  console.log("\n== a game that names no poster any more ==");
  games = games.filter((g) => g.id !== "minecraft-java");
  r = await refresh(at(401 * D));
  check("its row goes, and its cover is drawn", r.removed === 1 && (await row("minecraft-java")) === null, JSON.stringify(r.removed));
} finally {
  await db.gamePoster.deleteMany();
  cdn.close();
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
