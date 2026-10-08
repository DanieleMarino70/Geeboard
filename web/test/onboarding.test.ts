import assert from "node:assert/strict";
import { test } from "node:test";
import { firstSteps } from "../src/domain/onboarding.ts";

const none = { nodesRegistered: 0, nodesApproved: 0, servers: 0, serversUp: 0 };

test("a panel with nothing in it starts at the node, and the steps are always the four, in order", () => {
  const { steps, current } = firstSteps(none);
  assert.deepEqual(steps.map((s) => s.id), ["node", "approve", "server", "start"]);
  assert.equal(current?.id, "node");
  assert.equal(current?.href, "/nodes");
  assert.ok(steps.every((s) => !s.done));
});

test("each thing done moves the next step on, and only the first undone step is the current one", () => {
  assert.equal(firstSteps({ ...none, nodesRegistered: 1 }).current?.id, "approve");
  assert.equal(firstSteps({ ...none, nodesRegistered: 1, nodesApproved: 1 }).current?.id, "server");
  assert.equal(firstSteps({ nodesRegistered: 1, nodesApproved: 1, servers: 1, serversUp: 0 }).current?.id, "start");
  assert.equal(firstSteps({ nodesRegistered: 1, nodesApproved: 1, servers: 1, serversUp: 0 }).current?.href, "/servers");
});

test("when all four are done there is nothing to show", () => {
  const all = firstSteps({ nodesRegistered: 2, nodesApproved: 2, servers: 3, serversUp: 1 });
  assert.equal(all.current, null);
  assert.ok(all.steps.every((s) => s.done));
});

test("a later step being done does not hide an earlier one that is not (a server on a node that was removed)", () => {
  const odd = firstSteps({ nodesRegistered: 0, nodesApproved: 0, servers: 2, serversUp: 1 });
  assert.equal(odd.current?.id, "node");
  assert.deepEqual(odd.steps.map((s) => s.done), [false, false, true, true]);
});

test("every step says what it is and where it goes, in words a person who has read nothing can follow", () => {
  for (const s of firstSteps(none).steps) {
    assert.ok(s.title.length > 3 && s.hint.length > 40 && s.hint.endsWith("."), s.id);
    assert.ok(s.href.startsWith("/"), s.id);
    assert.ok(s.cta.length > 3, s.id);
  }
});
