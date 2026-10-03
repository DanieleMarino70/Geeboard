import "./load-env.mts";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import process from "node:process";

/* The bucket's address is typed by an owner or an admin, and the panel
   calls it with a signed request from inside its own network. So the call
   goes through the guarded fetch (lib/net/guarded-fetch.ts) with the
   bucket's rule (domain/storage/endpoint.ts): a store on this machine, on
   the LAN or out on the Internet is allowed — that is how it is run — and
   the address a cloud keeps its credentials at is not, in any spelling.

   This runs the real operations against a stand-in store, so the whole path
   is exercised: validation, signing, the call, the redirect that is not
   followed, the endpoint that was saved before the rule and is now one the
   panel will not call. The MinIO that verify:backups needs is not used. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
const { configureStorageOp, checkStorageOp } = await import("../src/lib/storage-ops");

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

interface Seen {
  method: string | undefined;
  url: string;
  host: string | undefined;
  signed: boolean;
}
const store: Seen[] = [];
const elsewhere: Seen[] = [];
let mode: "ok" | "redirect" = "ok";
const objects = new Map<string, number>();

function record(into: Seen[], req: IncomingMessage) {
  into.push({ method: req.method, url: req.url ?? "", host: req.headers.host, signed: /^AWS4-HMAC-SHA256 /.test(String(req.headers.authorization ?? "")) });
}

const other = createServer((req, res) => {
  record(elsewhere, req);
  res.writeHead(200);
  res.end("you should not be here");
});
await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
const otherPort = (other.address() as AddressInfo).port;

const s3 = createServer((req, res) => {
  record(store, req);
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    if (mode === "redirect") {
      res.writeHead(307, { location: `http://127.0.0.1:${otherPort}/stolen` });
      return res.end();
    }
    const key = req.url ?? "";
    if (req.method === "PUT") {
      objects.set(key, Buffer.concat(chunks).length);
      res.writeHead(200, { etag: '"x"' });
      return res.end();
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
});
await new Promise<void>((resolve) => s3.listen(0, "127.0.0.1", resolve));
const port = (s3.address() as AddressInfo).port;

const form = (endpoint: string) => ({
  endpoint,
  region: "us-east-1",
  bucket: "verify-storage",
  prefix: "geeboard",
  pathStyle: true,
  accessKeyId: "verifykey",
  secretAccessKey: "verify-storage-secret-1",
  scheduledOffsite: false,
});

try {
  await seed();
  const mara = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });
  await db.backupStorage.deleteMany();

  console.log("\n== an endpoint that is the metadata address is refused before anything is called ==");
  for (const endpoint of ["http://169.254.169.254", "http://169.254.169.254/latest/meta-data/", "http://2852039166", "http://[::ffff:a9fe:a9fe]", "http://[fd00:ec2::254]", "http://0.0.0.0:9000"]) {
    const r = await configureStorageOp(mara, form(endpoint));
    check(`${endpoint}: refused, saying why`, !r.ok && r.title === "Check the form" && /will not call/.test(r.body), JSON.stringify(r));
  }
  const withLogin = await configureStorageOp(mara, form(`http://user:pass@127.0.0.1:${port}`));
  check("an endpoint with a login in it is refused, the keys have their own fields", !withLogin.ok && /user name or password/.test(withLogin.body), JSON.stringify(withLogin));
  check("nothing was saved", (await db.backupStorage.count()) === 0);
  check("and the store was never called", store.length === 0, JSON.stringify(store));

  console.log("\n== a store on this machine is allowed, and is called signed, by its own name ==");
  const saved = await configureStorageOp(mara, form(`http://127.0.0.1:${port}`));
  check("the bucket is accepted", saved.ok, JSON.stringify(saved));
  check("it was asked for a test upload and a delete", store.map((s) => s.method).join(",") === "PUT,DELETE", store.map((s) => s.method).join(","));
  check("signed with the keys", store.every((s) => s.signed));
  check("under the path-style bucket, with the Host the signature covers", store.every((s) => s.host === `127.0.0.1:${port}` && s.url.startsWith("/verify-storage/geeboard/")), JSON.stringify(store));
  check("the test object is gone again", objects.size === 0, String(objects.size));
  check("and it was saved", (await db.backupStorage.count()) === 1);

  console.log("\n== a store that answers with a redirect is not followed ==");
  mode = "redirect";
  store.length = 0;
  const checked = await checkStorageOp(mara);
  check("the check fails, with the store's own status", !checked.ok && /307/.test(checked.body), JSON.stringify(checked));
  check("the store was asked once", store.length === 1, String(store.length));
  check("and nothing was ever called at the place it pointed to", elsewhere.length === 0, JSON.stringify(elsewhere));
  mode = "ok";

  console.log("\n== an endpoint saved before the rule, which is now one the panel will not call ==");
  const row = await db.backupStorage.findUniqueOrThrow({ where: { id: "s3" } });
  await db.backupStorage.update({ where: { id: "s3" }, data: { endpoint: "http://169.254.169.254" } });
  store.length = 0;
  const stale = await checkStorageOp(mara);
  check("the check refuses, saying the panel will not call it", !stale.ok && /will not call/.test(stale.body), JSON.stringify(stale));
  check("it is kept on the row, for the page to say", /will not call/.test((await db.backupStorage.findUniqueOrThrow({ where: { id: "s3" } })).checkError ?? ""));
  check("and nothing was called", store.length === 0 && elsewhere.length === 0);
  await db.backupStorage.update({ where: { id: "s3" }, data: { endpoint: row.endpoint } });
  const back = await checkStorageOp(mara);
  check("put back, it answers again", back.ok, JSON.stringify(back));
} finally {
  await db.backupStorage.deleteMany().catch(() => {});
  s3.closeAllConnections();
  other.closeAllConnections();
  s3.close();
  other.close();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
