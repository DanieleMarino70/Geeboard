import vm from "node:vm";

/* The second and third defences against a manifest's regular expressions
   (the first is safe-regex.ts, which also reaches the browser).

   `vm` is not a security boundary and is not used as one. It is used for the
   one thing it does well here: a script run with `timeout` is interrupted
   while a backtracking expression is still going, which a plain `.test()` is
   not. Measured: `^(a+)+$` against 40 characters is cut off after 101 ms with
   a limit of 100.

     probeRegex   at approval. Runs the expression against lines built to hurt
                  it — each of the characters it names, repeated to the length
                  of a console line — and reports the first that costs more
                  than a few milliseconds, so an owner reading the preview sees
                  it before they approve.
     safeExec     on every use, for a game that came from a manifest. The same
                  run with a smaller budget and the line cut to what the panel
                  keeps of one. An expression that overruns is reported as
                  timed out, and the caller stops asking it.

   The games Geeboard ships are not run through here: their expressions are
   code that was read and tested, and a change to how they are matched is a
   change to the games. Server side only (node:vm). */

export const MAX_LINE = 2000;
export const APPROVAL_BUDGET_MS = 40;
export const RUNTIME_BUDGET_MS = 25;

const CACHE_LIMIT = 500;

interface Compiled {
  context: vm.Context;
  script: vm.Script;
}
const cache = new Map<string, Compiled>();

/* One context and one compiled script per pattern, kept: building a context
   per line would cost more than the match. The expression is built inside the
   context, so it is a RegExp of that realm and the timeout reaches it. */
function compiled(pattern: string): Compiled {
  const found = cache.get(pattern);
  if (found) return found;
  const context = vm.createContext({ pattern, subject: "", result: null as string | null });
  vm.runInContext("var re = new RegExp(pattern);", context);
  const script = new vm.Script(
    "var m = re.exec(subject); result = m ? JSON.stringify({ m: Array.from(m), g: m.groups ? Object.assign({}, m.groups) : null }) : null;",
  );
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  const entry = { context, script };
  cache.set(pattern, entry);
  return entry;
}

export interface GuardedMatch {
  /** Every capture, whole match first. */
  groups: string[];
  /** The named groups, or null when the expression has none. */
  named: Record<string, string> | null;
}

export type GuardedResult = { timedOut: false; match: GuardedMatch | null } | { timedOut: true; match: null };

/** Runs `pattern` on `text` within `budgetMs`. A line longer than MAX_LINE is cut: nothing the panel reads is longer. */
export function safeExec(pattern: string, text: string, budgetMs: number = RUNTIME_BUDGET_MS): GuardedResult {
  let entry: Compiled;
  try {
    entry = compiled(pattern);
  } catch {
    // An expression that does not compile never matches; it was refused at approval, so this is a row somebody edited.
    return { timedOut: false, match: null };
  }
  entry.context.subject = text.length > MAX_LINE ? text.slice(0, MAX_LINE) : text;
  entry.context.result = null;
  try {
    entry.script.runInContext(entry.context, { timeout: budgetMs });
  } catch {
    return { timedOut: true, match: null };
  }
  const raw = entry.context.result as string | null;
  if (!raw) return { timedOut: false, match: null };
  const parsed = JSON.parse(raw) as { m: Array<string | null>; g: Record<string, string> | null };
  return { timedOut: false, match: { groups: parsed.m.map((x) => x ?? ""), named: parsed.g } };
}

/** The boolean form, for an expression that only has to say yes or no. A timeout is a no. */
export function safeTest(pattern: string, text: string, budgetMs: number = RUNTIME_BUDGET_MS): { matched: boolean; timedOut: boolean } {
  const result = safeExec(pattern, text, budgetMs);
  return { matched: result.match !== null, timedOut: result.timedOut };
}

/* Lines built to hurt an expression: each literal it names, repeated to the length of a console line and followed by
   something that cannot match, and a few shapes that hurt the usual mistakes (words, numbers, dotted runs). */
export function adversarialInputs(pattern: string): string[] {
  const literals = new Set<string>();
  const stripped = pattern.replace(/\\./g, (m) => (/[dDwWsSbB]/.test(m[1]!) ? "" : m[1]!));
  for (const ch of stripped) {
    if (/[A-Za-z0-9 _.:\-[\]/]/.test(ch)) literals.add(ch);
    if (literals.size >= 8) break;
  }
  const inputs = new Set<string>();
  for (const ch of [...literals, "a", " ", "0", ".", "x"]) inputs.add(`${ch.repeat(MAX_LINE)}~`);
  inputs.add(`${"a ".repeat(MAX_LINE / 2)}~`);
  inputs.add(`${"1.".repeat(MAX_LINE / 2)}~`);
  inputs.add(`${"word ".repeat(MAX_LINE / 5)}~`);
  inputs.add(`[${"x".repeat(MAX_LINE - 3)}`);
  return [...inputs];
}

export type Probe = { ok: true } | { ok: false; reason: string; input: string; ms: number };

/** The approval-time run: the first adversarial line that costs more than the budget, if any. */
export function probeRegex(pattern: string, budgetMs: number = APPROVAL_BUDGET_MS): Probe {
  for (const input of adversarialInputs(pattern)) {
    const started = process.hrtime.bigint();
    let timedOut = false;
    try {
      const context = vm.createContext({ pattern, subject: input });
      vm.runInContext("new RegExp(pattern).exec(subject)", context, { timeout: budgetMs });
    } catch {
      timedOut = true;
    }
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (timedOut) {
      return {
        ok: false,
        reason: `a line of ${input.length} characters took more than ${budgetMs} ms to be matched against it`,
        input: input.length > 24 ? `${input.slice(0, 12)}…` : input,
        ms,
      };
    }
  }
  return { ok: true };
}
