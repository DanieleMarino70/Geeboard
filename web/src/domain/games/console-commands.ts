/* The commands a server says it has (ConsoleDialect.commands), as the console offers them while a command is typed.

   The file is the game's: Garry's Mod writes it from Lua, with the names its addons gave their commands and the help their
   authors wrote. So it is read as text from somewhere else — a size it may not pass, a shape each line has to have, and help
   that is cut short and has no control characters — and drawn as text. A line that is not the shape is left out, not mended. */

export interface ConsoleCommand {
  /** What is typed: `ulx kick`, `ttt_roundrestart`. */
  command: string;
  /** Its arguments, as the game writes them: `<player> [{reason}]`. Empty when it has none or did not say. */
  usage: string;
  /** What it does, in its author's words. Empty when there are none. */
  help: string;
}

/** The most the console is given, which is more than a server with two hundred addons had (about 900). */
export const MAX_COMMANDS = 3000;
/** The most of the file that is read: a list larger than this is a list that is not one. */
export const MAX_COMMANDS_BYTES = 512 * 1024;

/* A command is a word of letters, digits and `_ . + -`, or two (ULX's `ulx kick`), and starts with a letter, a digit or an
   underscore: what a console takes as one, and nothing a reader could mistake for something else. */
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,63}( [A-Za-z0-9_][A-Za-z0-9_.+-]{0,63})?$/;

function plain(text: string | undefined, max: number): string {
  const flat = (text ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function parseConsoleCommands(text: string): ConsoleCommand[] {
  const seen = new Map<string, ConsoleCommand>();
  for (const line of text.slice(0, MAX_COMMANDS_BYTES).split(/\r?\n/)) {
    if (seen.size >= MAX_COMMANDS) break;
    const [name, usage, help] = line.split("\t");
    const command = (name ?? "").trim();
    // One that starts with an underscore is an addon's own plumbing (ULib's `_u`, XGUI's `_xgui`), not something to type.
    if (!NAME.test(command) || command.startsWith("_")) continue;
    // Names are matched as the engine matches them, without regard to case; the first spelling is kept.
    const key = command.toLowerCase();
    if (seen.has(key)) continue;
    seen.set(key, { command, usage: plain(usage, 120), help: plain(help, 200) });
  }
  return [...seen.values()].sort((a, b) => a.command.localeCompare(b.command));
}

/* The commands a typed line could be the start of, best first: those it begins, then those with a word it begins (`kick` finds
   `ulx kick`). Nothing until two characters are typed, and nothing once the line has gone past a command into its arguments. */
export function commandsMatching(commands: ConsoleCommand[], typed: string, limit = 6): ConsoleCommand[] {
  const text = typed.trimStart().toLowerCase();
  if (text.length < 2) return [];
  const starts = commands.filter((c) => c.command.toLowerCase().startsWith(text));
  const words = commands.filter((c) => !starts.includes(c) && c.command.toLowerCase().split(" ").some((word) => word.startsWith(text)));
  return [...starts, ...words].slice(0, limit);
}
