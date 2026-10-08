import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAgent, classifyPanel, compareVersions, parseRelease, parseVersion, toneOf, type Release } from "../src/domain/updates/release.ts";

const base = { schema: 1, version: "0.9.5", date: "2026-10-09" };
const release = (extra: Record<string, unknown> = {}): Release => {
  const r = parseRelease({ ...base, ...extra });
  if (!r.ok) throw new Error(r.why);
  return r.release;
};

test("versions order the way semver does", () => {
  assert.equal(compareVersions("0.9.0", "0.9.0"), 0);
  assert.ok(compareVersions("0.9.0", "0.9.5")! < 0);
  assert.ok(compareVersions("0.10.0", "0.9.5")! > 0, "0.10 is above 0.9: numbers, not text");
  assert.ok(compareVersions("1.0.0-rc.1", "1.0.0")! < 0, "a pre-release is below its release");
  assert.ok(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")! < 0, "numeric identifiers are numbers");
  assert.ok(compareVersions("1.0.0-alpha", "1.0.0-1")! > 0, "a number is below a word");
  assert.equal(compareVersions("1.0.0+build5", "1.0.0"), 0, "build metadata does not order");
  assert.equal(compareVersions("unknown", "0.9.0"), null);
  assert.equal(compareVersions("0.9", "0.9.0"), null);
  assert.equal(parseVersion(5), null);
  assert.equal(parseVersion("1.2.3.4"), null);
});

test("a release file is read strictly and quietly", () => {
  assert.equal(release().version, "0.9.5");
  assert.equal(release().recommended, false);
  assert.equal(release().securityFloor, null);
  assert.equal(release({ extra: "a field from a later release", nested: { a: 1 } }).version, "0.9.5", "what it does not know is ignored");
  for (const [bad, why] of [
    [null, /not a JSON object/],
    [[], /not a JSON object/],
    [{ ...base, schema: 2 }, /schema/],
    [{ ...base, version: "latest" }, /major.minor.patch/],
    [{ ...base, version: "1.0.0-rc.1" }, /major.minor.patch/],
    [{ ...base, date: "yesterday" }, /date/],
    [{ ...base, recommended: "yes" }, /recommended/],
    [{ ...base, securityFloor: "0.9" }, /securityFloor/],
    [{ ...base, agentFloor: 9 }, /agentFloor/],
    [{ ...base, securityFloor: "0.10.0" }, /above the release itself/],
  ] as Array<[unknown, RegExp]>) {
    const r = parseRelease(bad);
    assert.ok(!r.ok && why.test(r.why), `${JSON.stringify(bad)} -> ${JSON.stringify(r)}`);
  }
});

test("a link is https with no credentials, or it is dropped; a sentence is text, short", () => {
  const r = release({
    url: "https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.9.5",
    changelog: "http://github.com/x",
    summary: `  A fix\n   that matters  ${"x".repeat(500)}`,
  });
  assert.equal(r.url, "https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.9.5");
  assert.equal(r.changelog, null, "http is dropped");
  assert.ok(r.summary!.startsWith("A fix that matters"));
  assert.ok(r.summary!.length <= 300);
  assert.equal(release({ url: "https://user:pass@example.com/x" }).url, null, "credentials in a link are dropped");
  assert.equal(release({ url: "javascript:alert(1)" }).url, null);
  assert.equal(release({ url: 5 }).url, null);
});

test("the panel: current, ahead, update, recommended, security, unknown", () => {
  assert.equal(classifyPanel("0.9.5", release()).state, "current");
  assert.equal(classifyPanel("0.9.6", release()).state, "ahead");
  assert.equal(classifyPanel("0.9.0", release()).state, "update");
  assert.equal(classifyPanel("0.9.0", release({ recommended: true })).state, "recommended");
  assert.equal(classifyPanel("0.9.0", release({ securityFloor: "0.9.5" })).state, "security");
  assert.equal(classifyPanel("0.9.5", release({ securityFloor: "0.9.5" })).state, "current", "the floor itself is not below it");
  assert.equal(classifyPanel("0.9.1", release({ securityFloor: "0.9.0" })).state, "update", "above the floor, an update and not a warning");
  assert.equal(classifyPanel("unknown", release()).state, "unknown");
  assert.equal(classifyPanel("1.0.0-rc.1", release({ version: "1.0.0" })).state, "update", "a candidate is below the release");
  // The worst state wins: below the floor and a recommendation is the security one.
  assert.equal(classifyPanel("0.9.0", release({ recommended: true, securityFloor: "0.9.5" })).state, "security");
});

test("the agent: its own floors, and a release it is behind is no news", () => {
  assert.equal(classifyAgent("0.9.0", release({ agentFloor: "0.9.0", agentSecurityFloor: "0.9.0" })).state, "ok");
  assert.equal(classifyAgent("0.9.0", release()).state, "ok", "no floors: nothing to say, however old");
  assert.equal(classifyAgent("0.8.1", release({ agentFloor: "0.9.0" })).state, "unsupported");
  assert.equal(classifyAgent("0.8.1", release({ agentFloor: "0.9.0", agentSecurityFloor: "0.9.0" })).state, "security", "security outranks unsupported");
  assert.equal(classifyAgent("0.9.0", release({ agentSecurityFloor: "0.9.5" })).state, "security");
  assert.equal(classifyAgent(null, release({ agentFloor: "0.9.0" })).state, "unknown");
  assert.equal(classifyAgent("unknown", release()).state, "unknown");
});

test("each state has one tone", () => {
  assert.deepEqual(
    (["security", "recommended", "unsupported", "update", "current", "ok", "unknown", "ahead"] as const).map(toneOf),
    ["danger", "warning", "warning", "info", "success", "success", "muted", "muted"],
  );
});

test("every sentence says what it is about, and never invents a number", () => {
  const r = release({ securityFloor: "0.9.5", agentFloor: "0.9.0", agentSecurityFloor: "0.9.2" });
  assert.match(classifyPanel("0.9.0", r).says, /0\.9\.0.*0\.9\.5/);
  assert.match(classifyAgent("0.9.1", r).says, /0\.9\.1.*0\.9\.2/);
  assert.match(classifyAgent("0.8.0", r).says, /0\.8\.0/);
});
