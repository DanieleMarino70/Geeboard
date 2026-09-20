import { readAgentFile, writeAgentFile, type AgentFile } from "./agent-file.ts";
import type { Config } from "./config.ts";

/* Changing the agent token while the node stays in service.

   The token is the whole of the boundary in front of every container on
   this machine, and until now the only way to change it was to register
   the machine again: a new registration token, `join` run by hand, and a
   node that is out of the panel's reach in between.

   The panel makes the new token and sends it here over the channel the
   old one authenticates — it is never shown to a person and never
   reaches a browser, the same rule the first token follows. Two steps,
   because two parties have to change their minds and either can fail
   between them:

     begin    the new token is saved beside the old one, and both are
              accepted. The panel now records the new one.
     commit   presented with the new token, the old one is forgotten.

   A panel that fails after `begin` still holds a token this agent
   accepts, so a rotation that goes wrong half-way leaves a working node
   rather than a locked one. The old token stays valid until a commit —
   which is the price of that, and why the panel says so when the commit
   does not arrive. Both survive a restart, from the file.

   An agent whose token comes from its environment refuses: the variable
   would win again at the next start, and a rotation that silently
   reverts is worse than one that says it cannot be done. */

export class RotationError extends Error {}

interface Io {
  read: (file: string) => AgentFile | null;
  write: (file: string, contents: AgentFile) => void;
}

const disk: Io = { read: readAgentFile, write: writeAgentFile };

/** Every token a request may present right now. */
export function acceptedTokens(config: Pick<Config, "token" | "previousToken">): string[] {
  return config.previousToken ? [config.token, config.previousToken] : [config.token];
}

export function beginRotation(config: Config, next: unknown, io: Io = disk): void {
  if (typeof next !== "string" || next.length < 32 || next.length > 256 || /\s/.test(next)) {
    throw new RotationError("the new token must be 32 to 256 characters with no whitespace");
  }
  if (config.tokenFromEnvironment || !config.agentFile) {
    throw new RotationError(
      "this agent's token is set by GEEBOARD_DAEMON_TOKEN, which would win again at the next start. Change the variable on the machine and restart the agent.",
    );
  }
  if (next === config.token) throw new RotationError("that is the token already in use");

  const saved = io.read(config.agentFile);
  if (!saved) throw new RotationError("the agent's settings file is gone, so the new token could not be kept");

  // Saved before it is accepted: a token that works until the next restart is a trap.
  const previous = config.token;
  io.write(config.agentFile, { ...saved, token: next, previousToken: previous });
  config.previousToken = previous;
  config.token = next;
}

/** True when there was an old token to forget. */
export function commitRotation(config: Config, presented: string | null, io: Io = disk): boolean {
  if (!config.previousToken) return false;
  // Only the new token may retire the old one — otherwise the old one could retire itself in.
  if (presented !== config.token) throw new RotationError("commit with the new token");

  if (config.agentFile) {
    const saved = io.read(config.agentFile);
    if (saved) {
      const { previousToken: _gone, ...rest } = saved;
      void _gone;
      io.write(config.agentFile, rest);
    }
  }
  config.previousToken = undefined;
  return true;
}
