import "server-only";
import { withDeadline } from "@/domain/concurrency";
import { asPlatformError } from "@/domain/errors";
import { awaySentence, nodeAway } from "@/domain/nodes/away";
import { runtimeFor, type DockerRuntime } from "@/domain/runtime/docker";
import { bare } from "@/domain/text";

/* Asking a node something while a page is drawn.

   The console page asked for a thousand lines of a server's log and the settings page for each of its game's config files in turn, at
   the call's own limit of ten seconds, and neither looked at the node first. A node is called degraded after thirty seconds of silence
   and unreachable after two minutes: for the first minute and a half the pages froze for ten seconds, and for twenty on a game with two
   files (Project Zomboid), on a navigation that shows nothing until it is whole, and then drew empty. The page that has to ask now
   asks for no longer than a card is worth (two and a half seconds, which the connection itself is given as its limit, so that the call
   is cut off and not only waited out) and does not ask at all of a node the panel already knows is away. */

export const RENDER_BUDGET_MS = 2_500;

export interface ReadableNode {
  name: string;
  state: string;
  daemonUrl: string | null;
  daemonToken: string | null;
}

export type NodeRead<T> = { ok: true; value: T } | { ok: false; why: "no-agent" | "away" | "failed"; message: string };

const SLOW = Symbol("slow");

export async function readFromNode<T>(node: ReadableNode, work: (runtime: DockerRuntime) => Promise<T>, budgetMs = RENDER_BUDGET_MS): Promise<NodeRead<T>> {
  const away = nodeAway({ state: node.state, lastReachedAt: null });
  if (away) return { ok: false, why: "away", message: `${awaySentence(node.name, away)}, so it was not asked.` };

  const runtime = runtimeFor(node, { timeoutMs: budgetMs });
  if (!runtime) return { ok: false, why: "no-agent", message: `${node.name} has no agent attached.` };

  try {
    // The connection's own limit is the budget; this is the backstop for a call made of several.
    const value = await withDeadline<T, typeof SLOW>(work(runtime), budgetMs + 500, () => SLOW);
    if (value === SLOW) return { ok: false, why: "failed", message: `${node.name} did not answer within ${bare(String(budgetMs / 1000))} seconds.` };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, why: "failed", message: asPlatformError(error, `reading from ${node.name}`).message };
  }
}
