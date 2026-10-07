import assert from "node:assert/strict";
import { test } from "node:test";
import { PlatformError, asPlatformError, onUnexpected } from "../src/domain/errors.ts";
import { classifyFetchFailure, codesUnder, describeReach } from "../src/domain/runtime/reach.ts";

/* What the panel says when a node did not answer, and what it says of an error nobody foresaw. */

const at = { node: "fra-node-02", address: "http://203.0.113.10:8080/" };
const withCode = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect failed"), { code }) });

test("each cause the network gave is a different sentence, with the node and the address", () => {
  const refused = describeReach(classifyFetchFailure(withCode("ECONNREFUSED")), at);
  assert.equal(refused, "fra-node-02 refused the connection at http://203.0.113.10:8080: the agent is not running there, or that is not its port.");

  const timeout = describeReach(classifyFetchFailure(Object.assign(new Error("timed out"), { name: "TimeoutError" })), { ...at, seconds: 10 });
  assert.equal(timeout, "fra-node-02 did not answer within 10 seconds (http://203.0.113.10:8080). A firewall, or a machine that is off, looks like this.");

  assert.match(describeReach(classifyFetchFailure(withCode("ENOTFOUND")), { node: "fra-node-02", address: "http://agent.example.test:8080" }), /does not resolve \(agent\.example\.test\) \(ENOTFOUND\)/);
  assert.match(describeReach(classifyFetchFailure(withCode("SELF_SIGNED_CERT_IN_CHAIN")), at), /certificate this panel does not trust \(SELF_SIGNED_CERT_IN_CHAIN\)/);
  assert.match(describeReach(classifyFetchFailure(withCode("ECONNRESET")), at), /closed the connection before it answered/);
  assert.match(describeReach(classifyFetchFailure(withCode("EHOSTUNREACH")), at), /no route from this panel to fra-node-02/);
});

test("a certificate that has expired or is not yet valid says what this panel's clock says, since a wrong clock is the usual cause of both", () => {
  const now = new Date("2026-10-07T09:30:00Z");
  for (const code of ["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID"]) {
    const said = describeReach(classifyFetchFailure(withCode(code)), { ...at, now });
    assert.match(said, new RegExp(`\\(${code}\\)`));
    assert.match(said, /clock says 2026-10-07T09:30:00\.000Z/);
  }
});

test("a port the HTTP client will not connect to is named as that, not as nothing", () => {
  const badPort = Object.assign(new TypeError("fetch failed"), { cause: new Error("bad port") });
  assert.deepEqual(classifyFetchFailure(badPort), { fault: "other", code: "BAD_PORT" });
  assert.match(describeReach(classifyFetchFailure(badPort), { node: "fra-node-02", address: "http://127.0.0.1:1" }), /could not be reached at http:\/\/127\.0\.0\.1:1 \(BAD_PORT\)\./);
});

test("an answer that is not an agent's is said so, and an unknown cause keeps its code", () => {
  assert.match(describeReach({ fault: "not-agent", code: null }, at), /answered at http:\/\/203\.0\.113\.10:8080, but not like a Geeboard agent\. Check that .* is the agent and not another program\./);
  assert.equal(classifyFetchFailure(withCode("EWEIRD")).code, "EWEIRD");
  assert.equal(classifyFetchFailure(new Error("odd")).code, null);
  assert.match(describeReach(classifyFetchFailure(withCode("EWEIRD")), at), /could not be reached at http:\/\/203\.0\.113\.10:8080 \(EWEIRD\)\./);
});

test("every sentence names the node and ends in one full stop, never two", () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "EHOSTUNREACH", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_HAS_EXPIRED", "EWEIRD"]) {
    const said = describeReach(classifyFetchFailure(withCode(code)), at);
    assert.ok(said.includes("fra-node-02") || said.includes("203.0.113.10"), said);
    assert.match(said, /[^.]\.$/);
  }
});

test("codes are read from an error, its cause and the errors of a name with several addresses", () => {
  const several = Object.assign(new AggregateError([withCode("ENETUNREACH"), withCode("ECONNREFUSED")]), { code: undefined });
  assert.deepEqual(codesUnder(several).sort(), ["ECONNREFUSED", "ENETUNREACH"]);
  assert.equal(classifyFetchFailure(several).fault, "refused");
});

/* An error nobody foresaw: said once, with a reference, and the same one however many catch blocks it passes through. */
test("an unexpected error carries the reference its reporter gave, once, and is not reported again as it passes through other catch blocks", () => {
  const lines: Array<{ message: string; context: string | undefined }> = [];
  onUnexpected((error, context) => {
    lines.push({ message: (error as Error).message, context });
    return `ref${lines.length}`;
  });
  try {
    const boom = new TypeError("Cannot read properties of undefined (reading 'name')");
    const first = asPlatformError(boom, "backup of aurora");
    assert.equal(first.code, "INTERNAL");
    assert.equal(first.message, "Something went wrong on our side (reference ref1). The panel's log has the details.");
    assert.deepEqual(first.details, { reference: "ref1" });
    assert.equal(first.cause, boom, "the cause is kept for the log and is never serialised");
    assert.equal(JSON.stringify(first.toBody()).includes("Cannot read"), false);

    const again = asPlatformError(boom, "something else");
    assert.equal(again, first);
    assert.deepEqual(lines, [{ message: "Cannot read properties of undefined (reading 'name')", context: "backup of aurora" }]);

    // A different error is a different reference; one the panel made itself is not reported at all.
    assert.equal(asPlatformError(new Error("another")).details?.reference, "ref2");
    const own = new PlatformError("NOT_FOUND", "No such server.");
    assert.equal(asPlatformError(own), own);
    assert.equal(lines.length, 2);
  } finally {
    onUnexpected(null);
  }
  // With no reporter in the process, the sentence is the old one.
  assert.equal(asPlatformError(new Error("x")).message, "Something went wrong on our side.");
});
