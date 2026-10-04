import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { judgeAddresses } from "../src/domain/notify/destination.ts";
import { GuardedFailure, GuardedRefusal, guardedFetch, type AddressJudge } from "../src/lib/net/guarded-fetch.ts";

/* The call itself: a name is looked up once, every address is judged, and
   the connection goes to an address that was judged — never to a second
   lookup, never down a redirect. The stand-ins listen on 127.0.0.1, which a
   webhook may never call, so these judge with the one parameter that exists
   for tests. */

const seen: Array<{ url: string; host: string | undefined; method: string | undefined; body: string; length: string | undefined; chunked: boolean }> = [];
let behaviour: "ok" | "redirect" | "big" | "silent" | "empty" = "ok";

const stand = createServer((req: IncomingMessage, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    seen.push({ url: req.url ?? "", host: req.headers.host, method: req.method, body: Buffer.concat(chunks).toString("utf8"), length: req.headers["content-length"], chunked: req.headers["transfer-encoding"] === "chunked" });
    if (behaviour === "silent") return; // never answers
    if (behaviour === "redirect") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      return res.end();
    }
    if (behaviour === "big") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("x".repeat(200_000));
    }
    if (behaviour === "empty") {
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("received");
  });
});
let PORT = 0;
before(async () => {
  await new Promise<void>((resolve) => stand.listen(0, "127.0.0.1", resolve));
  PORT = (stand.address() as AddressInfo).port;
});
after(() => {
  stand.closeAllConnections();
  stand.close();
});

const forTests: AddressJudge = (addresses) => judgeAddresses("WEBHOOK", addresses, { allowPrivate: false, allowLoopback: true }, true);
const strict: AddressJudge = (addresses) => judgeAddresses("WEBHOOK", addresses, { allowPrivate: false }, false);

/* Backblaze B2 refused the panel's own test upload with `411 MissingContentLength`: a body written and then ended is sent
   chunked, and an S3 store that is not told how long an object is will not take it. Found by running the panel against a
   real bucket; a local store takes either. */
test("a body goes with its length and is not sent chunked", async () => {
  seen.length = 0;
  behaviour = "ok";
  await guardedFetch(new URL(`http://127.0.0.1:${PORT}/probe`), { method: "PUT", body: "geeboard probe", judge: forTests });
  await guardedFetch(new URL(`http://127.0.0.1:${PORT}/bytes`), { method: "PUT", body: Buffer.from([0xe2, 0x82, 0xac, 1, 2, 3]), judge: forTests });
  await guardedFetch(new URL(`http://127.0.0.1:${PORT}/text`), { method: "POST", body: "€uro", judge: forTests });
  await guardedFetch(new URL(`http://127.0.0.1:${PORT}/none`), { method: "GET", judge: forTests });
  assert.deepEqual(seen.map((x) => [x.length, x.chunked]), [["14", false], ["6", false], ["6", false], [undefined, false]], "the length is the bytes, not the characters");
  assert.equal(seen[0]!.body, "geeboard probe");
});

test("a name is resolved once, and the call goes to the address that was judged", async () => {
  seen.length = 0;
  behaviour = "ok";
  // The name does not exist anywhere. If the call looked it up itself, it would fail to resolve.
  const res = await guardedFetch(new URL(`http://hooks.example.test:${PORT}/in?x=1`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"a":1}',
    judge: forTests,
    resolve: async () => ["127.0.0.1"],
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "received");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, "/in?x=1");
  assert.equal(seen[0]!.host, `hooks.example.test:${PORT}`, "the name stays in the Host header");
  assert.equal(seen[0]!.method, "POST");
  assert.equal(seen[0]!.body, '{"a":1}');
});

test("every address the name has is judged, and one bad one refuses the call before anything is connected", async () => {
  seen.length = 0;
  const started = Date.now();
  await assert.rejects(
    guardedFetch(new URL(`http://hooks.example.test:${PORT}/in`), { judge: strict, resolve: async () => ["203.0.113.9", "10.0.0.5"] }),
    (error: unknown) => error instanceof GuardedRefusal && /private network address/.test(error.message),
  );
  await assert.rejects(
    guardedFetch(new URL(`http://hooks.example.test:${PORT}/in`), { judge: forTests, resolve: async () => ["127.0.0.1", "169.254.169.254"] }),
    (error: unknown) => error instanceof GuardedRefusal && /metadata/.test(error.message),
  );
  assert.ok(Date.now() - started < 1000, "refused at once, not after a timeout");
  assert.equal(seen.length, 0, "nothing was connected to");
});

test("a literal address is judged and called as it is, with no lookup", async () => {
  seen.length = 0;
  behaviour = "ok";
  let looked = 0;
  const res = await guardedFetch(new URL(`http://127.0.0.1:${PORT}/lit`), { judge: forTests, resolve: async () => (looked++, []) });
  assert.equal(res.status, 200);
  assert.equal(looked, 0);
  await assert.rejects(guardedFetch(new URL(`http://127.0.0.1:${PORT}/lit`), { judge: strict }), GuardedRefusal);
  await assert.rejects(guardedFetch(new URL(`http://[::1]:${PORT}/lit`), { judge: strict }), GuardedRefusal);
});

test("a redirect is an answer, and is never followed", async () => {
  seen.length = 0;
  behaviour = "redirect";
  const res = await guardedFetch(new URL(`http://hooks.example.test:${PORT}/go`), { judge: forTests, resolve: async () => ["127.0.0.1"] });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "http://169.254.169.254/latest/meta-data/");
  assert.equal(seen.length, 1, "only the first address was asked");
});

test("no more than maxBytes of an answer is read", async () => {
  behaviour = "big";
  const res = await guardedFetch(new URL(`http://hooks.example.test:${PORT}/big`), { judge: forTests, resolve: async () => ["127.0.0.1"], maxBytes: 1024 });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.length <= 1024 && body.length > 0, String(body.length));
});

test("an answer with no body is an answer", async () => {
  behaviour = "empty";
  const res = await guardedFetch(new URL(`http://hooks.example.test:${PORT}/empty`), { judge: forTests, resolve: async () => ["127.0.0.1"] });
  assert.equal(res.status, 204);
});

test("a server that never answers costs the timeout and no more, and the failure says so in a fixed phrase", async () => {
  behaviour = "silent";
  const started = Date.now();
  await assert.rejects(
    guardedFetch(new URL(`http://hooks.example.test:${PORT}/slow`), { judge: forTests, resolve: async () => ["127.0.0.1"], timeoutMs: 400 }),
    (error: unknown) => error instanceof GuardedFailure && error.message === "did not answer in time" && error.code === "timeout",
  );
  const took = Date.now() - started;
  assert.ok(took >= 350 && took < 2500, `${took} ms`);
  behaviour = "ok";
});

test("a refused connection, and a name that does not resolve, are failures with fixed phrases that carry no address", async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = (closed.address() as AddressInfo).port;
  await new Promise((resolve) => closed.close(resolve));

  await assert.rejects(
    guardedFetch(new URL(`http://hooks.example.test:${port}/`), { judge: forTests, resolve: async () => ["127.0.0.1"] }),
    (error: unknown) => error instanceof GuardedFailure && error.message === "refused the connection" && !/127\.0\.0\.1|\d+\.\d+\.\d+\.\d+/.test(error.message),
  );
  await assert.rejects(
    guardedFetch(new URL("https://nowhere.invalid/"), { judge: strict }),
    (error: unknown) => error instanceof GuardedFailure && error.message === "does not resolve",
  );
});

test("the next address is tried when the first does not connect, and only the ones that were judged", async () => {
  seen.length = 0;
  behaviour = "ok";
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const dead = (closed.address() as AddressInfo).port;
  await new Promise((resolve) => closed.close(resolve));
  // Both are loopback addresses so the stand-in can answer; ::1 is tried second, after IPv4, and the port is the same.
  const res = await guardedFetch(new URL(`http://hooks.example.test:${dead}/`), { judge: forTests, resolve: async () => ["::1", "127.0.0.1"] }).catch((e) => e);
  assert.ok(res instanceof GuardedFailure, "neither listens on the dead port");
  const ok = await guardedFetch(new URL(`http://hooks.example.test:${PORT}/`), { judge: forTests, resolve: async () => ["::1", "127.0.0.1"] });
  assert.equal(ok.status, 200, "IPv4 first: the stand-in listens there, and ::1 was not needed");
});
