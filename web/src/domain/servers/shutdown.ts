import type { ConsoleDialect } from "../games/types";
import type { IGameRuntime, RuntimeRef, RuntimeStatus } from "../runtime/types";

/* Stopping a game server the way the game wants to be stopped.

   A runtime stop is a signal: SIGTERM, a grace period, then SIGKILL. Most
   game server images run the game under a shell that never passes
   SIGTERM on, so what that actually meant was thirty seconds of nothing
   followed by a kill — for Terraria, verified, exit 137 and every change
   since the last autosave gone. `stopCommand` was declared in the
   definitions for exactly this and nothing read it.

   So: say the game's own word for "save and exit" on its console, wait
   for the process to go, and only signal it if it does not. */

export interface StopOptions {
  /** How long the game gets to exit on its own before it is signalled. */
  graceSeconds?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface StopOutcome {
  status: RuntimeStatus;
  /** Whether the game exited when asked, or had to be signalled. */
  how: "command" | "signal";
}

/** How long a signal gets after a game ignored its own stop command. */
const AFTER_COMMAND_GRACE_SECONDS = 10;

const EXITED = new Set<RuntimeStatus["state"]>(["stopped", "crashed"]);

export async function stopGracefully(
  runtime: IGameRuntime,
  ref: RuntimeRef,
  dialect: ConsoleDialect | undefined,
  options: StopOptions = {},
): Promise<StopOutcome> {
  const grace = options.graceSeconds ?? 30;
  const pollMs = options.pollMs ?? 1_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;

  const command = dialect?.stopCommand;
  if (command) {
    /* A command that could not be delivered — stdin closed, the process
       already gone — is not a reason to leave the server running; it is
       a reason to fall through to the signal. */
    const sent = await runtime.sendCommand(ref, command).then(
      () => true,
      () => false,
    );

    if (sent) {
      const deadline = now() + grace * 1_000;
      while (now() < deadline) {
        await sleep(pollMs);
        // A node that fails one look has not told us the game is still up.
        const status = await runtime.status(ref).catch(() => null);
        if (status && EXITED.has(status.state)) return { status, how: "command" };
      }
    }
  }

  const status = await runtime.stop(ref, command ? AFTER_COMMAND_GRACE_SECONDS : grace);
  return { status, how: "signal" };
}

/** A restart that saves first: a graceful stop, then a start. */
export async function restartGracefully(
  runtime: IGameRuntime,
  ref: RuntimeRef,
  dialect: ConsoleDialect | undefined,
  options: StopOptions = {},
): Promise<RuntimeStatus> {
  if (!dialect?.stopCommand) return runtime.restart(ref, options.graceSeconds ?? 30);
  await stopGracefully(runtime, ref, dialect, options);
  return runtime.start(ref);
}
