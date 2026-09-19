import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeLogLine } from "../src/domain/runtime/types.ts";
import { waitForSave } from "../src/domain/servers/save.ts";

/* Waiting for Bedrock to say its files are ready, as measured on the image:
   `save hold`, then `save query` answered "Data saved. Files are now ready
   to be copied." three seconds later on a new world. */

const ref = { serverId: "srv", runtimeId: "ctr" };
const ready = { command: "save query", pattern: "Files are now ready to be copied" };

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

/** A game that becomes ready after `after` queries. */
function game(after: number) {
  const sent: string[] = [];
  let queries = 0;
  const runtime = {
    async sendCommand(_ref: unknown, command: string) {
      sent.push(command);
      if (command === "save query") queries++;
    },
    async logs(): Promise<RuntimeLogLine[]> {
      return queries >= after
        ? [{ line: "[INFO] Data saved. Files are now ready to be copied.", stderr: false }]
        : [{ line: "[INFO] A previous save has not been completed.", stderr: false }];
    },
  };
  return { runtime, sent };
}

test("the backup asks until the game says its files are ready", async () => {
  const { runtime, sent } = game(3);
  assert.equal(await waitForSave(runtime, ref, ready, new Date(0), clock()), true);
  assert.deepEqual(sent, ["save query", "save query", "save query"]);
});

test("a game that never says so is given up on, and the archive still goes ahead", async () => {
  const { runtime } = game(Number.POSITIVE_INFINITY);
  const c = clock();
  assert.equal(await waitForSave(runtime, ref, { ...ready, timeoutSeconds: 10 }, new Date(0), c), false);
  assert.ok(c.now() >= 10_000, "waited the timeout out");
});
