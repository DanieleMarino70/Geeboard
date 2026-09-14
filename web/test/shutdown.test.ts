import assert from "node:assert/strict";
import { test } from "node:test";
import type { IGameRuntime, RuntimeStatus } from "../src/domain/runtime/types.ts";
import { restartGracefully, stopGracefully } from "../src/domain/servers/shutdown.ts";

/* Stopping a server with the game's own command before any signal.

   The case these exist for, measured on a real Terraria container: a
   `docker stop` waited out its thirty-second grace and killed the game
   with exit 137, unsaved, because the shell running it ignores SIGTERM. */

const ref = { serverId: "srv-1", runtimeId: "ctr-1" };

function status(state: RuntimeStatus["state"], exitCode: number | null = null): RuntimeStatus {
  return { id: "ctr-1", name: "t", state, exitCode, oomKilled: false, startedAt: null, source: "img" };
}

/** A runtime whose game exits `exitAfterLooks` status checks after it hears `exitOn`. */
function fakeRuntime(options: { exitOn?: string; exitAfterLooks?: number; sendFails?: boolean }) {
  const calls: string[] = [];
  let heard = false;
  let looks = 0;

  const runtime = {
    async sendCommand(_ref: unknown, command: string) {
      calls.push(`send:${command}`);
      if (options.sendFails) throw new Error("stdin closed");
      if (command === options.exitOn) heard = true;
    },
    async status() {
      calls.push("status");
      if (heard && ++looks >= (options.exitAfterLooks ?? 1)) return status("stopped", 0);
      return status("running");
    },
    async stop(_ref: unknown, grace?: number) {
      calls.push(`stop:${grace}`);
      return status("stopped", 137);
    },
    async restart(_ref: unknown, grace?: number) {
      calls.push(`restart:${grace}`);
      return status("running");
    },
    async start() {
      calls.push("start");
      return status("running");
    },
  } as unknown as IGameRuntime;

  return { runtime, calls };
}

/* A clock the loop advances itself, so a thirty-second grace takes no time. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

test("the game's stop command is sent, and no signal when it exits", async () => {
  const { runtime, calls } = fakeRuntime({ exitOn: "exit", exitAfterLooks: 3 });
  const outcome = await stopGracefully(runtime, ref, { stopCommand: "exit" }, clock());

  assert.equal(outcome.how, "command");
  assert.equal(outcome.status.exitCode, 0, "exited on its own, not killed");
  assert.equal(calls[0], "send:exit");
  assert.ok(!calls.some((c) => c.startsWith("stop:")), "never signalled");
});

test("a game that ignores its stop command is signalled after the grace", async () => {
  const { runtime, calls } = fakeRuntime({ exitOn: "something-else" });
  const c = clock();
  const outcome = await stopGracefully(runtime, ref, { stopCommand: "exit" }, { ...c, graceSeconds: 30 });

  assert.equal(outcome.how, "signal");
  assert.ok(c.now() >= 30_000, "waited the grace out first");
  assert.equal(calls.at(-1), "stop:10", "and the signal gets a short grace of its own");
});

test("a command that cannot be delivered goes straight to the signal", async () => {
  const { runtime, calls } = fakeRuntime({ sendFails: true });
  const c = clock();
  const outcome = await stopGracefully(runtime, ref, { stopCommand: "exit" }, c);

  assert.equal(outcome.how, "signal");
  assert.equal(c.now(), 0, "no waiting on a command nobody heard");
  assert.ok(!calls.includes("status"));
});

test("a game with no stop command is stopped the way it always was", async () => {
  const { runtime, calls } = fakeRuntime({});
  const outcome = await stopGracefully(runtime, ref, {}, { ...clock(), graceSeconds: 45 });
  assert.equal(outcome.how, "signal");
  assert.deepEqual(calls, ["stop:45"]);
});

test("a restart saves first when the game can be asked, and is a plain restart otherwise", async () => {
  const asked = fakeRuntime({ exitOn: "exit" });
  await restartGracefully(asked.runtime, ref, { stopCommand: "exit" }, clock());
  assert.equal(asked.calls[0], "send:exit");
  assert.equal(asked.calls.at(-1), "start");

  const plain = fakeRuntime({});
  await restartGracefully(plain.runtime, ref, undefined, clock());
  assert.deepEqual(plain.calls, ["restart:30"]);
});
