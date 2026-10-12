import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { SecretsKeyError } from "../src/domain/errors";
import { currentConfig, maskSecrets, renderConfig, SECRET_MASK, settingsFor, unmaskSecrets } from "../src/domain/games/config";
import { requireGame } from "../src/domain/games/registry";
import { openSecretValues, sealedIsCurrent, sealSecretValues, secretValuesOf, withSealedValues, type Sealer } from "../src/domain/games/sealed-settings";
import { secretEnvNames, withoutSecretEnv, workloadDifferences, workloadPlan, workloadSpec } from "../src/domain/games/workload";

/* A server's secret settings, sealed at rest (0.11.0): a join password and Garry's Mod's login token were the one secret the panel kept in
   the clear. The key and the database are lib/server-secrets.ts's, and verify:rekey and verify:sealedsettings run them for real; this is the
   arithmetic, with a sealer that, like lib/secrets.ts, refuses a value sealed with another key. */

function sealerWith(key: string): Sealer {
  return {
    seal: (plain) => `${key}.${Buffer.from(plain, "utf8").toString("base64url")}`,
    open: (stored) => {
      const [with_, data] = stored.split(".");
      if (with_ !== key || data === undefined) throw new SecretsKeyError();
      return Buffer.from(data, "base64url").toString("utf8");
    },
  };
}
const sealer = sealerWith("old-key");

const terraria = requireGame("terraria");
const valheim = requireGame("valheim");

test("only the settings a definition marks secret are sealed, together, and they open to what they were", () => {
  const values = { password: "hunter2", maxPlayers: 8, motd: "hello" };
  assert.deepEqual(secretValuesOf(terraria, values), { password: "hunter2" });

  const stored = sealSecretValues(terraria, values, sealer)!;
  assert.ok(!stored.includes("hunter2"), "the sealed column does not hold the password");
  assert.ok(!stored.includes("hello"), "nor anything that is not secret");
  assert.deepEqual(openSecretValues(stored, sealer), { password: "hunter2" });

  // A server whose settings hold no secret has nothing sealed; an empty password is a value, and is kept as one.
  assert.equal(sealSecretValues(terraria, { maxPlayers: 8 }, sealer), null);
  assert.deepEqual(openSecretValues(sealSecretValues(terraria, { password: "" }, sealer), sealer), { password: "" });
  assert.deepEqual(openSecretValues(null, sealer), {});
});

test("a value sealed with another key is refused the way every sealed column refuses it", () => {
  const stored = sealSecretValues(terraria, { password: "hunter2" }, sealer)!;
  assert.throws(() => openSecretValues(stored, sealerWith("new-key")), SecretsKeyError);
});

test("the clear copy wins while it is there, and the sealed one is read once it is gone", () => {
  const opened = { password: "hunter2" };
  // 0.11.0: both copies, the same.
  assert.deepEqual(withSealedValues({ password: "hunter2", maxPlayers: 8 }, opened), { password: "hunter2", maxPlayers: 8 });
  // A 0.10.1 panel, rolled back to, changed the password in the clear copy: that is the newer one.
  assert.deepEqual(withSealedValues({ password: "swordfish" }, opened).password, "swordfish");
  // The release after 0.11.0 removes the clear copy: what is sealed is what the server has.
  assert.deepEqual(withSealedValues({ maxPlayers: 8 }, opened), { password: "hunter2", maxPlayers: 8 });
});

test("the poller seals what nothing has sealed yet, and what a rolled-back panel changed, and leaves the rest", () => {
  assert.equal(sealedIsCurrent(terraria, { password: "hunter2" }, {}), false, "an upgraded server, never sealed");
  assert.equal(sealedIsCurrent(terraria, { password: "swordfish" }, { password: "hunter2" }), false, "changed by 0.10.1 after a rollback");
  assert.equal(sealedIsCurrent(terraria, { password: "hunter2", maxPlayers: 8 }, { password: "hunter2" }), true);
  assert.equal(sealedIsCurrent(terraria, { maxPlayers: 8 }, { password: "hunter2" }), true, "the clear copy gone is not a reason to seal again");
});

test("the game is given the password from the sealed copy alone, in its file and in its environment", () => {
  // Terraria's is a line of serverconfig.txt.
  const files = renderConfig(terraria, currentConfig(terraria, { config: withSealedValues({ maxPlayers: 8 }, { password: "hunter2" }) })).files;
  const config = files.find((f) => f.path === "serverconfig.txt");
  assert.ok(config?.entries.some((e) => e.key === "password" && e.value === "hunter2"), JSON.stringify(files));

  // Valheim's is an environment variable.
  const values = currentConfig(valheim, { config: withSealedValues({}, { password: "hunter22" }) });
  assert.equal(renderConfig(valheim, values).env.SERVER_PASS, "hunter22");
});

test("a secret setting's variable is not kept in the record of what the workload was made from, and an old record is not a rebuild", () => {
  assert.ok(secretEnvNames(valheim).has("SERVER_PASS"));
  const version = valheim.versions[0]!;
  const subject = { id: "s1", slug: "vh", port: 2456, memoryGb: 4, cpuLimit: 200 };
  const plan = workloadPlan(valheim, version, subject, renderConfig(valheim, currentConfig(valheim, { config: { password: "hunter22" } }), version, { includeEmpty: true }));
  assert.equal(plan.env.SERVER_PASS, "hunter22", "the workload itself is given it");

  const now = workloadSpec(plan, valheim);
  assert.ok(!JSON.stringify(now).includes("hunter22"), JSON.stringify(now.env));
  assert.ok(!("SERVER_PASS" in now.env));

  // What 0.10.1 recorded: the same, with the password in it.
  const recorded = { ...now, env: { ...now.env, SERVER_PASS: "hunter22" } };
  assert.deepEqual(workloadDifferences(withoutSecretEnv(recorded, valheim), now), [], "no rebuild is asked for because of it");
  assert.ok(!JSON.stringify(withoutSecretEnv(recorded, valheim)).includes("hunter22"));
});

test("the Settings page reads the sealed copy, so a password with no clear copy is drawn as set and kept by a save of another field", () => {
  const page = readFileSync(path.join(import.meta.dirname, "..", "src", "app", "settings", "page.tsx"), "utf8");
  assert.match(page, /const stored = game \? currentConfig\(game, \{ config: storedSettings\(selected\) \}\) : \{\};/);
  /* What that line gives the form for a Valheim server whose password is sealed alone: its server's files cannot give it back (it is a
     start-up variable), so read from the clear column it was drawn empty, sent back empty with any other change, and cleared. */
  const stored = currentConfig(valheim, { config: withSealedValues({ serverName: "Ashfold" }, { password: "hunter22" }) });
  const shown = settingsFor(valheim, true, { stored, onNode: {}, drift: [] });
  assert.equal(shown.stored.password, SECRET_MASK);
  const sent = { ...shown.stored, serverName: "Ashfold Two" };
  assert.deepEqual(unmaskSecrets(valheim, sent, stored), { ...stored, serverName: "Ashfold Two" });
});

test("a secret goes to whoever may change it as a mark, and the mark sent back is the one stored", () => {
  assert.deepEqual(maskSecrets(terraria, { password: "hunter2", maxPlayers: 8 }), { password: SECRET_MASK, maxPlayers: 8 });
  // No password reads as no password.
  assert.deepEqual(maskSecrets(terraria, { password: "" }), { password: "" });

  const stored = { password: "hunter2", maxPlayers: 8 };
  assert.deepEqual(unmaskSecrets(terraria, { password: SECRET_MASK, maxPlayers: 12 }, stored), { password: "hunter2", maxPlayers: 12 });
  assert.deepEqual(unmaskSecrets(terraria, { password: "swordfish" }, stored), { password: "swordfish" }, "a new value is a new value");
  assert.deepEqual(unmaskSecrets(terraria, { password: "" }, stored), { password: "" }, "and clearing it clears it");
  // The mark is only a mark for a secret setting.
  assert.deepEqual(unmaskSecrets(terraria, { motd: SECRET_MASK }, stored), { motd: SECRET_MASK });
});
