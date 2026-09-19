import type { ConsoleDialect } from "../games/types";
import type { IGameRuntime, RuntimeRef } from "../runtime/types";

/* Waiting for a game to finish saving before its world is archived.

   Some games save the moment they are asked; some start saving in the
   background and say when they are done. Bedrock is the second kind:
   `save hold` begins the save, and `save query` answers "Files are now
   ready to be copied" once it has finished. A fixed pause before the
   archive — two seconds, which is what every game used to get — is
   enough for a new world and not for a large one, and the archive of a
   world halfway through a save is the one backup nobody can restore.

   So the backup asks, reads the console for the answer, and asks again
   until it hears it or runs out of patience. Running out is not a
   failure: saving is paused while the game waits for its resume, so the
   files are not changing, and the archive goes ahead. */

export interface SaveWaitOptions {
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export async function waitForSave(
  runtime: Pick<IGameRuntime, "sendCommand" | "logs">,
  ref: RuntimeRef,
  ready: NonNullable<ConsoleDialect["saveReady"]>,
  since: Date,
  options: SaveWaitOptions = {},
): Promise<boolean> {
  const pollMs = options.pollMs ?? 1_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (ready.timeoutSeconds ?? 60) * 1_000;
  const pattern = new RegExp(ready.pattern);

  /* A breath before the first question. Asked at once, Bedrock answers
     "A previous save has not been completed" — at ERROR level, as a red
     line in the operator's console for a save that was going fine. */
  await sleep(pollMs);

  while (true) {
    await runtime.sendCommand(ref, ready.command).catch(() => {});
    await sleep(pollMs);
    const lines = await runtime.logs(ref, 50, since).catch(() => []);
    if (lines.some((l) => pattern.test(l.line))) return true;
    if (now() >= deadline) return false;
  }
}
