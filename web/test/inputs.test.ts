import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLES, asBackupStore, asId, asRole } from "../src/domain/access/inputs";

/* The arguments of a server action are whatever the browser sent. These are the shapes the audit of 0.9.5 sent to the role change and
   the backup action: an object that Prisma reads as an operation, an array, a prototype name, a number. None of them is a role. */

const NOT_VALUES: unknown[] = [
  { set: "OWNER" },
  ["OWNER"],
  "owner",
  "OWNER ",
  "SUPERUSER",
  "__proto__",
  "constructor",
  "toString",
  "",
  0,
  1,
  true,
  null,
  undefined,
  Symbol("OWNER"),
  { toString: () => "OWNER" },
];

test("a role is one of the four words, as a string, and nothing else", () => {
  for (const role of ROLES) assert.equal(asRole(role), role);
  for (const value of NOT_VALUES) assert.equal(asRole(value), null, String(typeof value === "symbol" ? "symbol" : JSON.stringify(value)));
});

test("a backup store is LOCAL or S3, as a string", () => {
  assert.equal(asBackupStore("LOCAL"), "LOCAL");
  assert.equal(asBackupStore("S3"), "S3");
  for (const value of [...NOT_VALUES, { set: "S3" }, "s3", "local"]) assert.equal(asBackupStore(value), null);
});

test("an id is a string of a sensible length, and an object is never one", () => {
  assert.equal(asId("clx1abc"), "clx1abc");
  for (const value of [{ not: "x" }, { contains: "" }, ["a"], 7, null, undefined, "", "x".repeat(129)]) assert.equal(asId(value), null);
});

test("the four roles are the whole of the Role enum", async () => {
  const { Role } = await import("@prisma/client");
  assert.deepEqual([...ROLES].sort(), Object.values(Role).sort());
});
