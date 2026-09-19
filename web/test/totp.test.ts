import assert from "node:assert/strict";
import { test } from "node:test";
import {
  base32Decode,
  base32Encode,
  hotp,
  otpauthUri,
  stepOf,
  totp,
  verifyTotp,
} from "../src/domain/access/totp.ts";

/* RFC 6238's own test vectors, appendix B, for HMAC-SHA1 with the
   20-byte secret "12345678901234567890". The RFC lists eight-digit
   codes; the six-digit ones every app shows are their last six. */
const SECRET = Buffer.from("12345678901234567890", "ascii");
const VECTORS: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

test("the RFC 6238 vectors come out, at eight digits and at six", () => {
  for (const [seconds, expected] of VECTORS) {
    assert.equal(totp(SECRET, seconds * 1000, 8), expected, `T=${seconds}`);
    assert.equal(totp(SECRET, seconds * 1000), expected.slice(-6));
  }
});

test("RFC 4226's first HOTP values", () => {
  // Appendix D of RFC 4226, the same secret, counters 0 to 3.
  assert.deepEqual(
    [0, 1, 2, 3].map((c) => hotp(SECRET, c)),
    ["755224", "287082", "359152", "969429"],
  );
});

test("a code is accepted in its step and the neighbours, and never twice", () => {
  const at = 1111111111 * 1000;
  const step = stepOf(at);
  const code = totp(SECRET, at);

  assert.equal(verifyTotp(SECRET, code, at, null), step);
  // The phone is thirty seconds behind or ahead.
  assert.equal(verifyTotp(SECRET, code, at + 30_000, null), step);
  assert.equal(verifyTotp(SECRET, code, at - 30_000, null), step);
  // Two steps away is too far.
  assert.equal(verifyTotp(SECRET, code, at + 60_000, null), null);
  // Once a step has been accepted, that code — and any older one — is spent.
  assert.equal(verifyTotp(SECRET, code, at, step), null);
  assert.equal(verifyTotp(SECRET, totp(SECRET, at + 30_000), at + 30_000, step), step + 1);
});

test("a code with spaces is the same code; anything else is not a code", () => {
  const at = 59_000;
  assert.equal(verifyTotp(SECRET, "942 870 82".slice(0, 7).replace(" ", "") + "", at, null), null, "seven digits");
  assert.equal(verifyTotp(SECRET, " 287 082 ", at, null), stepOf(at));
  assert.equal(verifyTotp(SECRET, "28708a", at, null), null);
  assert.equal(verifyTotp(SECRET, "", at, null), null);
});

test("base32 round-trips and matches the RFC 4648 examples", () => {
  assert.equal(base32Encode(Buffer.from("foobar", "ascii")), "MZXW6YTBOI");
  assert.equal(base32Encode(Buffer.from("f", "ascii")), "MY");
  assert.equal(Buffer.from(base32Decode("MZXW6YTBOI")).toString("ascii"), "foobar");
  // What a person types: lower case, spaces, hyphens, padding.
  assert.equal(Buffer.from(base32Decode("mzxw 6ytb-oi======")).toString("ascii"), "foobar");
  assert.throws(() => base32Decode("MZXW6YTB01"), /not a base32/);
  const random = Buffer.from([0, 255, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 1, 2, 3, 4]);
  assert.deepEqual(Buffer.from(base32Decode(base32Encode(random))), random);
});

test("the otpauth URI carries what an authenticator needs, with the account escaped", () => {
  const uri = otpauthUri("Geeboard", "mara@ashfold.gg", SECRET);
  assert.match(uri, /^otpauth:\/\/totp\/Geeboard%3Amara%40ashfold\.gg\?/);
  assert.match(uri, /secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ/);
  assert.match(uri, /issuer=Geeboard/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});
