import assert from "node:assert/strict";
import { test } from "node:test";
import { databaseAway } from "../src/domain/database-away.ts";
import { asPlatformError, PlatformError, STATUS } from "../src/domain/errors.ts";

/* A database that is not answering is said as that, 503, and not as a fault in the code. The shapes are the ones seen: the pg client's own
   words (a database container paused for three minutes), Prisma's codes, and Postgres' when it is shutting down or full. */

const withCause = (message: string, cause: unknown) => Object.assign(new Error(message), { cause });

test("the pg client's words for a database that does not answer are one", () => {
  assert.equal(databaseAway(new Error("Connection terminated due to connection timeout")), true);
  assert.equal(databaseAway(new Error("timeout exceeded when trying to connect")), true);
  assert.equal(databaseAway(new Error("Connection terminated unexpectedly")), true);
  assert.equal(databaseAway(new Error("terminating connection due to administrator command")), true);
  assert.equal(databaseAway(new Error("the database system is starting up")), true);
  assert.equal(databaseAway(new Error("sorry, too many clients already")), true);
});

test("Prisma's and Postgres' codes are one, anywhere in the chain of causes", () => {
  for (const code of ["P1001", "P1002", "P1017", "57P01", "57P03", "08006", "53300"]) assert.equal(databaseAway(Object.assign(new Error("x"), { code })), true, code);
  assert.equal(databaseAway(withCause("Failed to run a query", withCause("adapter error", Object.assign(new Error("x"), { code: "57P01" })))), true);
  assert.equal(databaseAway({ errors: [new Error("connect ECONNREFUSED 127.0.0.1:5432")].map((e) => Object.assign(e, { code: "ECONNREFUSED" })) }), true);
});

test("a refused connection is the database only when it says it was going to Postgres", () => {
  assert.equal(databaseAway(Object.assign(new Error("connect ECONNREFUSED 172.18.0.2:5432"), { code: "ECONNREFUSED" })), true);
  assert.equal(databaseAway(Object.assign(new Error("getaddrinfo ENOTFOUND postgres"), { code: "ENOTFOUND" })), true);
  // A node that refuses, or a name that does not resolve, is not the panel's database.
  assert.equal(databaseAway(Object.assign(new Error("connect ECONNREFUSED 203.0.113.10:8080"), { code: "ECONNREFUSED" })), false);
  assert.equal(databaseAway(Object.assign(new Error("getaddrinfo ENOTFOUND node.example.test"), { code: "ENOTFOUND" })), false);
});

test("a fault in the code, a constraint and nonsense are not", () => {
  assert.equal(databaseAway(new TypeError("Cannot read properties of undefined")), false);
  assert.equal(databaseAway(Object.assign(new Error("Unique constraint failed"), { code: "P2002" })), false);
  assert.equal(databaseAway(null), false);
  assert.equal(databaseAway("Connection terminated"), false);
  // A cause that loops back on itself ends.
  const loop: { cause?: unknown } = {};
  loop.cause = loop;
  assert.equal(databaseAway(loop), false);
});

test("it answers as DATABASE_UNAVAILABLE, 503, with a sentence that says what to look at and the cause kept out of it", () => {
  const made = asPlatformError(new Error("Connection terminated due to connection timeout"));
  assert.ok(made instanceof PlatformError);
  assert.equal(made.code, "DATABASE_UNAVAILABLE");
  assert.equal(made.status, 503);
  assert.equal(STATUS.DATABASE_UNAVAILABLE, 503);
  assert.match(made.message, /database is not answering/);
  assert.match(made.message, /docker compose ps/);
  assert.doesNotMatch(made.message, /timeout|terminated/i);
  // Converted once: the same throw through several catch blocks is one answer.
  const same = new Error("Connection terminated due to connection timeout");
  assert.equal(asPlatformError(same), asPlatformError(same));
  // And an error that is not the database's is still INTERNAL.
  assert.equal(asPlatformError(new Error("a bug")).code, "INTERNAL");
});
