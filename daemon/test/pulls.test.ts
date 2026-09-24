import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { Pulls, applyEvent, emptyProgress, summarise, type PullEvent } from "../src/pulls.ts";

/* Pulling an image, without Docker.

   The fixture is a real pull, written down line for line: node:22-bookworm-
   slim onto this project's Docker Desktop (28.5.1, containerd image store)
   in September 2026. Four layers — one already present, which finishes
   without a byte — and "Extracting" counting seconds, not bytes. The rest
   of the cases are those same shapes, fed by hand, with a clock of the
   test's own. */

const recorded = readFileSync(path.join(import.meta.dirname, "fixtures", "pull-node22-containerd.jsonl"), "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as PullEvent);

const times = { startedAt: 0, advancedAt: 0, finishedAt: null };

test("a real pull, folded event by event, ends with every layer in and every byte counted", () => {
  const progress = emptyProgress();
  for (const event of recorded) applyEvent(progress, event);
  const summary = summarise("node:22-bookworm-slim", progress, "done", times, null);

  assert.equal(summary.layers.total, 4);
  assert.equal(summary.layers.done, 4);
  // 446 B + 49,837,024 B + 1,713,017 B, and nothing for the layer the node already had.
  assert.equal(summary.bytes.current, 446 + 49_837_024 + 1_713_017);
  assert.equal(summary.bytes.total, 446 + 49_837_024 + 1_713_017);
  assert.equal(summary.bytes.totalKnown, true);
  assert.equal(summary.phase, "done");
});

test("the layers are known at once, and the size only as each layer starts", () => {
  const progress = emptyProgress();
  // Up to and including the four "Pulling fs layer" lines.
  for (const event of recorded.slice(0, 5)) applyEvent(progress, event);
  let summary = summarise("x", progress, "pulling", times, null);
  assert.equal(summary.layers.total, 4);
  assert.equal(summary.bytes.total, 0);
  assert.equal(summary.bytes.totalKnown, false);
  assert.equal(summary.phase, "downloading");

  // Past the first "Downloading" of the big layer: its size is known, the pull's is not yet.
  const firstBig = recorded.findIndex((e) => e.id === "61592f5b6030" && e.status === "Downloading");
  for (const event of recorded.slice(5, firstBig + 1)) applyEvent(progress, event);
  summary = summarise("x", progress, "pulling", times, null);
  assert.ok(summary.bytes.total >= 49_837_024);
});

test("Docker saying the same thing again is not movement", () => {
  const progress = emptyProgress();
  applyEvent(progress, { status: "Pulling fs layer", id: "a", progressDetail: {} });
  assert.equal(applyEvent(progress, { status: "Downloading", id: "a", progressDetail: { current: 100, total: 1000 } }), true);
  // The same bytes, reported again — which is what a stalled download looks like.
  assert.equal(applyEvent(progress, { status: "Downloading", id: "a", progressDetail: { current: 100, total: 1000 } }), false);
  assert.equal(applyEvent(progress, { status: "Downloading", id: "a", progressDetail: { current: 200, total: 1000 } }), true);
  assert.equal(applyEvent(progress, { status: "Download complete", id: "a", progressDetail: {} }), true);
  // Extracting counts seconds, and repeats the count every tenth of a second.
  assert.equal(applyEvent(progress, { status: "Extracting", id: "a", progressDetail: { current: 1, units: "s" } }), true);
  assert.equal(applyEvent(progress, { status: "Extracting", id: "a", progressDetail: { current: 1, units: "s" } }), false);
  assert.equal(applyEvent(progress, { status: "Extracting", id: "a", progressDetail: { current: 2, units: "s" } }), true);
  assert.equal(summarise("x", progress, "pulling", times, null).phase, "unpacking");
  assert.equal(applyEvent(progress, { status: "Pull complete", id: "a", progressDetail: {} }), true);
});

test("the older image store's words mean the same", () => {
  const progress = emptyProgress();
  applyEvent(progress, { status: "Already exists", id: "base" });
  applyEvent(progress, { status: "Pulling fs layer", id: "top" });
  applyEvent(progress, { status: "Waiting", id: "top" });
  applyEvent(progress, { status: "Verifying Checksum", id: "top" });
  const summary = summarise("x", progress, "pulling", times, null);
  assert.equal(summary.layers.done, 1);
  assert.equal(summary.layers.total, 2);
});

/* ── The jobs ─────────────────────────────────────────────────────── */

function fakeDocker(options: { present?: boolean; openError?: Error } = {}) {
  const streams: PassThrough[] = [];
  let present = options.present ?? false;
  return {
    streams,
    setPresent(value: boolean) {
      present = value;
    },
    source: {
      async open() {
        if (options.openError) throw options.openError;
        const stream = new PassThrough();
        streams.push(stream);
        return stream;
      },
      async present() {
        return present;
      },
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const write = (stream: PassThrough, event: PullEvent) => stream.write(`${JSON.stringify(event)}\r\n`);

test("an image already on the node is done without asking Docker to pull", async () => {
  const docker = fakeDocker({ present: true });
  const pulls = new Pulls(docker.source, 60_000);
  const summary = await pulls.start("alpine:3");
  assert.equal(summary.state, "done");
  assert.equal(docker.streams.length, 0);
});

test("a pull runs to done, and a second request joins it rather than pulling twice", async () => {
  const docker = fakeDocker();
  const pulls = new Pulls(docker.source, 60_000);
  const first = await pulls.start("big:1");
  assert.equal(first.state, "pulling");
  await tick();
  const again = await pulls.start("big:1");
  assert.equal(again.state, "pulling");
  assert.equal(docker.streams.length, 1);

  const stream = docker.streams[0]!;
  // A line split across two chunks, as a socket may deliver it.
  const line = JSON.stringify({ status: "Downloading", id: "l1", progressDetail: { current: 5, total: 10 } });
  write(stream, { status: "Pulling fs layer", id: "l1", progressDetail: {} });
  stream.write(line.slice(0, 20));
  stream.write(`${line.slice(20)}\r\n`);
  await tick();
  assert.equal(pulls.get("big:1")?.bytes.current, 5);

  write(stream, { status: "Pull complete", id: "l1" });
  docker.setPresent(true);
  stream.end();
  await tick();
  await tick();
  const done = pulls.get("big:1");
  assert.equal(done?.state, "done");
  assert.equal(done?.bytes.current, 10);
});

test("a pull that stops moving fails, says where it stopped, and lets go of Docker", async () => {
  let now = 1_000_000;
  const docker = fakeDocker();
  const pulls = new Pulls(docker.source, 120_000, { now: () => now });
  await pulls.start("big:1");
  await tick();
  const stream = docker.streams[0]!;
  write(stream, { status: "Pulling fs layer", id: "l1" });
  write(stream, { status: "Downloading", id: "l1", progressDetail: { current: 300 * 1024 ** 2, total: 900 * 1024 ** 2 } });
  await tick();

  // Slow is not stalled: the same bytes again, a minute later, and nothing is failed yet.
  now += 60_000;
  write(stream, { status: "Downloading", id: "l1", progressDetail: { current: 300 * 1024 ** 2, total: 900 * 1024 ** 2 } });
  await tick();
  pulls.checkStalls();
  assert.equal(pulls.get("big:1")?.state, "pulling");

  // Two minutes and a second since the last byte: stalled.
  now += 61_000;
  pulls.checkStalls();
  const failed = pulls.get("big:1");
  assert.equal(failed?.state, "failed");
  assert.match(failed?.error ?? "", /stopped moving.*2 minutes.*300 MB.*0 of 1 layers/);
  assert.equal(stream.destroyed, true);
});

test("a pull that moves slowly is never called stalled", async () => {
  let now = 0;
  const docker = fakeDocker();
  const pulls = new Pulls(docker.source, 120_000, { now: () => now });
  await pulls.start("big:1");
  await tick();
  const stream = docker.streams[0]!;
  write(stream, { status: "Pulling fs layer", id: "l1" });
  // A byte a minute for an hour.
  for (let minute = 1; minute <= 60; minute++) {
    now += 60_000;
    write(stream, { status: "Downloading", id: "l1", progressDetail: { current: minute, total: 1_000 } });
    await tick();
    pulls.checkStalls();
  }
  assert.equal(pulls.get("big:1")?.state, "pulling");
});

test("Docker's own error ends the pull with Docker's words", async () => {
  const docker = fakeDocker();
  const pulls = new Pulls(docker.source, 60_000);
  await pulls.start("nope:1");
  await tick();
  const stream = docker.streams[0]!;
  write(stream, { error: "toomanyrequests: You have reached your pull rate limit.", errorDetail: { message: "toomanyrequests: You have reached your pull rate limit." } });
  stream.end();
  await tick();
  await tick();
  const failed = pulls.get("nope:1");
  assert.equal(failed?.state, "failed");
  assert.match(failed?.error ?? "", /pull rate limit/);
});

test("a registry that refuses the name fails at once", async () => {
  const docker = fakeDocker({ openError: new Error("pull access denied for nobody/nothing, repository does not exist") });
  const pulls = new Pulls(docker.source, 60_000);
  await pulls.start("nobody/nothing:1");
  await tick();
  assert.equal(pulls.get("nobody/nothing:1")?.state, "failed");
  assert.match(pulls.get("nobody/nothing:1")?.error ?? "", /repository does not exist/);
});

test("a stream that ends without the image is not a finished pull, and asking again starts over", async () => {
  const docker = fakeDocker();
  const pulls = new Pulls(docker.source, 60_000);
  await pulls.start("big:1");
  await tick();
  docker.streams[0]!.end();
  await tick();
  await tick();
  assert.equal(pulls.get("big:1")?.state, "failed");

  const retried = await pulls.start("big:1");
  assert.equal(retried.state, "pulling");
  await tick();
  assert.equal(docker.streams.length, 2);
});
