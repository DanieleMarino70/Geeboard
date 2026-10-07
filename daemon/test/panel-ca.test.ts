import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  PANEL_CA_ROUTE,
  PanelCaError,
  certificatesIn,
  fetchAuthority,
  fingerprintOf,
  parsePanelCa,
  pinAuthority,
  unquote,
} from "../src/panel-ca.ts";

/* A node trusting a panel that is reached at an address: the authority is fetched without trusting the connection it comes
   over, and kept only if its fingerprint is the one the command carried.

   The fixtures are a throw-away authority, a certificate for 127.0.0.1 signed by it, and a second authority, made once with
   openssl (daemon/test/fixtures/panel-ca/README.md). The leaf's key is committed on purpose, so a real TLS server can run
   here; it protects nothing. */

const fixtures = path.join(import.meta.dirname, "fixtures", "panel-ca");
const read = (name: string) => readFile(path.join(fixtures, name), "utf8");

let root: string;
let other: string;
let leaf: string;
let leafKey: string;
let rootFingerprint: string;
let otherFingerprint: string;
let dir: string;

/** What the panel's /api/v1/panel-ca answers, per test. */
let answer: { status: number; body: string } = { status: 200, body: "" };
let requests: string[] = [];
let server: https.Server;
let url: string;

before(async () => {
  [root, other, leaf, leafKey] = await Promise.all([read("root.crt"), read("other.crt"), read("leaf.crt"), read("leaf.key")]);
  rootFingerprint = createHash("sha256").update(new X509Certificate(root).raw).digest("hex");
  otherFingerprint = createHash("sha256").update(new X509Certificate(other).raw).digest("hex");
  dir = await mkdtemp(path.join(tmpdir(), "geeboard-panel-ca-"));

  server = https.createServer({ key: leafKey, cert: leaf }, (request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url !== PANEL_CA_ROUTE) {
      response.writeHead(404).end("not here");
      return;
    }
    response.writeHead(answer.status, { "content-type": "application/x-pem-file" }).end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

const serve = (status: number, body: string) => {
  answer = { status, body };
  requests = [];
};

describe("what the command says", () => {
  test("a fingerprint, in any of the forms it is written in", () => {
    const hex = "0a".repeat(32);
    assert.deepEqual(parsePanelCa(`sha256:${hex}`), { kind: "sha256", hex });
    assert.deepEqual(parsePanelCa(`SHA256:${hex.toUpperCase()}`), { kind: "sha256", hex });
    assert.deepEqual(parsePanelCa(`sha256:${"0A:".repeat(31)}0A`), { kind: "sha256", hex }, "as openssl prints it");
    assert.deepEqual(parsePanelCa(`  sha-256=${hex}  `), { kind: "sha256", hex });
  });

  test("anything else that looks like a fingerprint is refused, not read as a file", () => {
    for (const bad of ["sha256:abc", `sha256:${"zz".repeat(32)}`, `sha256:${"0a".repeat(31)}`, "sha256:", `sha256:${"0a".repeat(33)}`]) {
      assert.throws(() => parsePanelCa(bad), PanelCaError, bad);
    }
    assert.throws(() => parsePanelCa("  "), PanelCaError);
  });

  test("a path is a file", () => {
    assert.deepEqual(parsePanelCa("/root/panel-ca.crt"), { kind: "file", path: "/root/panel-ca.crt" });
    assert.deepEqual(parsePanelCa("C:\\Users\\mara\\panel-ca.crt"), { kind: "file", path: "C:\\Users\\mara\\panel-ca.crt" });
  });

  test("one pair of quotes comes off, and only a pair", () => {
    assert.equal(unquote("'a b'"), "a b");
    assert.equal(unquote('"a"'), "a");
    assert.equal(unquote("\u2018a\u2019"), "a");
    assert.equal(unquote("\u201ca\u201d"), "a");
    assert.equal(unquote("  'a'  "), "a");
    assert.equal(unquote("'a"), "'a");
    assert.equal(unquote("a'"), "a'");
    assert.equal(unquote("''"), "");
    assert.equal(unquote("'a'b'"), "a'b");
  });
});

describe("the certificate in a text", () => {
  test("every certificate block, and nothing that only looks like one", () => {
    assert.equal(certificatesIn(root + other).length, 2);
    assert.equal(certificatesIn(`${root}\nnoise\n-----BEGIN CERTIFICATE-----\nnot base64 at all!\n-----END CERTIFICATE-----\n`).length, 1);
    assert.equal(certificatesIn("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----").length, 0);
    assert.equal(certificatesIn("").length, 0);
  });

  test("the fingerprint is the SHA-256 of the certificate, as openssl says it", () => {
    assert.equal(fingerprintOf(new X509Certificate(root)), rootFingerprint);
    assert.match(rootFingerprint, /^[0-9a-f]{64}$/);
  });
});

describe("fetching the authority by its fingerprint", () => {
  test("the authority comes back when the panel offers the one the command named, and the panel's certificate is signed by it", async () => {
    serve(200, root);
    const got = await fetchAuthority(url, rootFingerprint);
    assert.equal(got.pem.trim(), root.trim());
    assert.equal(got.fingerprint, rootFingerprint);
    assert.match(got.subject, /Geeboard test authority/);
    assert.match(got.notAfter, /^\d{4}-\d{2}-\d{2}$/);
    // Once to read it, once over a connection that trusts nothing else, to prove the panel's own certificate chains to it.
    assert.deepEqual(requests, [`GET ${PANEL_CA_ROUTE}`, `GET ${PANEL_CA_ROUTE}`]);
  });

  test("a panel that offers a different authority is refused, and both fingerprints are in the sentence", async () => {
    serve(200, other);
    await assert.rejects(
      () => fetchAuthority(url, rootFingerprint),
      (error: Error) => {
        assert.ok(error instanceof PanelCaError);
        assert.ok(error.message.includes(`sha256:${rootFingerprint}`), "what the command named");
        assert.ok(error.message.includes(`sha256:${otherFingerprint}`), "what the panel offered");
        assert.match(error.message, /do not go on/);
        return true;
      },
    );
    assert.equal(requests.length, 1, "nothing was trusted for a second request");
  });

  test("the right authority among several is the one kept, and only that one", async () => {
    serve(200, other + root);
    const got = await fetchAuthority(url, rootFingerprint);
    assert.equal(got.pem.trim(), root.trim());
  });

  test("a body that is not a certificate is refused with what it was", async () => {
    serve(200, "<html>captive portal</html>");
    await assert.rejects(() => fetchAuthority(url, rootFingerprint), /no certificate at all/);
  });

  test("a certificate that is not an authority is not accepted even when its fingerprint is named", async () => {
    serve(200, leaf);
    const leafFingerprint = createHash("sha256").update(new X509Certificate(leaf).raw).digest("hex");
    await assert.rejects(() => fetchAuthority(url, leafFingerprint), /not a certificate authority/);
  });

  test("an authority that matches but does not sign what the panel presents is said so, not left to fail later", async () => {
    // The other authority's own fingerprint, offered and named: it matches, and the panel's certificate is not signed by it.
    serve(200, other);
    await assert.rejects(() => fetchAuthority(url, otherFingerprint), /not signed by it/);
  });

  test("a panel that has no authority to give says what to do about it", async () => {
    serve(404, "");
    await assert.rejects(() => fetchAuthority(url, rootFingerprint), /has no authority to offer.*install-panel\.sh/s);
    serve(502, "");
    await assert.rejects(() => fetchAuthority(url, rootFingerprint), /answered 502/);
  });

  test("an answer far bigger than a certificate is cut off", async () => {
    serve(200, "A".repeat(200 * 1024));
    await assert.rejects(() => fetchAuthority(url, rootFingerprint), /far more than a certificate/);
  });

  test("plain http has no certificate to pin, and is said so", async () => {
    await assert.rejects(() => fetchAuthority("http://127.0.0.1:1", rootFingerprint), /plain http/);
    await assert.rejects(() => fetchAuthority("not a url", rootFingerprint), PanelCaError);
  });

  test("nothing listening is a reason in words", async () => {
    // A port that was just given back.
    const closed = await new Promise<number>((resolve) => {
      const probe = https.createServer();
      probe.listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    await assert.rejects(
      () => fetchAuthority(`https://127.0.0.1:${closed}`, rootFingerprint),
      /could not ask the panel for its authority: nothing is listening/,
    );
  });
});

describe("keeping it", () => {
  test("by fingerprint: written whole, readable by anybody, no temporary file left", async () => {
    serve(200, root);
    const out = path.join(dir, "kept", "panel-ca.crt");
    const kept = await pinAuthority(url, { kind: "sha256", hex: rootFingerprint }, out);
    assert.equal((await readFile(out, "utf8")).trim(), root.trim());
    assert.equal(kept.fingerprint, rootFingerprint);
    assert.deepEqual(await readdir(path.dirname(out)), ["panel-ca.crt"]);
    if (process.platform !== "win32") assert.equal((await stat(out)).mode & 0o777, 0o644);
  });

  test("a refusal writes nothing, and leaves the file that was there", async () => {
    const out = path.join(dir, "kept-before", "panel-ca.crt");
    await pinAuthority(url, { kind: "file", path: path.join(fixtures, "root.crt") }, out);
    serve(200, other);
    await assert.rejects(() => pinAuthority(url, { kind: "sha256", hex: rootFingerprint }, out), PanelCaError);
    assert.equal((await readFile(out, "utf8")).trim(), root.trim(), "the authority this node already trusted is still there");
    assert.deepEqual(await readdir(path.dirname(out)), ["panel-ca.crt"]);
  });

  test("a file is copied, checked to be a certificate, and not copied onto itself", async () => {
    const out = path.join(dir, "from-file", "panel-ca.crt");
    const kept = await pinAuthority(url, { kind: "file", path: path.join(fixtures, "root.crt") }, out);
    assert.equal(kept.fingerprint, rootFingerprint);
    assert.equal((await readFile(out, "utf8")).trim(), root.trim());
    // Naming the file that is already there, which is the node re-run on the panel's own machine.
    await pinAuthority(url, { kind: "file", path: out }, out);

    const notCertificate = path.join(dir, "not.crt");
    await writeFile(notCertificate, "hello\n");
    await assert.rejects(() => pinAuthority(url, { kind: "file", path: notCertificate }, out), /has no certificate in it/);
    await assert.rejects(() => pinAuthority(url, { kind: "file", path: path.join(dir, "missing.crt") }, out), /Cannot read .*ENOENT/);
  });
});

/* The mechanism as the agent uses it: a child process that knows nothing but NODE_EXTRA_CA_CERTS. */
function child(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const cleaned: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) if (!/^(NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED)$/.test(key)) cleaned[key] = value;
    const run = spawn(process.execPath, args, { cwd: path.join(import.meta.dirname, ".."), env: { ...cleaned, ...env } });
    let out = "";
    let err = "";
    run.stdout.on("data", (chunk) => (out += chunk));
    run.stderr.on("data", (chunk) => (err += chunk));
    run.on("close", (code) => resolve({ code, out, err }));
  });
}

describe("end to end, as a node installer runs it", () => {
  const fetchOnce = `fetch(${JSON.stringify("URL")}).then((r) => console.log("status", r.status)).catch((e) => { console.log("failed", e.cause?.code ?? e.message); process.exit(1); })`;

  test("npm run pin-ca keeps the authority, and a fetch that failed before now works", async () => {
    serve(200, root);
    const probe = fetchOnce.replace("URL", `${url}/anything`);

    const untrusted = await child(["-e", probe]);
    assert.equal(untrusted.code, 1);
    assert.match(untrusted.out, /failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT)/, "untrusted, as a node sees a private authority");

    const out = path.join(dir, "cli", "panel-ca.crt");
    const pinned = await child(["--import", "tsx", "src/panel-ca.ts", `'${url}'`, `'sha256:${rootFingerprint}'`, out]);
    assert.equal(pinned.code, 0, pinned.err);
    assert.match(pinned.out, new RegExp(`sha256:${rootFingerprint}`));
    assert.match(pinned.out, /signed by it/);

    const trusted = await child(["-e", probe], { NODE_EXTRA_CA_CERTS: out });
    assert.equal(trusted.code, 0, trusted.out);
    assert.match(trusted.out, /status 404/, "it connected; the route is not one the test serves");

    // The check was not turned off: a different authority in the same place does not make this panel trusted.
    const wrong = path.join(dir, "cli", "other.crt");
    await writeFile(wrong, other);
    const stillRefused = await child(["-e", probe], { NODE_EXTRA_CA_CERTS: wrong });
    assert.equal(stillRefused.code, 1);
  });

  test("npm run pin-ca with the wrong fingerprint writes nothing and says why on stderr", async () => {
    serve(200, root);
    const out = path.join(dir, "cli-refused", "panel-ca.crt");
    const refused = await child(["--import", "tsx", "src/panel-ca.ts", url, `sha256:${"0".repeat(64)}`, out]);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /not the one this command names/);
    await assert.rejects(() => stat(out));
  });

  test("npm run pin-ca without all three arguments says how it is used", async () => {
    const usage = await child(["--import", "tsx", "src/panel-ca.ts", url]);
    assert.equal(usage.code, 2);
    assert.match(usage.err, /Usage: npm run pin-ca/);
  });
});
