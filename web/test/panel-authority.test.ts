import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { authorityFrom, panelAuthority } from "../src/domain/access/panel-authority.ts";

/* What a panel knows about its own certificate authority, and what it will and will not offer a node as one.

   The certificates are the agent's test fixtures (daemon/test/fixtures/panel-ca): one source of them, and the agent's tests
   fetch exactly this authority from a TLS server. */

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "..", "..", "daemon", "test", "fixtures", "panel-ca", name), "utf8");
const ROOT = fixture("root.crt");
const LEAF = fixture("leaf.crt");
const FINGERPRINT = "50bafcbab484812cd26ab018eeadf37241fadb7bc07490eca5dbc7f51ff67782";
const encode = (text: string) => Buffer.from(text, "utf8").toString("base64");

test("the authority an installer wrote is offered as it is, with the fingerprint openssl would print", () => {
  const got = authorityFrom(encode(ROOT));
  assert.ok(got);
  assert.equal(got.sha256, FINGERPRINT);
  assert.equal(got.pem, ROOT);
});

test("whitespace around it, a carriage return in it, and a second certificate after it change nothing", () => {
  assert.equal(authorityFrom(`  ${encode(ROOT)}\n`)?.sha256, FINGERPRINT);
  assert.equal(authorityFrom(encode(ROOT.replace(/\n/g, "\r\n")))?.pem, ROOT, "line endings are made LF");
  assert.equal(authorityFrom(encode(ROOT + LEAF))?.sha256, FINGERPRINT, "the first certificate is the authority");
});

test("nothing is offered that is not a certificate authority", () => {
  assert.equal(authorityFrom(undefined), null);
  assert.equal(authorityFrom(null), null);
  assert.equal(authorityFrom(""), null);
  assert.equal(authorityFrom("   "), null);
  assert.equal(authorityFrom("not base64 at all !!!"), null);
  assert.equal(authorityFrom(encode("hello")), null);
  assert.equal(authorityFrom(encode("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----")), null, "does not parse");
  assert.equal(authorityFrom(encode(LEAF)), null, "a certificate for an address is not an authority, and offering it would fail far from here");
  assert.equal(authorityFrom(encode(fixture("leaf.key"))), null, "a private key is never offered");
});

test("the panel reads it from the environment it was started with", () => {
  assert.equal(panelAuthority({ PANEL_CA_B64: encode(ROOT) })?.sha256, FINGERPRINT);
  assert.equal(panelAuthority({}), null);
});
