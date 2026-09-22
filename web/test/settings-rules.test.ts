import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_LIMITS,
  PLATFORM_FLOOR,
  settingsWarnings,
  validateSettings,
  type SettingsInput,
  type SettingsLimits,
} from "../src/lib/settings-rules.ts";

/* What a server's resources may be, and who decides.

   A game's `memoryGbMin` used to be the floor of the slider, of the
   settings field and of the create operation, and a failed compatibility
   check on top. So an operator with a 4 GB machine and three friends
   could not ask for a 4 GB Zomboid at all — the catalogue's opinion about
   somebody else's hardware outranked theirs about their own.

   Now the floor is the platform's, the game's number is advice, and the
   panel says it where the decision is made. What it still refuses is a
   container that is not a server: nothing runs in half a gigabyte. */

const PROJECT_ZOMBOID: SettingsLimits = {
  memoryGb: [6, 32],
  cpuLimit: [200, 800],
  memoryAvailableGb: null,
  recommended: { memoryGb: 6, cpuLimit: 200 },
};

const input = (over: Partial<SettingsInput> = {}): SettingsInput => ({
  name: "alienracers",
  host: "zomboid.example.com",
  memoryLimit: 6,
  cpuLimit: 200,
  restartPolicy: "ON_FAILURE",
  maxRestarts: 3,
  ...over,
});

test("under the game's own minimum saves, and says so", () => {
  const values = input({ memoryLimit: 3 });
  assert.equal(validateSettings(values, PROJECT_ZOMBOID).memoryLimit, undefined, "not an error");
  assert.match(
    settingsWarnings(values, PROJECT_ZOMBOID).memoryLimit ?? "",
    /asks for 6 GB/,
    "and not silent either",
  );
});

test("the same for CPU, which nothing checked at all before", () => {
  const values = input({ cpuLimit: 100 });
  assert.equal(validateSettings(values, PROJECT_ZOMBOID).cpuLimit, undefined);
  assert.match(settingsWarnings(values, PROJECT_ZOMBOID).cpuLimit ?? "", /asks for 200%/);
});

test("meeting what the game asks for says nothing", () => {
  assert.deepEqual(settingsWarnings(input(), PROJECT_ZOMBOID), {});
  assert.deepEqual(settingsWarnings(input({ memoryLimit: 32, cpuLimit: 800 }), PROJECT_ZOMBOID), {});
});

test("below the platform's own floor is still refused", () => {
  // Not a policy anybody should be allowed to choose: no game runs in it.
  assert.match(
    validateSettings(input({ memoryLimit: 0 }), PROJECT_ZOMBOID).memoryLimit ?? "",
    /from 1 to 32/i,
  );
  assert.match(
    validateSettings(input({ cpuLimit: 25 }), PROJECT_ZOMBOID).cpuLimit ?? "",
    /from 50% to 800%/i,
  );
  assert.equal(PLATFORM_FLOOR.memoryGb, 1);
  assert.equal(PLATFORM_FLOOR.cpuLimit, 50);
});

test("the game's ceiling is still a ceiling", () => {
  // Going under what a game wants is a decision; going over what it can
  // use is only a number nobody benefits from.
  assert.ok(validateSettings(input({ memoryLimit: 64 }), PROJECT_ZOMBOID).memoryLimit);
  assert.ok(validateSettings(input({ cpuLimit: 1600 }), PROJECT_ZOMBOID).cpuLimit);
});

test("the node's free memory is still a refusal, not advice", () => {
  const tight: SettingsLimits = { ...PROJECT_ZOMBOID, memoryAvailableGb: 4 };
  assert.match(
    validateSettings(input({ memoryLimit: 8 }), tight).memoryLimit ?? "",
    /4 GB left/,
  );
});

test("a game the catalogue knows nothing about gets no advice", () => {
  assert.deepEqual(settingsWarnings(input({ memoryLimit: 1 }), DEFAULT_LIMITS), {});
});

test("whole numbers only, both ways", () => {
  assert.ok(validateSettings(input({ memoryLimit: 2.5 }), PROJECT_ZOMBOID).memoryLimit);
  assert.ok(validateSettings(input({ cpuLimit: Number.NaN }), PROJECT_ZOMBOID).cpuLimit);
});
