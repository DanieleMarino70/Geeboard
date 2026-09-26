import assert from "node:assert/strict";
import { test } from "node:test";
import { collapseProgress, isProbeLine, mergeLines } from "../src/lib/console-lines.ts";
import { requireGame } from "../src/domain/games/registry.ts";
import { classifyServerLine, type LogLine } from "../src/lib/console-fixture.ts";

/* What a production Terraria console did to its page: the same lines
   twice, a boot hidden behind its percentages, and a health check read as
   somebody trying to break in. */

const line = (message: string, at?: string): LogLine => ({ time: "", level: "INFO", message, at });

test("a line sent twice, with the same time from Docker and the same text, is shown once", () => {
  const page = [line("Server started", "2026-09-26T00:16:19.123456789Z"), line("a", "2026-09-26T00:16:20.000000001Z")];
  const stream = [line("a", "2026-09-26T00:16:20.000000001Z"), line("b", "2026-09-26T00:16:21.5Z")];
  assert.deepEqual(mergeLines(page, stream).map((l) => l.message), ["Server started", "a", "b"]);
  // The same text at another time is another line.
  assert.equal(mergeLines([line("a", "t1")], [line("a", "t2")]).length, 2);
  // And a line with no time of its own is never taken for a repeat.
  assert.equal(mergeLines([line("x")], [line("x")]).length, 2);
});

test("a run of progress lines is shown as its last, and different runs stay apart", () => {
  const boot = [
    "Terraria Server v1.4.5.8",
    "Resetting game objects 1%",
    "Resetting game objects 2%",
    "Resetting game objects 100%",
    "Loading world data: 1%",
    "Loading world data: 88%",
    "Load failed!  No backup found.",
    "99.7% - Final clean up - 83.3%",
    "100.0% - Final clean up - 100.0%",
  ].map((m) => line(m));
  assert.deepEqual(collapseProgress(boot).map((l) => l.message), [
    "Terraria Server v1.4.5.8",
    "Resetting game objects 100%",
    "Loading world data: 88%",
    "Load failed!  No backup found.",
    "100.0% - Final clean up - 100.0%",
  ]);
});

test("progress lines that take turns are folded too, and the error after them stays", () => {
  // Saving a world, as Terraria 1.4.5.8 printed it.
  const save = [
    "100.0% - Finalizing world - 0.0%",
    "Saving world data: 16%",
    "100.0% - Finalizing world - 0.0%",
    "Saving world data: 26%",
    "100.0% - Finalizing world - 0.0%",
    "Saving world data: 91%",
    "100.0% - Finalizing world - 0.0%",
    'Failed to create the file: "\\data\\Volla(FR).wld"!',
    "Saving world data: 16%",
  ].map((m) => line(m));
  assert.deepEqual(collapseProgress(save).map((l) => l.message), [
    "100.0% - Finalizing world - 0.0%",
    "Saving world data: 91%",
    'Failed to create the file: "\\data\\Volla(FR).wld"!',
    // A new run after the error is a new run.
    "Saving world data: 16%",
  ]);
});

test("a stack trace is not chat, the exception it names is an error, and an empty stderr line is not", () => {
  assert.equal(classifyServerLine("  at Terraria.IO.WorldFile.LoadWorld () [0x00239] in <2112d06ce89d4f6a9f>:0", false), "INFO");
  assert.equal(classifyServerLine("  at Terraria.IO.WorldFile+<>c__DisplayClass37_0.<_SaveWorld>b__0 () [0x00000]", false), "INFO");
  assert.equal(classifyServerLine("System.IO.EndOfStreamException: Unable to read beyond the end of the stream.", false), "ERROR");
  assert.equal(classifyServerLine("﻿﻿", true), "INFO");
  assert.equal(classifyServerLine("<Big Bob> anyone seen the eye?", false), "CHAT");
  assert.equal(classifyServerLine("[14:24:47] [Server thread/INFO]: <thornfield> hello", false), "CHAT");
});

test("Terraria's answers to the health check are marked, and a player's line is not", () => {
  const pattern = requireGame("terraria").console.healthLines;
  assert.ok(isProbeLine(pattern, "172.17.0.1:47914 is connecting..."));
  assert.ok(isProbeLine(pattern, "172.17.0.1:47914 was booted: You are not using the same version as this server."));
  assert.ok(!isProbeLine(pattern, "93.45.12.8:51000 is connecting..."));
  assert.ok(!isProbeLine(pattern, "Steve has joined."));
});
