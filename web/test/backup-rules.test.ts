import assert from "node:assert/strict";
import { test } from "node:test";
import { judgeArchive, summariseVerification, verifyDownloads } from "../src/lib/backup-rules.ts";
import { normaliseTask, payloadForForm, validateTask } from "../src/lib/task-rules.ts";

/* What a look at a stored archive adds up to — no node, no bucket. */

const recorded = { checksum: "sha256:aaaa", sizeBytes: BigInt(1000) };

test("an archive that reads back as it was written is intact", () => {
  assert.deepEqual(judgeArchive(recorded, { kind: "read", checksum: "sha256:aaaa", sizeBytes: 1000 }), {
    status: "intact",
  });
});

test("a different digest is damage, and so is a different size", () => {
  const flipped = judgeArchive(recorded, { kind: "read", checksum: "sha256:bbbb", sizeBytes: 1000 });
  assert.equal(flipped.status, "damaged");
  assert.match((flipped as { error: string }).error, /no longer matches the checksum/);

  const cut = judgeArchive(recorded, { kind: "read", checksum: "sha256:aaaa", sizeBytes: 512 });
  assert.equal(cut.status, "damaged");
  assert.match((cut as { error: string }).error, /512 bytes; 1000 were written/);
});

test("an archive that is gone is damaged, and says where from", () => {
  assert.match((judgeArchive(recorded, { kind: "missing", where: "node" }) as { error: string }).error, /on the node/);
  assert.match((judgeArchive(recorded, { kind: "missing", where: "bucket" }) as { error: string }).error, /in the bucket/);
});

/* The distinction that keeps the mark worth reading: a node that is down
   says nothing about the archives on it. */
test("an archive nobody could look at is unchecked, never damaged", () => {
  const verdict = judgeArchive(recorded, { kind: "unreachable", reason: "fra-node-02 is unreachable" });
  assert.deepEqual(verdict, { status: "unchecked", reason: "fra-node-02 is unreachable" });
});

test("a bucket listing proves presence and size, and says it proved no more", () => {
  const present = judgeArchive(recorded, { kind: "listed", sizeBytes: 1000 });
  assert.equal(present.status, "intact");
  assert.match((present as { note?: string }).note!, /not re-hashed/);
  assert.equal(judgeArchive(recorded, { kind: "listed", sizeBytes: 999 }).status, "damaged");
});

test("a row with no checksum cannot be called intact", () => {
  const verdict = judgeArchive({ checksum: null, sizeBytes: 1000 }, { kind: "read", checksum: "sha256:x", sizeBytes: 1000 });
  assert.equal(verdict.status, "unchecked");
});

test("off-site archives are downloaded only when the task says so", () => {
  assert.equal(verifyDownloads(null), false);
  assert.equal(verifyDownloads(""), false);
  assert.equal(verifyDownloads("download"), true);
  assert.equal(verifyDownloads("downloads"), false);
});

test("the summary leaves out what did not happen", () => {
  assert.equal(summariseVerification({ intact: 4, damaged: 0, unchecked: 0 }), "4 intact");
  assert.equal(summariseVerification({ intact: 2, damaged: 1, unchecked: 3 }), "2 intact, 1 damaged, 3 could not be checked");
});

test("a verify task is one of two modes, stored as its payload", () => {
  const base = { name: "Weekly verify", kind: "VERIFY" as const, cron: "0 5 * * 0" };
  assert.deepEqual(validateTask({ ...base, payload: "" }, undefined), {});
  assert.deepEqual(validateTask({ ...base, payload: "download" }, undefined), {});
  assert.ok(validateTask({ ...base, payload: "everything" }, undefined).payload);

  assert.equal(normaliseTask({ ...base, payload: "" }).payload, null);
  assert.equal(normaliseTask({ ...base, payload: "download" }).payload, "download");
  assert.equal(payloadForForm("VERIFY", null), "");
  assert.equal(payloadForForm("VERIFY", "download"), "download");
});
