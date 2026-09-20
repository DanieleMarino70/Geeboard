import assert from "node:assert/strict";
import { test } from "node:test";
import { otpauthUri } from "../src/domain/access/totp.ts";
import { qrRows } from "../src/lib/qr.ts";

/* The QR code for two-factor enrolment. What can be checked without a
   phone: that it is a well-formed symbol of the size the text needs, with
   its quiet zone and its three finder patterns where a scanner looks for
   them. Whether a phone reads it is checked with a phone. */

const uri = otpauthUri("Geeboard", "mara@ashfold.gg", Buffer.alloc(20, 7));
const rows = qrRows(uri);

test("the code is square, with a four-module quiet zone on every side", () => {
  assert.ok(rows.length > 0 && rows.every((row) => row.length === rows.length && /^[01]+$/.test(row)));
  const blank = "0".repeat(rows.length);
  for (let i = 0; i < 4; i++) {
    assert.equal(rows[i], blank);
    assert.equal(rows[rows.length - 1 - i], blank);
    assert.ok(rows.every((row) => row[i] === "0" && row[row.length - 1 - i] === "0"));
  }
});

test("its size is a QR version's: 17 + 4 × version, plus the border", () => {
  const modules = rows.length - 8;
  assert.equal((modules - 17) % 4, 0);
  const version = (modules - 17) / 4;
  // An otpauth URI for a 20-byte secret is about 120 bytes: version 6 to 9 at level M.
  assert.ok(version >= 5 && version <= 10, `version ${version}`);
});

test("the three finder patterns are where a scanner looks", () => {
  const finder = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
  const at = (top: number, left: number) => finder.every((line, y) => rows[top + y]!.slice(left, left + 7) === line);
  const far = rows.length - 4 - 7;
  assert.ok(at(4, 4), "top left");
  assert.ok(at(4, far), "top right");
  assert.ok(at(far, 4), "bottom left");
  assert.ok(!at(far, far), "and not bottom right");
});

test("a different secret is a different code", () => {
  assert.notDeepEqual(qrRows(otpauthUri("Geeboard", "mara@ashfold.gg", Buffer.alloc(20, 8))), rows);
});
