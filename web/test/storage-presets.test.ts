import assert from "node:assert/strict";
import { test } from "node:test";
import { STORAGE_PRESETS, presetFor, regionFromEndpoint, regionProblem, storeAdvice } from "../src/domain/storage/presets.ts";

test("every preset says what it asks for, and whether Geeboard has been run against it", () => {
  assert.deepEqual(STORAGE_PRESETS.map((p) => p.id), ["other", "amazon", "backblaze", "r2"]);
  for (const p of STORAGE_PRESETS) {
    assert.ok(p.label && p.endpoint && p.notes.length > 0, p.id);
    assert.ok(p.tried.against, p.id);
  }
  // Nothing is claimed that was not run: only the self-hosted stores have been.
  assert.deepEqual(STORAGE_PRESETS.filter((p) => p.tried.yes).map((p) => p.id), ["other"]);
  assert.match(presetFor("other")!.tried.against, /SeaweedFS/);
  assert.equal(presetFor("nope"), undefined);
  assert.equal(presetFor("toString"), undefined);
});

test("the presets ask for what each provider's own documentation asks for", () => {
  const b2 = presetFor("backblaze")!;
  assert.equal(b2.endpoint, "https://s3.<region>.backblazeb2.com");
  assert.equal(b2.region, "", "its region is in its endpoint, not a default");
  assert.match(b2.notes.join(" "), /keyID/);
  assert.match(b2.notes.join(" "), /applicationKey/);
  assert.match(b2.notes.join(" "), /keep only the last version/, "a deleted backup stays and is billed unless the lifecycle is set");
  const r2 = presetFor("r2")!;
  assert.equal(r2.region, "auto");
  assert.equal(r2.pathStyle, true);
  assert.equal(presetFor("amazon")!.pathStyle, false);
  assert.equal(presetFor("other")!.pathStyle, true);
});

test("a region is read from an endpoint that carries one, and from no other", () => {
  assert.equal(regionFromEndpoint("https://s3.eu-central-003.backblazeb2.com"), "eu-central-003");
  assert.equal(regionFromEndpoint("https://s3.us-west-004.backblazeb2.com/"), "us-west-004");
  assert.equal(regionFromEndpoint("https://s3.eu-west-1.amazonaws.com"), "eu-west-1");
  assert.equal(regionFromEndpoint("https://s3-eu-west-1.amazonaws.com"), "eu-west-1", "the older dash form");
  assert.equal(regionFromEndpoint("HTTPS://S3.EU-WEST-1.AMAZONAWS.COM"), "eu-west-1");
  assert.equal(regionFromEndpoint("https://s3.amazonaws.com"), null, "the global endpoint says none");
  assert.equal(regionFromEndpoint("https://abc123.r2.cloudflarestorage.com"), null);
  assert.equal(regionFromEndpoint("http://minio:9000"), null);
  assert.equal(regionFromEndpoint("https://s3.eu-west-1.amazonaws.com.evil.example"), null, "a host that only starts the same way");
  assert.equal(regionFromEndpoint("https://evil-s3.eu-west-1.amazonaws.com"), null);
  assert.equal(regionFromEndpoint("not a url"), null);
});

test("a region the endpoint contradicts is refused with the one it says, and nothing else is", () => {
  assert.match(regionProblem("https://s3.eu-central-003.backblazeb2.com", "us-east-1")!, /in eu-central-003, and the region says us-east-1.*use eu-central-003/);
  assert.equal(regionProblem("https://s3.eu-central-003.backblazeb2.com", "eu-central-003"), null);
  assert.equal(regionProblem("https://s3.eu-central-003.backblazeb2.com", " eu-central-003 "), null);
  assert.match(regionProblem("https://s3.eu-west-1.amazonaws.com", "")!, /region says nothing/);
  for (const [endpoint, region] of [["http://minio:9000", "us-east-1"], ["https://abc.r2.cloudflarestorage.com", "auto"], ["https://s3.amazonaws.com", "us-east-1"], ["https://storage.example.com", "x"]] as const) {
    assert.equal(regionProblem(endpoint, region), null, endpoint);
  }
});

test("a store's refusal is explained where there is something to do", () => {
  assert.match(storeAdvice("SignatureDoesNotMatch")!, /region.*addressing/);
  assert.match(storeAdvice("RequestTimeTooSkewed")!, /clock/);
  assert.match(storeAdvice("InvalidAccessKeyId")!, /keyID/);
  assert.match(storeAdvice("AccessDenied")!, /another bucket/);
  assert.match(storeAdvice("NoSuchBucket")!, /made at the store first/);
  assert.equal(storeAdvice("InternalError"), null);
  assert.equal(storeAdvice(undefined), null);
});
