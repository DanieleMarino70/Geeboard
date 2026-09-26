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

/** Whether this reader is kept from this line's target. */
export function commandHidden(
  reader: CommandReader,
  event: { action: string; server?: { ownerId: string } | null },
): boolean {
  if (event.action !== "console.command") return false;
  if (reader.reach === "all") return false;
  if (reader.reach === "own") return event.server?.ownerId !== reader.id;
  return true;
}
