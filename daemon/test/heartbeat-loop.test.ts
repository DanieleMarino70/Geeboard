import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { panelClient, type Timers } from "../src/panel.ts";
import type { PlatformReporter } from "../src/capabilities.ts";

/* The heartbeat at the pace it keeps: a panel that refuses this agent is asked again every five minutes and not every fifteen seconds, a
   panel that is away is asked at growing intervals, and one that answers again brings the interval back. The timer is the test's, so that
   what the agent chose to wait is read off and time is made to pass by hand; the disk and the network stand-in answer for themselves. */

const PANEL = "https://panel.example.test";
const fakePlatform = Object.assign(async () => ({ os: "linux", arch: "x64" }), { engineMemory: () => null }) as PlatformReporter;
const config = loadConfig({
  GEEBOARD_DAEMON_TOKEN: "a".repeat(64),
  GEEBOARD_NODE_NAME: "n",
  GEEBOARD_PANEL_URL: PANEL,
  GEEBOARD_DATA_ROOT: tmpdir(),
});

/** A timer that waits for nobody: it keeps what was asked, and runs it when told. */
function manualTimers() {
  const waiting: Array<{ run: () => void; ms: number; live: boolean }> = [];
  const timers: Timers = {
    after(run, ms) {
      const entry = { run, ms, live: true };
      waiting.push(entry);
      return () => {
        entry.live = false;
      };
    },
  };
  return {
    timers,
    /** The waits chosen so far, in order. */
    asked: () => waiting.map((w) => w.ms),
    /** Lets the one that is waiting go off. */
    fire: () => {
      const entry = waiting.filter((w) => w.live).at(-1);
      assert.ok(entry, "nothing is waiting");
      entry.live = false;
      entry.run();
    },
  };
}

async function until(condition: () => boolean, label: string): Promise<void> {
  const began = Date.now();
  while (!condition()) {
    if (Date.now() - began > 5_000) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("a refusal is tried again in five minutes, a panel that is away backs off, and one that answers again restores the interval", async () => {
  const real = globalThis.fetch;
  let answer: { status: number; body: unknown } = { status: 401, body: { message: "Unknown node." } };
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const clock = manualTimers();
  const stop = panelClient(config, fakePlatform, () => undefined, clock.timers)!.startHeartbeat();
  const next = async (after: number) => {
    await until(() => clock.asked().length === after, `the wait after beat ${after}`);
  };
  try {
    // Refused: about five minutes, not fifteen seconds, and again.
    await next(1);
    assert.equal(calls, 1);
    assert.ok(clock.asked()[0]! >= 270_000 && clock.asked()[0]! <= 330_000, `a refusal waited ${clock.asked()[0]} ms`);
    clock.fire();
    await next(2);
    assert.equal(calls, 2);
    assert.ok(clock.asked()[1]! >= 270_000 && clock.asked()[1]! <= 330_000);

    // The panel was put right: this beat gets through, and the wait after it is the interval.
    answer = { status: 200, body: {} };
    clock.fire();
    await next(3);
    assert.equal(calls, 3);
    assert.equal(clock.asked()[2], 15_000);

    // The panel away (a 503, then a 502): thirty seconds and then a minute, each a fifth either way.
    answer = { status: 503, body: { message: "starting" } };
    clock.fire();
    await next(4);
    assert.ok(clock.asked()[3]! >= 24_000 && clock.asked()[3]! <= 36_000, `the first failure waited ${clock.asked()[3]} ms`);
    clock.fire();
    await next(5);
    assert.ok(clock.asked()[4]! >= 48_000 && clock.asked()[4]! <= 72_000, `the second waited ${clock.asked()[4]} ms`);

    // And it answers again.
    answer = { status: 200, body: {} };
    clock.fire();
    await next(6);
    assert.equal(clock.asked()[5], 15_000);
    assert.equal(calls, 6);
  } finally {
    stop();
    globalThis.fetch = real;
  }
});

test("stopping the heartbeat cancels what it was waiting for", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  const clock = manualTimers();
  const stop = panelClient(config, fakePlatform, () => undefined, clock.timers)!.startHeartbeat();
  try {
    await until(() => clock.asked().length === 1, "the first wait");
    stop();
    assert.throws(() => clock.fire(), /nothing is waiting/);
  } finally {
    globalThis.fetch = real;
  }
});
