import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { removeBody, setBody, testBody } from "../src/domain/dns/webhook.ts";

/* docs/dns-webhook.md shows a receiver, and the repository has it as a file. The page is true only if they are one and the
   same, and a receiver somebody copies from a page is only worth copying if it does what the page says: so the file is run,
   as a process, against a stand-in for nsupdate that writes down what it was told, and asked what the page says it answers. */
const root = path.join(import.meta.dirname, "..", "..");
const receiverFile = path.join(root, "examples", "dns-webhook", "receiver.mjs");
const page = readFileSync(path.join(root, "docs", "dns-webhook.md"), "utf8").replace(/\r\n/g, "\n");
const SECRET = "gbwh_receiver-test-0123456789abcdef0123456789abcdef";

test("the page shows the receiver in the repository, character for character", () => {
  const blocks = [...page.matchAll(/```js\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const file = readFileSync(receiverFile, "utf8").replace(/\r\n/g, "\n").trimEnd();
  assert.ok(blocks.includes(file), "the receiver on the page is not examples/dns-webhook/receiver.mjs");
});

test("the page says what the contract says: the three events, the headers, and what each status means", () => {
  for (const event of ["dns.set", "dns.remove", "dns.test"]) assert.ok(page.includes(`### \`${event}\``), event);
  for (const header of ["X-Geeboard-Event", "X-Geeboard-Timestamp", "X-Geeboard-Signature", "X-Geeboard-Delivery"]) assert.ok(page.includes(header), header);
  for (const status of ["`2xx`", "`404` or `410`", "`401` or `403`", "`422`"]) assert.ok(page.includes(status), status);
  assert.match(page, /GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1/);
  assert.match(page, /accepted\*\* by the receiver, not \*written\*/);
});

let dir = "";
let child: ChildProcess;
let port = 0;
const told = () => (existsSync(path.join(dir, "told.txt")) ? readFileSync(path.join(dir, "told.txt"), "utf8") : "");

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "gb-recv-"));
  // A stand-in for nsupdate: it writes down what it is told, and fails when told to.
  writeFileSync(
    path.join(dir, "stub.mjs"),
    `import { appendFileSync, existsSync } from "node:fs";\nlet input = "";\nprocess.stdin.on("data", (c) => (input += c));\nprocess.stdin.on("end", () => {\n  appendFileSync("told.txt", input + "---\\n");\n  process.exit(existsSync("fail") ? 1 : 0);\n});\n`,
  );
  port = await freePort();
  child = spawn(process.execPath, [receiverFile], {
    cwd: dir,
    env: { ...process.env, GEEBOARD_SECRET: SECRET, ZONE: "Example.COM", NSUPDATE: `${process.execPath.includes(" ") ? "node" : process.execPath} stub.mjs`, DNS_SERVER: "192.0.2.53", HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on("data", (d) => String(d).includes("receiver for") && resolve());
    child.once("exit", (code) => reject(new Error(`the receiver exited ${code}`)));
    setTimeout(() => reject(new Error("the receiver did not start")), 10_000);
  });
});

after(async () => {
  // On Windows a directory a process runs in cannot be removed: wait for it to go first.
  if (child && child.exitCode === null) {
    const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill();
    await gone;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a temporary directory left behind is not a failure of the receiver */
  }
});

/** What the panel sends: the body, signed over the timestamp and itself, the way lib/dns/webhook.ts signs it. */
async function post(body: unknown, over: { secret?: string; timestamp?: number; signature?: string; method?: string } = {}) {
  const text = JSON.stringify(body);
  const timestamp = over.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = over.signature ?? "sha256=" + createHmac("sha256", over.secret ?? SECRET).update(`${timestamp}.${text}`).digest("hex");
  const res = await fetch(`http://127.0.0.1:${port}/geeboard`, {
    method: over.method ?? "POST",
    headers: { "content-type": "application/json", "x-geeboard-timestamp": String(timestamp), "x-geeboard-signature": signature, "x-geeboard-delivery": "abc" },
    ...(over.method === "GET" ? {} : { body: text }),
  });
  return res.status;
}
const at = new Date("2026-10-04T10:00:00Z");
const A = { kind: "A" as const, name: "aurora.example.com", content: "203.0.113.9" };

test("a request that is not the panel's is refused and nothing is done with it", async () => {
  assert.equal(await post(setBody("example.com", A, "m", at), { secret: "gbwh_somebody-else-0123456789abcdef0123456789" }), 401, "another secret");
  assert.equal(await post(setBody("example.com", A, "m", at), { signature: "sha256=" + "0".repeat(64) }), 401, "a made-up signature");
  assert.equal(await post(setBody("example.com", A, "m", at), { signature: "" }), 401, "none");
  assert.equal(await post(setBody("example.com", A, "m", at), { timestamp: Math.floor(Date.now() / 1000) - 400 }), 401, "a captured request, replayed after five minutes");
  assert.equal(await post(setBody("example.com", A, "m", at), { method: "GET" }), 401, "not a POST");
  assert.equal(told(), "", "nsupdate was not run for any of them");
});

test("a dns.test is answered and changes nothing", async () => {
  assert.equal(await post(testBody("example.com", at)), 204);
  assert.equal(told(), "");
});

test("a dns.set is a delete and an add in one update, with the type, the name made absolute and the time to live", async () => {
  assert.equal(await post(setBody("example.com", A, "geeboard:s1", at)), 204);
  assert.equal(told(), "server 192.0.2.53\nzone example.com\nupdate delete aurora.example.com. A\nupdate add aurora.example.com. 60 A 203.0.113.9\nsend\n---\n");
});

test("an SRV is added with its target made absolute", async () => {
  const before = told().length;
  const srv = { kind: "SRV" as const, name: "_minecraft._tcp.aurora.example.com", content: "0 5 25568 aurora.example.com" };
  assert.equal(await post(setBody("example.com", srv, "geeboard:s1", at)), 204);
  assert.match(told().slice(before), /update add _minecraft\._tcp\.aurora\.example\.com\. 60 SRV 0 5 25568 aurora\.example\.com\.\n/);
});

test("a dns.remove is the delete alone", async () => {
  const before = told().length;
  assert.equal(await post(removeBody("example.com", { kind: "AAAA", name: "aurora.example.com" }, at)), 204);
  assert.equal(told().slice(before), "server 192.0.2.53\nzone example.com\nupdate delete aurora.example.com. AAAA\nsend\n---\n");
});

test("a name outside its zone, another zone, a type it does not keep, and content that is not the type's are refused as that record's", async () => {
  const before = told();
  assert.equal(await post(setBody("example.com", { ...A, name: "aurora.example.org" }, "m", at)), 422, "outside the zone");
  assert.equal(await post(setBody("example.com", { ...A, name: "notexample.com" }, "m", at)), 422, "a name that only ends the same way");
  assert.equal(await post(setBody("example.org", A, "m", at)), 422, "a zone it does not write");
  assert.equal(await post({ ...setBody("example.com", A, "m", at), record: { ...A, type: "TXT", ttl: 60 } }), 422, "a type it does not keep");
  assert.equal(await post(setBody("example.com", { ...A, content: "203.0.113.9\nupdate delete example.com. NS" }, "m", at)), 422, "a line of nsupdate in a content");
  assert.equal(await post(setBody("example.com", { ...A, name: "a b.example.com" }, "m", at)), 422, "a name with a space");
  assert.equal(await post({ event: "dns.other", zone: "example.com" }), 422, "an event it does not know");
  assert.equal(told(), before, "nsupdate was run for none of them");
});

test("when nsupdate fails the receiver says so, so that the panel tries again", async () => {
  writeFileSync(path.join(dir, "fail"), "");
  assert.equal(await post(setBody("example.com", A, "m", at)), 502);
  rmSync(path.join(dir, "fail"));
  assert.equal(await post(setBody("example.com", A, "m", at)), 204, "and it takes the same request when it works");
});
