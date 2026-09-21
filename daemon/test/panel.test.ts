import assert from "node:assert/strict";
import { test } from "node:test";
import { describeFetchFailure } from "../src/panel.ts";

/* What a failed call to the panel is allowed to say.

   Every one of these used to come back as "fetch failed" — a refused
   connection, a name that does not resolve, and a certificate this
   machine will not trust, which is the one that reads like a bug in the
   agent and is not. The reason is in the error's `cause`, sometimes
   under a second one, and sometimes inside an AggregateError holding
   one error per address tried. */

const PANEL = "https://panel.example.test";

/** A fetch failure the way Node raises it: one message, the reason below. */
function fetchFailure(code: string): Error {
  const cause = Object.assign(new Error("something went wrong"), { code });
  return new TypeError("fetch failed", { cause });
}

test("an untrusted certificate authority is named, with the way to trust it", () => {
  for (const code of [
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
  ]) {
    const said = describeFetchFailure(fetchFailure(code), PANEL);
    assert.match(said, new RegExp(code), code);
    assert.match(said, /tls internal/);
    assert.match(said, /--panel-ca/);
    // Never the other way out of it.
    assert.doesNotMatch(said, /NODE_TLS_REJECT_UNAUTHORIZED|verification off|--insecure/i);
  }
});

test("a refused connection, a name that does not resolve, and an expired certificate each say so", () => {
  assert.match(describeFetchFailure(fetchFailure("ECONNREFUSED"), PANEL), /nothing is listening at https:\/\/panel\.example\.test/);
  assert.match(describeFetchFailure(fetchFailure("ENOTFOUND"), PANEL), /panel\.example\.test does not resolve/);
  assert.match(describeFetchFailure(fetchFailure("CERT_HAS_EXPIRED"), PANEL), /has expired/);
});

test("the reason is found however deep it is buried", () => {
  // Two addresses tried, each with its own error, under one AggregateError.
  const both = new AggregateError(
    [Object.assign(new Error("v6"), { code: "ENETUNREACH" }), Object.assign(new Error("v4"), { code: "ECONNREFUSED" })],
    "all attempts failed",
  );
  const said = describeFetchFailure(new TypeError("fetch failed", { cause: both }), PANEL);
  assert.match(said, /no route|nothing is listening/);

  // A cause under a cause, which is where undici puts a TLS refusal.
  const nested = new TypeError("fetch failed", {
    cause: new Error("socket", { cause: Object.assign(new Error("tls"), { code: "SELF_SIGNED_CERT_IN_CHAIN" }) }),
  });
  assert.match(describeFetchFailure(nested, PANEL), /SELF_SIGNED_CERT_IN_CHAIN/);
});

test("a timeout is a timeout, with how long was waited", () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  assert.match(describeFetchFailure(timeout, PANEL), /did not answer within 10 seconds/);
});

test("a cycle of causes does not hang the agent that is only trying to report it", () => {
  const first = new Error("first") as Error & { cause?: unknown };
  const second = new Error("second", { cause: first }) as Error & { code: string };
  second.code = "ECONNRESET";
  first.cause = second;

  assert.match(describeFetchFailure(first, PANEL), /closed the connection/);
});

test("an error nobody mapped keeps its own words", () => {
  assert.equal(describeFetchFailure(new Error("the sky fell"), PANEL), "the sky fell");
});
