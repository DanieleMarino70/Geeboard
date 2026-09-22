import assert from "node:assert/strict";
import { test } from "node:test";
import { STEP, asksToOvercommit, stepBlocker, type StepBlockerInput, type WizardNode } from "../src/lib/create-wizard.ts";

/* The wizard's own refusals, and which step each one belongs on.

   These exist because of one that was on the wrong step. The review step
   offers "Create it anyway, over the node's capacity" and the create
   operation takes `overcommit` for it — but memory and CPU also blocked
   Next on the resources step, which comes first, so the only route to the
   checkbox ran through a button the checkbox was needed to enable. Both
   halves worked; the door between them did not. */

/* 32 GB, 8 cores, 500 GB, with most of it already promised. */
const full: WizardNode = {
  name: "this-pc",
  ramCommitted: 30,
  ramTotal: 32,
  cpuCommitted: 700,
  cpuTotal: 800,
  diskCommitted: 100,
  diskTotal: 500,
};

const roomy: WizardNode = { ...full, ramCommitted: 4, cpuCommitted: 100 };

const at = (step: number, over: Partial<StepBlockerInput> = {}): StepBlockerInput => ({
  step,
  name: "zomboid-one",
  nameError: null,
  hostError: null,
  node: roomy,
  memoryGb: 8,
  cpuLimit: 200,
  diskGb: 40,
  overcommit: false,
  portBase: 16261,
  portsPending: false,
  cannotRunGame: false,
  ...over,
});

test("a node short of memory does not stop the step before the checkbox", () => {
  /* The bug, in one line: this returned "this-pc is out of memory" and
     disabled Next, so the review step was unreachable. */
  assert.equal(stepBlocker(at(STEP.resources, { node: full })), null);
  assert.equal(stepBlocker(at(STEP.resources, { node: full, cpuLimit: 400 })), null);
});

test("it stops the create itself, on the step that offers the way past it", () => {
  assert.equal(stepBlocker(at(STEP.review, { node: full })), "this-pc is out of memory");
  assert.equal(
    stepBlocker(at(STEP.review, { node: full, memoryGb: 1, cpuLimit: 400 })),
    "this-pc is out of CPU",
  );
});

test("and the checkbox clears it", () => {
  assert.equal(stepBlocker(at(STEP.review, { node: full, overcommit: true })), null);
  assert.equal(
    stepBlocker(at(STEP.review, { node: full, memoryGb: 1, cpuLimit: 400, overcommit: true })),
    null,
  );
});

test("storage stops both steps, and no checkbox clears it", () => {
  const overDisk = { node: roomy, diskGb: 450 };
  assert.equal(stepBlocker(at(STEP.resources, overDisk)), "this-pc is out of storage");
  assert.equal(stepBlocker(at(STEP.review, overDisk)), "this-pc is out of storage");
  assert.equal(
    stepBlocker(at(STEP.review, { ...overDisk, overcommit: true })),
    "this-pc is out of storage",
    "a full disk stops every world on the node, including ones nobody chose this for",
  );
});

test("the refusals that are not about capacity keep their step", () => {
  assert.equal(stepBlocker(at(STEP.template, { name: "z" })), "Give the server a name");
  assert.equal(stepBlocker(at(STEP.template, { nameError: "That name is taken." })), "That name is taken.");
  assert.equal(
    stepBlocker(at(STEP.template, { hostError: "no" })),
    "That address is not a valid hostname",
  );
  assert.equal(stepBlocker(at(STEP.resources, { node: null })), "Pick a node");
  assert.equal(stepBlocker(at(STEP.resources, { portBase: null })), "this-pc has no free port block");
  assert.equal(stepBlocker(at(STEP.resources, { portBase: null, portsPending: true })), null, "still asking");
  assert.equal(stepBlocker(at(STEP.resources, { cannotRunGame: true })), "this-pc cannot run this game");
  /* A node that cannot run the game is refused whatever is ticked: the
     checkbox is about capacity, and a Linux image on a Windows node is
     not a capacity problem. */
  assert.equal(
    stepBlocker(at(STEP.review, { cannotRunGame: true, overcommit: true })),
    "this-pc cannot run this game",
  );
});

test("a node with room blocks nothing", () => {
  assert.equal(stepBlocker(at(STEP.resources)), null);
  assert.equal(stepBlocker(at(STEP.review)), null);
});

test("the question is asked exactly where the refusal can be answered", () => {
  const draft = { memoryGb: 8, cpuLimit: 200, diskGb: 40 };
  assert.ok(asksToOvercommit(full, draft), "short of memory: ask");
  assert.ok(!asksToOvercommit(roomy, draft), "room for it: do not");
  assert.ok(
    !asksToOvercommit(roomy, { ...draft, diskGb: 450 }),
    "short of storage: there is no answer to offer",
  );
  assert.ok(
    !asksToOvercommit(full, { ...draft, diskGb: 450 }),
    "short of both: storage decides, and it does not ask",
  );

  /* The two have to agree: wherever the review step still blocks, the
     card must be asking, or the wizard is a dead end again. */
  for (const node of [full, roomy]) {
    for (const memoryGb of [1, 8, 16]) {
      for (const cpuLimit of [100, 400]) {
        for (const diskGb of [40, 450]) {
          const input = at(STEP.review, { node, memoryGb, cpuLimit, diskGb });
          const stuck = stepBlocker(input);
          if (stuck && !stuck.includes("storage")) {
            assert.ok(
              asksToOvercommit(node, { memoryGb, cpuLimit, diskGb }),
              `blocked with "${stuck}" and nothing on screen to answer it`,
            );
          }
        }
      }
    }
  }
});
