import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell } from "../src/domain/csv.ts";

/* A cell the panel writes is data in a spreadsheet and never a formula in one. */

test("a cell that starts like a formula is made text", () => {
  for (const hostile of ["=HYPERLINK(\"http://evil\",\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1+1", "\r=1+1"]) {
    assert.ok(csvCell(hostile).replace(/^"/, "").startsWith("'"), JSON.stringify(hostile));
  }
});

test("an ordinary cell is left alone, and a number is not a formula", () => {
  assert.equal(csvCell("Aurora SMP"), "Aurora SMP");
  assert.equal(csvCell(12), "12");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell("a-b"), "a-b", "a hyphen inside is not a start");
  assert.equal(csvCell("2026-10-07T10:00:00.000Z"), "2026-10-07T10:00:00.000Z");
});

test("a cell with a separator, a quote or a line break of either kind is quoted, and cannot end its row", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("one\ntwo"), '"one\ntwo"');
  assert.equal(csvCell("one\rtwo"), '"one\rtwo"', "a carriage return is a row end to some readers");
  const row = ["x", "evil\r\nINJECTED,row"].map(csvCell).join(",");
  assert.equal(row.split(/\r\n(?=(?:[^"]*"[^"]*")*[^"]*$)/).length, 1, "the break is inside a quoted cell, not between rows");
});

test("an object is its JSON, quoted when it has to be", () => {
  assert.equal(csvCell({ a: 1 }), '"{""a"":1}"');
});
