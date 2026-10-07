import { safeExec } from "./regex-guard";
import type { GameDefinition } from "./types";

/* How the panel matches a game's expressions against what its console prints.

   The games Geeboard ships are matched as they always were: the expression is
   code that was read, and a line is a line. An expression that came from a
   manifest is somebody else's, and the line is whatever the image prints, so
   those go through `safeExec`: a time limit on every match and the line cut
   to what the panel keeps of one (regex-guard.ts).

   Which is which is decided by the *pattern*, not by threading a game through
   the nine functions that match one: `guardPatterns` is given every expression
   of every approved community game, and a pattern in that set is guarded
   wherever it is used. A shipped game that happens to use the same text is
   guarded too, which costs it a few microseconds and nothing else.

   An expression that overruns its limit is *broken*: it is not run again, and
   `brokenPatterns` says so for the game's page, until a new revision brings a
   different set. Server side only. */

const guarded = new Set<string>();
const broken = new Set<string>();
/* A shipped game's expression is compiled once. null is one that does not compile. */
const compiled = new Map<string, RegExp | null>();

function compile(pattern: string): RegExp | null {
  let found = compiled.get(pattern);
  if (found === undefined) {
    try {
      found = new RegExp(pattern);
    } catch {
      found = null;
    }
    if (compiled.size > 500) compiled.clear();
    compiled.set(pattern, found);
  }
  return found;
}

/** Every expression a definition holds that the panel runs on a console line. */
export function consolePatternsOf(game: Pick<GameDefinition, "health" | "console">): string[] {
  const out: string[] = [];
  const add = (p: string | undefined) => {
    if (p) out.push(p);
  };
  add(game.health.readyPattern);
  add(game.health.crashPattern);
  for (const f of game.health.failures ?? []) add(f.pattern);
  for (const probe of game.health.probes) if (probe.kind === "log") add(probe.pattern);
  add(game.console.players?.join);
  add(game.console.players?.leave);
  add(game.console.players?.connect);
  add(game.console.healthLines);
  add(game.console.saveReady?.pattern);
  return out;
}

/** Replaces the set of expressions that are guarded, and forgives the ones that had overrun. */
export function guardPatterns(patterns: Iterable<string>): void {
  guarded.clear();
  broken.clear();
  for (const p of patterns) guarded.add(p);
}

/** Whether an expression is run under a time limit. */
export function isGuarded(pattern: string): boolean {
  return guarded.has(pattern);
}

/** The guarded expressions that overran their limit since the set was last replaced. */
export function brokenPatterns(): string[] {
  return [...broken];
}

export interface PatternMatch {
  /** The named groups, or undefined when the expression has none. */
  groups: Record<string, string> | undefined;
}

/* How many times a line is tried before an expression is called broken, as the approval probe does (PROBE_ATTEMPTS in regex-guard.ts). The
   watchdog that cuts a match off fires when its thread is not scheduled as much as when the expression is slow: one 25 ms stall on a machine
   busy with a backup or a game marked a good expression broken for the life of the process, and its game stopped counting players. A
   backtracking one is cut off on every try, so it costs three budgets and is broken all the same. */
export const MATCH_ATTEMPTS = 3;

type Runner = typeof safeExec;
let onBroken: ((pattern: string) => void) | null = null;

/** Called once for each expression that is called broken, so that the process says so: the game's page lists them, and the log did not. */
export function whenBroken(listener: ((pattern: string) => void) | null): void {
  onBroken = listener;
}

/** `pattern.exec(line)`, guarded where the expression is a community game's. An expression that does not compile does not match. */
export function execPattern(pattern: string, line: string, run: Runner = safeExec): PatternMatch | null {
  if (!guarded.has(pattern)) {
    const m = compile(pattern)?.exec(line);
    return m ? { groups: m.groups ? { ...m.groups } : undefined } : null;
  }
  if (broken.has(pattern)) return null;
  let result = run(pattern, line);
  for (let attempt = 1; attempt < MATCH_ATTEMPTS && result.timedOut; attempt++) result = run(pattern, line);
  if (result.timedOut) {
    broken.add(pattern);
    onBroken?.(pattern);
    return null;
  }
  return result.match ? { groups: result.match.named ?? undefined } : null;
}

export function testPattern(pattern: string, line: string): boolean {
  return execPattern(pattern, line) !== null;
}
