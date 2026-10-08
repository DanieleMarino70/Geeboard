import type { Role } from "@prisma/client";
import { scopeOf, type Permission, type Scope } from "./permissions";

/* Who may read the text of a console command in the audit log.

   Every command typed into a console is written to the log with its
   text, and every account reads the log — but a member may watch only
   their own server's console, and a command is part of its console: it
   is echoed there, and it can be `password <x>`, a ban with a reason, a
   whitelist. So the text of a `console.command` line is shown to whoever
   may watch that server's console, and to nobody else; the line itself —
   who, when, which server — stays, because that is what an audit log is
   for. A key's scopes narrow this like everything else: one without
   `console:write` sees no command's text.

   A deleted server's owner is not kept, so its commands are shown only
   to those who may watch every console. */

/** What a line says in place of a command its reader may not see. */
export const COMMAND_NOT_SHOWN = "command not shown";

export interface CommandReader {
  id: string;
  /** How far `server.console.read` reaches for this reader. */
  reach: Scope;
}

export function commandReader(actor: { id: string; role: Role }, scopes?: Set<Permission> | null): CommandReader {
  const reach = scopes && !scopes.has("server.console.read") ? "none" : scopeOf(actor.role, "server.console.read");
  return { id: actor.id, reach };
}

function beyondReach(reader: CommandReader, event: { server?: { ownerId: string } | null }): boolean {
  if (reader.reach === "all") return false;
  if (reader.reach === "own") return event.server?.ownerId !== reader.id;
  return true;
}

/** Whether this reader is kept from this line's target. */
export function commandHidden(
  reader: CommandReader,
  event: { action: string; server?: { ownerId: string } | null },
): boolean {
  if (event.action !== "console.command") return false;
  return beyondReach(reader, event);
}

/* A scheduled task keeps the text it will type, and the line that records making or changing it carries that text as `Payload` in what it
   changed. It is the same text a console line would have kept, so it is read by the same people (the audit of 0.9.5 found the log saying what
   the console line was careful not to). The line stays; the text is replaced by the words a console line uses. */
const TASK_LINES = new Set(["task.created", "task.updated"]);

/** Whether this reader is kept from the text a task line carries in its changes. */
export function payloadHidden(
  reader: CommandReader,
  event: { action: string; server?: { ownerId: string } | null },
): boolean {
  if (!TASK_LINES.has(event.action)) return false;
  return beyondReach(reader, event);
}

/** The changes of a line with the text of a command taken out, when its reader may not read one. */
export function changesFor(reader: CommandReader, event: { action: string; changes?: unknown; server?: { ownerId: string } | null }): unknown {
  const changes = event.changes;
  if (!payloadHidden(reader, event)) return changes;
  if (typeof changes !== "object" || changes === null || Array.isArray(changes) || !("Payload" in changes)) return changes;
  return { ...(changes as Record<string, unknown>), Payload: { from: "—", to: COMMAND_NOT_SHOWN } };
}
