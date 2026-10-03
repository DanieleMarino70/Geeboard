import "./load-env.mts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import process from "node:process";

/* DNS records for servers, against a fake Cloudflare and a fake DuckDNS
   on local ports: nothing under example.com or duckdns.org is touched.
   The fakes are stood up before the clients are imported, since each
   client reads its base URL when it loads. */

const CF_TOKEN = "cf-token-verify-0123456789abcdef";
const DUCK_TOKEN = "duck-token-verify-0123456789abcdef";

type CfRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  comment?: string | null;
  proxied?: boolean;
  ttl?: number;
  priority?: number;
  data?: { priority: number; weight: number; port: number; target: string };
};
/* Cloudflare keeps an SRV record's numbers in `data`, and reports `content` as `weight port target` with the priority
   beside it. The fake does the same, so the panel is read the way the real thing would read it. */
const asCloudflare = (body: Omit<CfRecord, "id">): Omit<CfRecord, "id"> =>
  body.type === "SRV" && body.data ? { ...body, content: `${body.data.weight} ${body.data.port} ${body.data.target}`, priority: body.data.priority } : body;
const cfRecords = new Map<string, CfRecord>();
const cfCalls: string[] = [];
let cfMode: "ok" | "down" | "forbidden" = "ok";
let cfSeq = 0;
const cf = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://fake");
  cfCalls.push(`${req.method} ${url.pathname}`);
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (cfMode === "down") return json(500, { success: false, errors: [{ code: 1000, message: "internal error" }] });
    if (cfMode === "forbidden" || req.headers.authorization !== `Bearer ${CF_TOKEN}`) {
      return json(403, { success: false, errors: [{ code: 9109, message: "Invalid access token" }] });
    }
    const body = raw ? (JSON.parse(raw) as Omit<CfRecord, "id">) : null;
    if (url.pathname === "/user/tokens/verify") return json(200, { success: true, result: { status: "active" } });
    if (url.pathname === "/zones") {
      const wanted = url.searchParams.get("name");
      return json(200, { success: true, result: wanted === "example.com" ? [{ id: "zone1", name: "example.com" }] : [] });
    }
    const m = /^\/zones\/zone1\/dns_records(?:\/([^/]+))?$/.exec(url.pathname);
    if (!m) return json(404, { success: false, errors: [{ code: 7000, message: "No route for that URI" }] });
    const id = m[1];
    if (req.method === "GET" && !id) {
      const name = url.searchParams.get("name");
      return json(200, { success: true, result: [...cfRecords.values()].filter((r) => !name || r.name === name) });
    }
    if (req.method === "POST" && body) {
      const rid = `rec${++cfSeq}`;
      cfRecords.set(rid, { id: rid, ...asCloudflare(body) });
      return json(200, { success: true, result: cfRecords.get(rid) });
    }
    if (req.method === "PUT" && id && body) {
      if (!cfRecords.has(id)) return json(404, { success: false, errors: [{ code: 81044, message: "Record does not exist" }] });
      cfRecords.set(id, { id, ...asCloudflare(body) });
      return json(200, { success: true, result: cfRecords.get(id) });
    }
    if (req.method === "DELETE" && id) {
      cfRecords.delete(id);
      return json(200, { success: true, result: { id } });
    }
    return json(405, { success: false, errors: [{ code: 7001, message: "Method not allowed" }] });
  });
});

const duckSubs = new Map<string, string | null>([
  ["check", "203.0.113.1"],
  ["verify", null],
  ["verify2", null],
  ["verify3", null],
  ["verifyw", null],
]);
// The IPv6 address of a subdomain, beside the IPv4 one in duckSubs: DuckDNS holds one of each.
const duckSubs6 = new Map<string, string | null>();
const duckCalls: string[] = [];
let duckMode: "ok" | "down" = "ok";
const duck = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://fake");
  const shown = new URLSearchParams(url.searchParams);
  shown.delete("token");
  duckCalls.push(`${url.pathname}?${shown.toString()}`);
  const text = (status: number, body: string) => {
    res.writeHead(status, { "content-type": "text/plain" });
    res.end(body);
  };
  if (duckMode === "down") return text(500, "");
  if (url.pathname !== "/update") return text(404, "");
  if (url.searchParams.get("token") !== DUCK_TOKEN) return text(200, "KO");
  const subs = (url.searchParams.get("domains") ?? "").split(",").filter(Boolean);
  if (subs.length === 0 || subs.some((s) => !duckSubs.has(s))) return text(200, "KO");
  for (const s of subs) {
    if (url.searchParams.get("clear") === "true") {
      duckSubs.set(s, null);
      duckSubs6.set(s, null);
    } else if (url.searchParams.get("ip")) duckSubs.set(s, url.searchParams.get("ip"));
    else if (url.searchParams.get("ipv6")) duckSubs6.set(s, url.searchParams.get("ipv6"));
    else duckSubs.set(s, "198.18.0.1"); // the caller's address, as DuckDNS would
  }
  const first = duckSubs.get(subs[0]!) ?? "";
  return text(200, url.searchParams.get("verbose") === "true" ? `OK\n${first}\n\nUPDATED` : "OK");
});

await new Promise<void>((r) => cf.listen(0, "127.0.0.1", r));
await new Promise<void>((r) => duck.listen(0, "127.0.0.1", r));
process.env.CLOUDFLARE_API_BASE = `http://127.0.0.1:${(cf.address() as AddressInfo).port}`;
process.env.DUCKDNS_BASE = `http://127.0.0.1:${(duck.address() as AddressInfo).port}`;
process.env.DUCKDNS_PROBE_ADDRESS = "203.0.113.1";

const { db } = await import("../src/lib/db");
const dns = await import("../src/lib/dns-ops");
const ops = await import("../src/lib/server-ops");
const create = await import("../src/lib/create-ops");
const nodeOps = await import("../src/lib/node-ops");
const rules = await import("../src/domain/dns/rules");
const shape = await import("../src/app/api/v1/_shape");
const { seed } = await import("../prisma/seed");
await seed();
await db.dnsProvider.deleteMany();

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

const mara = (await db.user.findUnique({ where: { email: "mara@ashfold.gg" } }))!;
const tomas = (await db.user.findUnique({ where: { email: "tomas@ashfold.gg" } }))!;
const NODE = "ash-node-01";
const nodeRow = async () => (await db.node.findUnique({ where: { name: NODE } }))!;
const setAddress = (publicAddress: string) =>
  nodeRow().then((n) => nodeOps.updateNodeDetailsOp(mara, NODE, { city: n.city, region: n.region, publicAddress }));
const serverOf = async (slug: string) => (await db.server.findUnique({ where: { slug }, include: { node: true, dnsRecords: true } }))!;
type Served = Awaited<ReturnType<typeof serverOf>>;
const recOf = (s: Served, kind = "A") => s.dnsRecords.find((r) => r.kind === kind);
const addrOf = (s: Served) => recOf(s)?.content ?? null;
const errOf = (s: Served) => s.dnsRecords.find((r) => r.error)?.error ?? null;
// Make a server's records look five minutes and a bit old, so the poller tries again.
const age = (serverId: string) => db.serverDnsRecord.updateMany({ where: { serverId }, data: { checkedAt: new Date(Date.now() - 6 * 60_000) } });
const spec = (name: string, host: string) => ({
  name,
  host,
  gameId: "terraria",
  versionId: "vanilla-1-4-5-8",
  templateId: "classic",
  nodeName: NODE,
  memoryGb: 1,
  cpuLimit: 100,
  diskGb: 5,
});
const audits = async (action: string) => db.activityEvent.findMany({ where: { action }, orderBy: { createdAt: "desc" } });
const settingsOf = (s: Awaited<ReturnType<typeof serverOf>>) => ({
  name: s.name,
  host: s.host,
  memoryLimit: s.memoryLimit,
  cpuLimit: s.cpuLimit,
  restartPolicy: s.restartPolicy,
  maxRestarts: s.maxRestarts,
});

try {
  console.log("\n== with no provider, nothing changes ==");
  let r = await create.createServerOp(mara, spec("DNS None", "none.duckdns.org"));
  check("a server is created as before", r.ok && !/DNS|record/.test(r.body), JSON.stringify(r).slice(0, 200));
  const none = await serverOf("dns-none");
  check("and carries no record", none.dnsRecords.length === 0);
  check("its state reads as none", rules.dnsStateOf(none, null, none.node, none.dnsRecords).state === "none");
  let sync = await dns.reconcileDns();
  check("the poller has nothing to do", sync.synced === 0 && sync.failed === 0);
  check("and no provider was called", cfCalls.length === 0 && duckCalls.length === 0);
  check("the wizard's domain is the workspace's, as before", (await create.workspaceDomain()) === "ashfold.gg", await create.workspaceDomain());
  r = await ops.deleteServerOp(mara, "dns-none", "DNS None");
  check("deleting it calls no provider either", r.ok && duckCalls.length === 0, JSON.stringify(r).slice(0, 200));

  console.log("\n== configuring DuckDNS ==");
  r = await dns.configureDnsOp(tomas, { kind: "duckdns", token: DUCK_TOKEN, checkHost: "check" });
  check("a moderator cannot set the provider", !r.ok && r.title === "Not permitted");
  r = await dns.configureDnsOp(mara, { kind: "duckdns", token: "wrong-token-0000000000", checkHost: "check" });
  check("a wrong token is refused, with DuckDNS's answer", !r.ok && /refused/.test(r.title) && /Nothing was saved/.test(r.body), JSON.stringify(r));
  check("nothing was saved", (await db.dnsProvider.count()) === 0);
  r = await dns.configureDnsOp(mara, { kind: "duckdns", token: DUCK_TOKEN, checkHost: "nosuch" });
  check("a subdomain not in the account is refused", !r.ok && /refused/.test(r.title), JSON.stringify(r));
  const probeCalls = duckCalls.length;
  r = await dns.configureDnsOp(mara, { kind: "duckdns", token: DUCK_TOKEN, checkHost: "check.duckdns.org" });
  check("a good token is tested and saved", r.ok && /duckdns\.org/.test(r.title), JSON.stringify(r));
  check("the check wrote the subdomain back as it was", duckSubs.get("check") === "203.0.113.1" && duckCalls[probeCalls]?.includes("ip=203.0.113.1"), duckCalls[probeCalls]);
  /* A subdomain with no record yet: the check clears it, which changes
     nothing, rather than sending an address DuckDNS would replace with
     the panel's own — found on the first real account. */
  process.env.DUCKDNS_PROBE_ADDRESS = "none";
  duckSubs.set("fresh", null);
  const freshCalls = duckCalls.length;
  r = await dns.configureDnsOp(mara, { kind: "duckdns", token: DUCK_TOKEN, checkHost: "fresh" });
  check("a subdomain with no record is checked by clearing it, which changes nothing", r.ok && duckCalls[freshCalls]?.includes("clear=true") && duckSubs.get("fresh") === null, duckCalls[freshCalls]);
  process.env.DUCKDNS_PROBE_ADDRESS = "203.0.113.1";
  r = await dns.configureDnsOp(mara, { kind: "duckdns", token: DUCK_TOKEN, checkHost: "check.duckdns.org" });
  check("and the account's usual subdomain is the one kept", r.ok);
  const row = (await db.dnsProvider.findUnique({ where: { id: "dns" } }))!;
  check("the token is stored encrypted", row.token !== DUCK_TOKEN && row.token.startsWith("v1."));
  check("the zone is duckdns.org", row.zone === "duckdns.org" && row.checkHost === "check");
  // Three saves so far: the account's subdomain, the fresh one, the account's again.
  check("configuring is audited without the token", (await audits("dns.configured")).length === 3 && !JSON.stringify(await audits("dns.configured")).includes(DUCK_TOKEN), String((await audits("dns.configured")).length));
  const status = await dns.dnsStatus();
  check("the status names the provider and never the token", status.kind === "duckdns" && status.zone === "duckdns.org" && !JSON.stringify(status).includes(DUCK_TOKEN));
  check("the wizard proposes names under the account's own subdomain", (await create.workspaceDomain()) === "check.duckdns.org", await create.workspaceDomain());

  console.log("\n== the node's address ==");
  const fresh = await nodeRow();
  check("the node has no address yet", rules.nodeAddress(fresh).address === null);
  r = await create.createServerOp(mara, spec("DNS Waiting", "verify.duckdns.org"));
  check("a server is created, and says its node has no address", r.ok && /no public address/.test(r.body), JSON.stringify(r).slice(0, 300));
  let waiting = await serverOf("dns-waiting");
  check("its state is no-address, with no error", rules.dnsStateOf(waiting, { kind: "duckdns", zone: "duckdns.org" }, waiting.node, waiting.dnsRecords).state === "no-address" && waiting.dnsRecords.length === 0);
  check("and DuckDNS was not asked", !duckCalls.some((c) => c.includes("domains=verify&")));
  await nodeOps.recordHeartbeat({ name: NODE, token: "not-the-token" }).catch(() => {});
  r = await setAddress("203.0.113.9");
  check("an owner sets the node's public address", r.ok && /203\.0\.113\.9/.test(r.body), JSON.stringify(r));
  const changed = (await audits("node.updated"))[0];
  check("the change is audited", JSON.stringify(changed?.changes).includes("Public address"), JSON.stringify(changed?.changes));
  r = await setAddress("not an address");
  check("a non-address is refused", !r.ok && r.title === "Check the form");
  sync = await dns.reconcileDns();
  check("the poller writes the record now the node has an address", sync.synced === 1 && sync.failed === 0, JSON.stringify(sync));
  waiting = await serverOf("dns-waiting");
  check("the server points at the node", addrOf(waiting) === "203.0.113.9" && duckSubs.get("verify") === "203.0.113.9");
  check("written is audited", (await audits("server.dns.set")).length === 1);
  check("the API shape says so", shape.serverShape(waiting as never, { provider: { kind: "duckdns", zone: "duckdns.org" }, node: waiting.node }).dns?.state === "set");
  sync = await dns.reconcileDns();
  const before = duckCalls.length;
  check("and nothing more is written while nothing changed", sync.synced === 0 && duckCalls.length === before);

  console.log("\n== creating with a record ==");
  r = await create.createServerOp(mara, spec("DNS Two", "verify2.duckdns.org"));
  check("the record is written as the server is created", r.ok && /verify2\.duckdns\.org points at 203\.0\.113\.9/.test(r.body), JSON.stringify(r).slice(0, 300));
  check("DuckDNS has it", duckSubs.get("verify2") === "203.0.113.9");
  r = await create.createServerOp(mara, spec("DNS Outside", "outside.example.org"));
  const outside = await serverOf("dns-outside");
  check("a host outside the zone is created without a record, and without a call", r.ok && !/record/.test(r.body) && rules.dnsStateOf(outside, { kind: "duckdns", zone: "duckdns.org" }, outside.node, outside.dnsRecords).state === "outside");
  const calls = duckCalls.length;
  r = await create.createServerOp(mara, spec("DNS Nope", "nope.duckdns.org"));
  const nope = await serverOf("dns-nope");
  check("a subdomain not in the account: the server is created and told", r.ok && r.tone === "warning" && /not written/.test(r.body), JSON.stringify(r).slice(0, 300));
  check("the reason is kept on its record", /refused/.test(errOf(nope) ?? "") && addrOf(nope) === null, errOf(nope) ?? "");
  check("and audited as failed", (await audits("server.dns.failed")).length === 1);
  check("the token is in no message", !JSON.stringify(await db.activityEvent.findMany()).includes(DUCK_TOKEN) && !(errOf(nope) ?? "").includes(DUCK_TOKEN));
  sync = await dns.reconcileDns();
  check("the poller does not retry a failure that just happened", duckCalls.length === calls + 1 && sync.failed === 0, JSON.stringify(sync));
  await age(nope.id);
  sync = await dns.reconcileDns();
  check("and retries one five minutes old", duckCalls.length === calls + 2 && sync.failed === 1, JSON.stringify(sync));
  r = await dns.retryServerDnsOp(mara, "dns-nope");
  check("Retry now tries at once and says why it failed", !r.ok && r.title === "Record not written", JSON.stringify(r));
  r = await dns.retryServerDnsOp(mara, "dns-outside");
  check("Retry on a host outside the zone says whose it is", !r.ok && r.title === "Outside the zone");

  console.log("\n== the node's address changes ==");
  r = await setAddress("198.51.100.7");
  sync = await dns.reconcileDns();
  check("every record on the node follows it", sync.synced === 2, JSON.stringify(sync));
  check("DuckDNS has the new address", duckSubs.get("verify") === "198.51.100.7" && duckSubs.get("verify2") === "198.51.100.7");
  check("updated is audited with old and new", JSON.stringify((await audits("server.dns.updated"))[0]?.changes).includes("203.0.113.9"));
  await db.node.update({ where: { name: NODE }, data: { publicAddress: null, observedAddress: "192.168.1.20" } });
  check("an observed private address is not one", rules.nodeAddress(await nodeRow()).address === null);
  sync = await dns.reconcileDns();
  check("and no record is written from it", sync.synced === 0 && sync.failed === 0);
  await db.node.update({ where: { name: NODE }, data: { observedAddress: "203.0.113.50" } });
  sync = await dns.reconcileDns();
  check("an observed public address is followed", sync.synced === 2 && duckSubs.get("verify") === "203.0.113.50", JSON.stringify(sync));
  const hb = await nodeOps.recordHeartbeat({ name: NODE, token: "wrong", observedFrom: "203.0.113.60" }).catch((e: Error) => e.message);
  check("a heartbeat with the wrong token writes nothing", hb === "Unknown node." && (await nodeRow()).observedAddress === "203.0.113.50");

  console.log("\n== the host changes ==");
  const two = await serverOf("dns-two");
  r = await ops.updateServerSettingsOp(mara, "dns-two", { ...settingsOf(two), host: "verify3.duckdns.org" });
  check("a new host gets a record and the old one is cleared", r.ok && duckSubs.get("verify2") === null && duckSubs.get("verify3") === "203.0.113.50", JSON.stringify(r).slice(0, 300));
  check("both are audited", (await audits("server.dns.removed")).length === 1 && (await audits("server.dns.set")).length >= 2);
  r = await ops.updateServerSettingsOp(mara, "dns-two", { ...settingsOf(await serverOf("dns-two")), host: "gone.example.org" });
  const gone = await serverOf("dns-two");
  check("a host moved outside the zone loses its record and keeps none", r.ok && duckSubs.get("verify3") === null && gone.dnsRecords.length === 0);

  console.log("\n== the provider is down ==");
  duckMode = "down";
  r = await create.createServerOp(mara, spec("DNS Down", "verify2.duckdns.org"));
  const down = await serverOf("dns-down");
  check("the server is created and the failure kept", r.ok && r.tone === "warning" && /answered 500/.test(errOf(down) ?? ""), (errOf(down) ?? "") + JSON.stringify(r).slice(0, 200));
  duckMode = "ok";
  await age(down.id);
  sync = await dns.reconcileDns();
  check("and written once the provider is back", sync.synced === 1 && errOf(await serverOf("dns-down")) === null && duckSubs.get("verify2") === "203.0.113.50");

  console.log("\n== deleting ==");
  r = await ops.deleteServerOp(mara, "dns-down", "DNS Down");
  check("the record goes with the server", r.ok && duckSubs.get("verify2") === null, JSON.stringify(r).slice(0, 200));
  // Three by now: the host change, the host moved outside the zone, and this delete.
  check("removal is audited", (await audits("server.dns.removed")).length === 3, String((await audits("server.dns.removed")).length));
  duckMode = "down";
  r = await ops.deleteServerOp(mara, "dns-waiting", "DNS Waiting");
  check("a record that will not go does not keep the server", r.ok && /was not removed/.test(r.body) && (await db.server.findUnique({ where: { slug: "dns-waiting" } })) === null, JSON.stringify(r).slice(0, 300));
  check("the orphan is audited", (await audits("server.dns.orphaned")).length === 1);
  duckMode = "ok";

  console.log("\n== names under one DuckDNS subdomain ==");
  /* DuckDNS answers for every name under a subdomain with that subdomain's
     address, so servers share it: one written, the rest agreeing, and the
     last to go clears it. A server on another node would move it from under
     the rest, and is told instead. */
  const beforeW1 = duckCalls.length;
  r = await create.createServerOp(mara, spec("DNS W1", "w1.verifyw.duckdns.org"));
  check("a name under a subdomain is written through the subdomain", r.ok && /w1\.verifyw\.duckdns\.org points at 203\.0\.113\.50/.test(r.body) && duckSubs.get("verifyw") === "203.0.113.50", JSON.stringify(r).slice(0, 300));
  check("with one call, for the subdomain and not the name", duckCalls.length === beforeW1 + 1 && duckCalls[beforeW1]!.includes("domains=verifyw&"), duckCalls.slice(beforeW1).join(" | "));
  const beforeW2 = duckCalls.length;
  r = await create.createServerOp(mara, spec("DNS W2", "w2.verifyw.duckdns.org"));
  const w2 = await serverOf("dns-w2");
  check("a second server on the node agrees without asking DuckDNS", r.ok && addrOf(w2) === "203.0.113.50" && errOf(w2) === null && duckCalls.length === beforeW2, `${addrOf(w2)} calls=${duckCalls.length - beforeW2}`);
  check("and says it is shared", JSON.stringify((await audits("server.dns.set"))[0]?.changes).includes("Shared with"), JSON.stringify((await audits("server.dns.set"))[0]?.changes));
  check("its state is set", rules.dnsStateOf(w2, { kind: "duckdns", zone: "duckdns.org" }, w2.node, w2.dnsRecords).state === "set");

  const fra = await db.node.findUniqueOrThrow({ where: { name: "fra-node-02" } });
  await nodeOps.updateNodeDetailsOp(mara, "fra-node-02", { city: fra.city, region: fra.region, publicAddress: "198.51.100.77" });
  const aurora = await serverOf("aurora");
  const beforeRefused = (await audits("server.dns.refused")).length;
  const beforeAurora = duckCalls.length;
  r = await ops.updateServerSettingsOp(mara, "aurora", { ...settingsOf(aurora), host: "aurora.verifyw.duckdns.org" });
  const refused = await serverOf("aurora");
  check("a server on another node is saved, and told it cannot have the name", r.ok && r.tone === "warning" && /already points at ash-node-01/.test(r.body), JSON.stringify(r).slice(0, 300));
  check("the reason names both nodes and is kept on the server", /verifyw\.duckdns\.org already points at ash-node-01, for DNS W\d/.test(errOf(refused) ?? "") && /fra-node-02/.test(errOf(refused) ?? ""), errOf(refused) ?? "");
  check("the address stays where it was, and DuckDNS was not asked", duckSubs.get("verifyw") === "203.0.113.50" && duckCalls.length === beforeAurora);
  check("refusing is audited", (await audits("server.dns.refused")).length === beforeRefused + 1);

  await setAddress("198.51.100.9");
  const beforeMove = duckCalls.length;
  sync = await dns.reconcileDns();
  const w1Row = await serverOf("dns-w1");
  const w2Row = await serverOf("dns-w2");
  check("the node's address moves the subdomain for every server on it", duckSubs.get("verifyw") === "198.51.100.9" && addrOf(w1Row) === "198.51.100.9" && addrOf(w2Row) === "198.51.100.9", `${duckSubs.get("verifyw")} ${addrOf(w1Row)} ${addrOf(w2Row)}`);
  check("with a single call", duckCalls.length === beforeMove + 1 && sync.synced === 2, `${duckCalls.length - beforeMove} calls, ${JSON.stringify(sync)}`);
  check("and the refused server is left refused", errOf(await serverOf("aurora")) !== null && duckSubs.get("verifyw") === "198.51.100.9");

  // Back to an address of its own, outside the zone: its refusal goes with it.
  r = await ops.updateServerSettingsOp(mara, "aurora", { ...settingsOf(await serverOf("aurora")), host: aurora.host });
  const back = await serverOf("aurora");
  check("moved out of the zone, the server keeps no refusal", r.ok && back.dnsRecords.length === 0);
  await nodeOps.updateNodeDetailsOp(mara, "fra-node-02", { city: fra.city, region: fra.region, publicAddress: "" });

  const beforeRename = duckCalls.length;
  r = await ops.updateServerSettingsOp(mara, "dns-w2", { ...settingsOf(await serverOf("dns-w2")), host: "w2b.verifyw.duckdns.org" });
  check("renaming within the subdomain clears nothing and asks nothing", r.ok && duckCalls.length === beforeRename && duckSubs.get("verifyw") === "198.51.100.9" && addrOf(await serverOf("dns-w2")) === "198.51.100.9", duckCalls.slice(beforeRename).join(" | "));

  r = await ops.deleteServerOp(mara, "dns-w1", "DNS W1");
  check("deleting one of two leaves the subdomain pointing where it did", r.ok && duckSubs.get("verifyw") === "198.51.100.9" && !duckCalls.slice(beforeRename).some((c) => c.includes("clear=true")), JSON.stringify(r).slice(0, 200));
  check("and says who still uses it", JSON.stringify((await audits("server.dns.removed"))[0]?.changes).includes("Still used by"), JSON.stringify((await audits("server.dns.removed"))[0]?.changes));
  r = await ops.deleteServerOp(mara, "dns-w2", "DNS W2");
  check("deleting the last clears it", r.ok && duckSubs.get("verifyw") === null, JSON.stringify(r).slice(0, 200));

  console.log("\n== IPv6 at DuckDNS, which holds two addresses and no SRV ==");
  const here = await nodeRow();
  r = await create.createServerOp(mara, spec("DNS V6", "verify.duckdns.org"));
  check("a server on a node with only an IPv4 address has one record", r.ok && (await serverOf("dns-v6")).dnsRecords.map((x) => x.kind).join() === "A" && duckSubs6.get("verify") == null);
  r = await nodeOps.updateNodeDetailsOp(mara, NODE, { city: here.city, region: here.region, publicAddress: here.publicAddress ?? "", publicAddress6: "2001:db8::9" });
  check("an owner sets the node's IPv6 address", r.ok && /2001:db8::9/.test(r.body), JSON.stringify(r));
  check("it is audited under its own name", JSON.stringify((await audits("node.updated"))[0]?.changes).includes("Public IPv6 address"));
  r = await nodeOps.updateNodeDetailsOp(mara, NODE, { city: here.city, region: here.region, publicAddress: here.publicAddress ?? "", publicAddress6: "203.0.113.5" });
  check("an IPv4 address in the IPv6 field is refused", !r.ok && r.title === "Check the form");
  sync = await dns.reconcileDns();
  const v6 = await serverOf("dns-v6");
  check("the poller writes an AAAA beside the A", sync.synced >= 1 && v6.dnsRecords.map((x) => x.kind).sort().join() === "A,AAAA", v6.dnsRecords.map((x) => x.kind).join());
  check("DuckDNS has both addresses", duckSubs.get("verify") === here.publicAddress && duckSubs6.get("verify") === "2001:db8::9", `${duckSubs.get("verify")} ${duckSubs6.get("verify")}`);
  check("and its state is set, at the IPv4 address", rules.dnsStateOf(v6, { kind: "duckdns", zone: "duckdns.org" }, v6.node, v6.dnsRecords).address === here.publicAddress);
  const quiet = duckCalls.length;
  sync = await dns.reconcileDns();
  check("nothing more is written while nothing changed", duckCalls.length === quiet);
  await nodeOps.updateNodeDetailsOp(mara, NODE, { city: here.city, region: here.region, publicAddress: here.publicAddress ?? "", publicAddress6: "" });
  sync = await dns.reconcileDns();
  const lost = await serverOf("dns-v6");
  check("with the IPv6 address taken away the AAAA goes", lost.dnsRecords.map((x) => x.kind).join() === "A" && duckSubs6.get("verify") === null, `${lost.dnsRecords.map((x) => x.kind)} ${duckSubs6.get("verify")}`);
  check("and the IPv4 address is written back, since DuckDNS can only clear both", duckSubs.get("verify") === here.publicAddress, String(duckSubs.get("verify")));
  const registry = await import("../src/domain/games/registry");
  const java = registry.findGame("minecraft-java")!;
  const javaSpec = (name: string, host: string) => ({
    name,
    host,
    gameId: "minecraft-java",
    versionId: (java.versions.find((v) => v.recommended) ?? java.versions[0]!).id,
    templateId: java.templates[0]!.id,
    nodeName: NODE,
    memoryGb: 1,
    cpuLimit: 50,
    diskGb: 5,
  });
  const beforeJava = duckCalls.length;
  r = await create.createServerOp(mara, javaSpec("DNS Java Duck", "javaduck.verify2.duckdns.org"));
  const javaDuck = await serverOf("dns-java-duck");
  check("a Minecraft: Java server on DuckDNS gets an address and no SRV: DuckDNS has none to give", r.ok && javaDuck.dnsRecords.map((x) => x.kind).join() === "A" && duckCalls.slice(beforeJava).every((c) => !/srv/i.test(c)), `${r.ok} ${javaDuck.dnsRecords.map((x) => x.kind)}`);
  check("and the page says players need the port", !rules.dnsStateOf(javaDuck, { kind: "duckdns", zone: "duckdns.org" }, javaDuck.node, javaDuck.dnsRecords).byName);
  await ops.deleteServerOp(mara, "dns-java-duck", "DNS Java Duck");
  await ops.deleteServerOp(mara, "dns-v6", "DNS V6");

  console.log("\n== the wizard's check of the address, with a provider ==");
  const addr = await import("../src/lib/address-check");
  type Looked = Awaited<ReturnType<typeof addr.lookupHost>>;
  const answers = (...found: string[]) => async (): Promise<Looked> => (found.length > 0 ? { kind: "found", addresses: found } : { kind: "missing" });
  const said = async (as: typeof mara, host: string, lookup: (h: string) => Promise<Looked>) => {
    const out = await addr.checkAddressOp(as, host, lookup);
    return out.ok ? out.verdict : null;
  };
  let v = await said(mara, "fresh.check.duckdns.org", answers());
  check("a new name under the provider's zone: Geeboard will create it", v?.tone === "success" && /will create this record/.test(v.title) && !v.offerSetup, JSON.stringify(v));
  v = await said(mara, "fresh.check.duckdns.org", answers("198.51.100.9"));
  check("one that already points at a node says which", v?.tone === "success" && /Already points at ash-node-01/.test(v.title), JSON.stringify(v));
  v = await said(mara, "fresh.example.org", answers());
  check("one outside the zone is said to be the creator's, and offers no provider it already has", v?.tone === "warning" && /Not under duckdns\.org/.test(v.title) && !v.offerSetup, JSON.stringify(v));
  await db.node.updateMany({ data: { publicAddress: null, observedAddress: null } });
  v = await said(mara, "fresh.check.duckdns.org", answers());
  check("with no node able to give an address it says what is missing", v?.tone === "warning" && v.title === "No node has a public address yet" && /Configure/.test(v.body), JSON.stringify(v));
  await setAddress("198.51.100.9");
  check("only whoever may create a server can ask", (await said(tomas, "fresh.example.org", answers())) === null);
  check("a name that is not one is not looked up", (await said(mara, "not a host", answers())) === null && (await said(mara, "", answers())) === null);
  let asked = "";
  await addr.checkAddressOp(mara, "  Mixed.Case.Example.ORG ", async (h) => ((asked = h), { kind: "missing" }));
  check("the name is looked up as the wizard would have it, lower-cased and trimmed", asked === "mixed.case.example.org", asked);

  console.log("\n== removing the provider ==");
  const kept = await db.serverDnsRecord.count({ where: { content: { not: null } } });
  r = await dns.removeDnsOp(mara);
  check("the provider is forgotten, and the records it wrote are said to stay", r.ok && (kept === 0 || /stay/.test(r.body)), JSON.stringify(r));
  check("the servers forget their records", (await db.serverDnsRecord.count()) === 0);
  check("the wizard's domain is the workspace's again", (await create.workspaceDomain()) === "ashfold.gg", await create.workspaceDomain());

  console.log("\n== the wizard's check of the address, with none ==");
  v = await said(mara, "aurora.example.com", answers());
  check("a name that does not exist offers to set up DNS", v?.tone === "info" && /does not exist yet/.test(v.title) && v.offerSetup, JSON.stringify(v));
  v = await said(mara, "aurora.example.com", answers("203.0.113.200"));
  check("one that points at something that is not a node says so, and offers it", v?.tone === "warning" && /not one of your nodes/.test(v.body) && v.offerSetup, JSON.stringify(v));
  v = await said(mara, "aurora.example.com", answers("198.51.100.9"));
  check("one that points at a node needs nothing", v?.tone === "success" && !v.offerSetup, JSON.stringify(v));
  v = await said(mara, "aurora.example.com", async (): Promise<Looked> => ({ kind: "failed", reason: "The name server did not answer in time." }));
  check("a lookup that failed says so, and does not stop the server being created", v?.tone === "muted" && /did not answer in time/.test(v.body) && v.offerSetup, JSON.stringify(v));
  const real = await addr.lookupHost("nosuch-geeboard-verify.invalid");
  check("a real lookup of a name that cannot exist is an answer, not a failure", real.kind === "missing" || real.kind === "failed", JSON.stringify(real));

  console.log("\n== Cloudflare ==");
  r = await dns.configureDnsOp(mara, { kind: "cloudflare", token: "wrong-token-000000000", zone: "example.com" });
  check("a token Cloudflare turns down is refused", !r.ok && /Cloudflare refused/.test(r.title), JSON.stringify(r));
  r = await dns.configureDnsOp(mara, { kind: "cloudflare", token: CF_TOKEN, zone: "example.net" });
  check("a zone the token cannot read is refused", !r.ok && /no zone example\.net/.test(r.body), JSON.stringify(r));
  cfCalls.length = 0;
  r = await dns.configureDnsOp(mara, { kind: "cloudflare", token: CF_TOKEN, zone: "Example.com" });
  check("a good token on its zone is tested and saved", r.ok, JSON.stringify(r));
  check("the check verified the token, found the zone, wrote and removed a TXT", cfCalls.join(" ") === "GET /user/tokens/verify GET /zones POST /zones/zone1/dns_records DELETE /zones/zone1/dns_records/rec1", cfCalls.join(" "));
  check("nothing of the check is left", cfRecords.size === 0);
  check("the zone id is kept", (await db.dnsProvider.findUnique({ where: { id: "dns" } }))?.zoneId === "zone1");
  await setAddress("203.0.113.9");

  r = await create.createServerOp(mara, spec("CF One", "cf1.example.com"));
  const one = await serverOf("cf-one");
  const rec = [...cfRecords.values()].find((x) => x.name === "cf1.example.com");
  check("a record is created, unproxied, short-lived, marked as the panel's", r.ok && rec?.type === "A" && rec.content === "203.0.113.9" && rec.proxied === false && rec.ttl === 60 && rec.comment === rules.markerFor(one.id), JSON.stringify(rec));
  check("its id is kept", recOf(one)?.providerRecordId === rec?.id && recOf(one)?.name === "cf1.example.com");

  cfRecords.set("pre1", { id: "pre1", type: "A", name: "cf2.example.com", content: "203.0.113.9", comment: null });
  r = await create.createServerOp(mara, spec("CF Two", "cf2.example.com"));
  const twoCf = await serverOf("cf-two");
  check("a record that already says the address is adopted", r.ok && /already pointed/.test(r.body) && recOf(twoCf)?.providerRecordId === "pre1", JSON.stringify(r).slice(0, 300));
  check("adopted is audited", (await audits("server.dns.adopted")).length === 1);

  cfRecords.set("pre2", { id: "pre2", type: "A", name: "cf3.example.com", content: "198.51.100.1", comment: null });
  r = await create.createServerOp(mara, spec("CF Three", "cf3.example.com"));
  const three = await serverOf("cf-three");
  check("a record pointing elsewhere that the panel did not make is left alone", r.ok && r.tone === "warning" && /did not make it/.test(errOf(three) ?? "") && cfRecords.get("pre2")?.content === "198.51.100.1", errOf(three) ?? "");
  // One from the DuckDNS section above, one here.
  check("refused is audited", (await audits("server.dns.refused")).length === 2, String((await audits("server.dns.refused")).length));
  cfRecords.set("pre3", { id: "pre3", type: "CNAME", name: "cf4.example.com", content: "elsewhere.example.net", comment: null });
  r = await create.createServerOp(mara, spec("CF Four", "cf4.example.com"));
  check("a CNAME at the name is left alone", /CNAME/.test(errOf(await serverOf("cf-four")) ?? ""));

  await setAddress("198.51.100.7");
  sync = await dns.reconcileDns();
  check("the panel's records follow the node, by id", cfRecords.get(recOf(one)!.providerRecordId!)?.content === "198.51.100.7" && cfRecords.get("pre1")?.content === "198.51.100.7", JSON.stringify([...cfRecords.values()]));
  check("the one it refused is still refused, not overwritten", cfRecords.get("pre2")?.content === "198.51.100.1");

  console.log("\n== SRV and IPv6, at Cloudflare ==");
  const node7 = await nodeRow();
  const marker = (x: Served) => rules.markerFor(x.id);
  const srvAt = (name: string) => [...cfRecords.values()].find((x) => x.type === "SRV" && x.name === name);
  r = await create.createServerOp(mara, javaSpec("CF Java", "mc1.example.com"));
  const j1 = await serverOf("cf-java");
  const srv1 = srvAt("_minecraft._tcp.mc1.example.com");
  check("a Minecraft: Java server gets an A record and an SRV record", r.ok && j1.dnsRecords.map((x) => x.kind).sort().join() === "A,SRV" && Boolean(srv1), `${r.ok} ${j1.dnsRecords.map((x) => x.kind)}`);
  check("the SRV carries the server's port and names the host, with the panel's marker, a short life and no proxy", srv1?.data?.port === j1.port && srv1?.data?.target === "mc1.example.com" && srv1?.data?.priority === 0 && srv1?.data?.weight === 5 && srv1?.comment === marker(j1) && srv1?.ttl === 60 && srv1?.proxied === undefined, JSON.stringify(srv1));
  check("its row keeps the name and the provider's id", recOf(j1, "SRV")?.name === "_minecraft._tcp.mc1.example.com" && recOf(j1, "SRV")?.providerRecordId === srv1?.id);
  const viewJ1 = rules.dnsStateOf(j1, { kind: "cloudflare", zone: "example.com" }, j1.node, j1.dnsRecords);
  check("the page's view says players need only the name", viewJ1.state === "set" && viewJ1.byName && viewJ1.records.length === 2);
  check("and the API says the address has an SRV record", shape.serverShape(j1 as never, { provider: { kind: "cloudflare", zone: "example.com" }, node: j1.node }).address.srv === true);
  check("a game that does not ask for one gets none", recOf(twoCf, "SRV") === undefined && ![...cfRecords.values()].some((x) => x.type === "SRV" && x.name.endsWith("cf2.example.com")));

  r = await create.createServerOp(mara, javaSpec("CF Java Two", "mc2.example.com"));
  const j2 = await serverOf("cf-java-two");
  check("a second Java server on the node holds another block, and its SRV carries that port", j2.port !== j1.port && srvAt("_minecraft._tcp.mc2.example.com")?.data?.port === j2.port, `${j1.port} ${j2.port}`);

  // A server moved to another block, as a move writes it: the port changes and the host does not.
  const newPort = j2.port + 30;
  await db.server.update({ where: { id: j2.id }, data: { port: newPort } });
  const aRecId = recOf(j2)!.providerRecordId;
  const beforeMoveCalls = cfCalls.length;
  sync = await dns.reconcileDns();
  const moved = await serverOf("cf-java-two");
  check("the poller moves the SRV to the new port and leaves the A where it is", srvAt("_minecraft._tcp.mc2.example.com")?.data?.port === newPort && recOf(moved)?.providerRecordId === aRecId && cfRecords.get(aRecId!)?.content === "198.51.100.7", cfCalls.slice(beforeMoveCalls).join(" | "));
  check("only the SRV was written", cfCalls.slice(beforeMoveCalls).filter((c) => c.startsWith("PUT") || c.startsWith("POST")).length === 1, cfCalls.slice(beforeMoveCalls).join(" | "));
  check("and it is audited as an SRV change, with the old and the new", JSON.stringify((await audits("server.dns.updated"))[0]).includes("_minecraft._tcp.mc2.example.com") && JSON.stringify((await audits("server.dns.updated"))[0]?.changes).includes(String(newPort)));

  // Somebody else's SRV at the name: refused, the A still written.
  cfRecords.set("pre-srv", { id: "pre-srv", type: "SRV", name: "_minecraft._tcp.mc3.example.com", content: "5 25565 elsewhere.example.net", priority: 10, data: { priority: 10, weight: 5, port: 25565, target: "elsewhere.example.net" }, comment: null });
  r = await create.createServerOp(mara, javaSpec("CF Java Three", "mc3.example.com"));
  const j3 = await serverOf("cf-java-three");
  check("an SRV record that is not the panel's is left alone", cfRecords.get("pre-srv")?.data?.target === "elsewhere.example.net" && /an SRV record for that name already exists/.test(errOf(j3) ?? ""), errOf(j3) ?? "");
  check("the server's address record is written all the same, and its state is failed, with no promise of a name alone", recOf(j3)?.content === "198.51.100.7" && rules.dnsStateOf(j3, { kind: "cloudflare", zone: "example.com" }, j3.node, j3.dnsRecords).state === "failed" && !rules.dnsStateOf(j3, { kind: "cloudflare", zone: "example.com" }, j3.node, j3.dnsRecords).byName);
  cfRecords.delete("pre-srv");
  await age(j3.id);
  sync = await dns.reconcileDns();
  check("with the other one gone it is written, on the next try", srvAt("_minecraft._tcp.mc3.example.com")?.data?.target === "mc3.example.com" && errOf(await serverOf("cf-java-three")) === null);

  // IPv6, set by hand on the node.
  r = await nodeOps.updateNodeDetailsOp(mara, NODE, { city: node7.city, region: node7.region, publicAddress: node7.publicAddress ?? "", publicAddress6: "2001:db8::7" });
  const beforeAaaa = cfCalls.length;
  sync = await dns.reconcileDns();
  const aaaa = [...cfRecords.values()].filter((x) => x.type === "AAAA");
  check("every record on the node gets an AAAA beside its A", r.ok && aaaa.length >= 5 && aaaa.every((x) => x.content === "2001:db8::7" && x.proxied === false && (x.comment ?? "").startsWith("geeboard:")), `${aaaa.length} ${JSON.stringify(aaaa.slice(0, 2))}`);
  check("an AAAA is written next to an A that was adopted, without touching the A", cfRecords.get("pre1")?.type === "A" && [...cfRecords.values()].some((x) => x.type === "AAAA" && x.name === "cf2.example.com"));
  check("the SRVs were not rewritten for it", cfCalls.slice(beforeAaaa).filter((c) => /PUT/.test(c)).length === 0, cfCalls.slice(beforeAaaa).join(" | "));
  const dual = await serverOf("cf-java");
  check("and the view lists the three records", dual.dnsRecords.map((x) => x.kind).sort().join() === "A,AAAA,SRV");
  await nodeOps.updateNodeDetailsOp(mara, NODE, { city: node7.city, region: node7.region, publicAddress: node7.publicAddress ?? "", publicAddress6: "" });
  sync = await dns.reconcileDns();
  check("with it taken away the AAAA records go, and the A and SRV stay", ![...cfRecords.values()].some((x) => x.type === "AAAA") && Boolean(srvAt("_minecraft._tcp.mc1.example.com")) && (await serverOf("cf-java")).dnsRecords.map((x) => x.kind).sort().join() === "A,SRV");
  check("and each removal is audited", (await audits("server.dns.removed")).some((e) => JSON.stringify(e.changes).includes("IPv6 address")));

  // Removed with the server.
  r = await ops.deleteServerOp(mara, "cf-java", "CF Java");
  check("deleting the server takes away both its records", r.ok && !srvAt("_minecraft._tcp.mc1.example.com") && ![...cfRecords.values()].some((x) => x.name === "mc1.example.com"), JSON.stringify([...cfRecords.values()].filter((x) => x.name.includes("mc1"))));
  r = await ops.deleteServerOp(mara, "cf-java-two", "CF Java Two");
  await ops.deleteServerOp(mara, "cf-java-three", "CF Java Three");
  check("and none is left behind by any of them", ![...cfRecords.values()].some((x) => x.name.includes("mc")));

  r = await ops.deleteServerOp(mara, "cf-one", "CF One");
  check("the record is deleted with the server", r.ok && !cfRecords.has(recOf(one)!.providerRecordId!));
  cfMode = "forbidden";
  r = await dns.checkDnsOp(mara);
  check("a token revoked since is reported by Check", !r.ok && /refused/.test(r.title) && (await dns.dnsStatus()).checkError !== null, JSON.stringify(r));
  cfMode = "ok";
  r = await dns.checkDnsOp(mara);
  check("and cleared when it works again", r.ok && (await dns.dnsStatus()).checkError === null);
  check("no token reached the audit log", !JSON.stringify(await db.activityEvent.findMany()).includes(CF_TOKEN));
  r = await dns.removeDnsOp(mara);
  check("removed", r.ok);
} finally {
  cf.close();
  duck.close();
  await db.dnsProvider.deleteMany();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
