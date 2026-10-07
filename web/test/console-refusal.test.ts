import assert from "node:assert/strict";
import { test } from "node:test";
import { explainConsoleRefusal } from "../src/domain/console/refusal.ts";

/* A browser's EventSource cannot read why a stream was refused, so the console asked again with a fetch and says what came back. */

test("each refusal of the console route is a sentence for the reader", () => {
  assert.match(explainConsoleRefusal(401, "unauthorized"), /session has ended/);
  assert.match(explainConsoleRefusal(404, "not found"), /no longer exists/);
  // The route's own sentence for a role that does not watch, as plain text.
  assert.equal(explainConsoleRefusal(403, "Your role does not watch this server's console."), "Your role does not watch this server's console.");
  // And for a node with no agent, as the JSON the route answers with.
  assert.equal(
    explainConsoleRefusal(503, JSON.stringify({ code: "RUNTIME_NOT_ATTACHED", message: "fra-node-02 has no agent attached." })),
    "fra-node-02 has no agent attached.",
  );
});

test("a panel that did not answer is said so, with the status, and nothing that answered is shown as a number alone", () => {
  assert.match(explainConsoleRefusal(null, ""), /did not answer/);
  assert.match(explainConsoleRefusal(502, "<html>Bad Gateway</html>"), /did not answer properly \(HTTP 502\)\. It may be restarting/);
  assert.match(explainConsoleRefusal(500, ""), /HTTP 500/);
  assert.match(explainConsoleRefusal(403, ""), /may not watch/);
  assert.match(explainConsoleRefusal(418, ""), /refused it \(HTTP 418\)/);
});
