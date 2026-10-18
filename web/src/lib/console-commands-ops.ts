import "server-only";
import type { User } from "@prisma/client";
import { SERVER_OPERATION_PERMISSION as NEEDS } from "@/domain/access/operations";
import { parseConsoleCommands, type ConsoleCommand } from "@/domain/games/console-commands";
import { findGame } from "@/domain/games/registry";
import type { GameDefinition } from "@/domain/games/types";
import { runtimeFor } from "@/domain/runtime/docker";
import { readFromNode, type ReadableNode } from "./node-read";
import { authorize, refFor, sendConsoleCommandOp, type OpResult } from "./server-ops";

/* The commands a server says it has (ConsoleDialect.commands), for the console to offer as a command is typed.

   Two halves. The list the game last wrote is read with the console page, best effort and within its budget: a node that is
   away, or a server that has never been asked, is no list, and the console offers its examples alone. And **Find commands**
   asks again: it takes the old list off, types the game's lines at its console — through the console's own operation, so each
   is checked, refused on a stopped server and kept in the audit log like any other command — and reads the new one back. */

export async function consoleCommandsOnNode(
  server: { id: string; runtimeId: string | null; gameId: string | null; node: ReadableNode },
): Promise<ConsoleCommand[]> {
  const listing = listingOf(server.gameId);
  if (!listing || !server.runtimeId) return [];
  const ref = refFor({ id: server.id, runtimeId: server.runtimeId });
  const read = await readFromNode(server.node, (runtime) => runtime.files.read(ref, listing.file).catch(() => null));
  return read.ok && read.value ? parseConsoleCommands(read.value.content) : [];
}

export type FoundCommands = OpResult & { commands?: ConsoleCommand[] };

/* How long the game is given to write the list once it has read the last line. A server busy loading a map reads its console
   late; on one that was idle the file was there within a second. */
const WAIT_MS = 8000;
const POLL_MS = 750;

export async function findConsoleCommandsOp(user: User, slug: string): Promise<FoundCommands> {
  const auth = await authorize(user, slug, NEEDS.consoleCommand);
  if (!auth.ok) return { ok: false, title: "Cannot ask", body: auth.error };
  const { server, node } = auth;
  const game = server.gameId ? findGame(server.gameId) : undefined;
  const listing = listingOf(server.gameId);
  if (!game || !listing) {
    return { ok: false, title: "Nothing to ask", body: `${game?.name ?? "This game"}'s console cannot list its commands.` };
  }
  const runtime = runtimeFor(node);
  if (!runtime || !server.runtimeId) {
    return { ok: false, title: "No agent on this node", body: `${node.name} has no agent attached, so nothing can reach the server's console.` };
  }
  const ref = refFor(server);

  // The old list goes first, so that the one read back is the one this asked for and not the last.
  await runtime.files.remove(ref, listing.file).catch(() => {});
  for (const line of listing.ask) {
    const sent = await sendConsoleCommandOp(user, slug, line);
    if (!sent.ok) return sent;
  }

  for (let waited = 0; waited < WAIT_MS; waited += POLL_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const file = await runtime.files.read(ref, listing.file).catch(() => null);
    if (!file) continue;
    const commands = parseConsoleCommands(file.content);
    return {
      ok: true,
      tone: commands.length > 0 ? "success" : "warning",
      title: `${commands.length} command${commands.length === 1 ? "" : "s"} found`,
      body: commands.length > 0 ? "They are offered as you type, with what each takes." : `${server.name} wrote an empty list.`,
      commands,
    };
  }
  return {
    ok: false,
    title: "No list came back",
    body: `${server.name} did not write ${listing.file} within ${WAIT_MS / 1000} seconds. Its console says why.`,
  };
}

function listingOf(gameId: string | null): NonNullable<GameDefinition["console"]["commands"]> | undefined {
  return gameId ? findGame(gameId)?.console.commands : undefined;
}
