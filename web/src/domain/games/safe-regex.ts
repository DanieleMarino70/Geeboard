/* Which regular expressions a game manifest may carry.

   A manifest holds expressions that the panel runs: on console lines (ready,
   crash, failures, players, health), and on values people type into a setting.
   Node's engine backtracks, and the author of the manifest chooses both the
   expression and — through the image's console — the line it is run against.
   Measured: `^(a+)+$` against 32 characters holds the process for 22 seconds,
   the browser's included, because the settings form checks a value there too.

   This is the first of three defences (D7 in the 0.6.0 plan), and the one that
   reaches the browser: a static check that refuses the shapes that go
   exponential. It is conservative on purpose — a safe expression that is
   refused costs an author a rewrite, an unsafe one that is accepted costs a
   freeze. The second is a timed run at approval (regex-guard.ts), the third a
   timed run on every use for a community game.

   The rules, each one the reason an expression is refused:

     length          at most 200 characters
     syntax          has to compile, with no flags
     references      no back-references, no look-behind: the two ways an
                     expression reads what it has already matched
     repetition      a counted repeat is at most 100, as {n,m}
     unbounded       at most three unbounded quantifiers (`*`, `+`, `{n,}`) in
                     the whole expression: `.*.*.*.*x` is a polynomial of the
                     fourth degree, and a line is up to two thousand characters
     nesting         no unbounded quantifier inside a group that repeats more
                     than three times, and no counted-or-unbounded quantifier
                     inside a group that repeats without a bound: `(a+)+`,
                     `(a*)*`, `(\w+\s?)*`
     alternation     no alternation inside a group that repeats without a
                     bound: `(a|aa)+`, `(a|a)*`

   Pure: a pattern in, a list of reasons out. */

export const MAX_PATTERN_LENGTH = 200;
const MAX_COUNT = 100;
const MAX_UNBOUNDED = 3;

interface Quantifier {
  min: number;
  /** Infinity for `*`, `+` and `{n,}`. */
  max: number;
}

interface Node {
  kind: "group" | "atom";
  quant: Quantifier | null;
  /** For a group: what is inside it. */
  body?: Alternation;
}

interface Alternation {
  branches: Node[][];
}

class Unsafe extends Error {}

/* A small recursive-descent reading of the expression's structure: groups, the
   alternations inside them, and the quantifier each thing carries. It does not
   understand what an atom matches, only that it is one — which is all the rules
   above need. */
function parse(source: string): { tree: Alternation; unbounded: number } {
  let at = 0;
  let unbounded = 0;

  const peek = () => source[at];

  function parseQuantifier(): Quantifier | null {
    const c = peek();
    let q: Quantifier | null = null;
    if (c === "*") {
      at++;
      q = { min: 0, max: Infinity };
    } else if (c === "+") {
      at++;
      q = { min: 1, max: Infinity };
    } else if (c === "?") {
      at++;
      q = { min: 0, max: 1 };
    } else if (c === "{") {
      const match = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(at));
      if (match) {
        const min = Number(match[1]);
        const max = match[2] === undefined ? min : match[3] === "" ? Infinity : Number(match[3]);
        if (min > MAX_COUNT || (Number.isFinite(max) && max > MAX_COUNT)) {
          throw new Unsafe(`a repeat count is over ${MAX_COUNT}`);
        }
        if (Number.isFinite(max) && max < min) throw new Unsafe("a repeat count runs backwards");
        at += match[0].length;
        q = { min, max };
      }
    }
    if (q && peek() === "?") at++; // lazy
    if (q && peek() === "+") throw new Unsafe("a possessive quantifier is not part of the expression language");
    if (q && q.max === Infinity) unbounded++;
    return q;
  }

  function parseAtomText(): void {
    const c = source[at]!;
    if (c === "\\") {
      const next = source[at + 1];
      if (next === undefined) throw new Unsafe("the expression ends in a backslash");
      if (/[1-9]/.test(next)) throw new Unsafe("a back-reference (\\1) reads what the expression already matched");
      if (next === "k") throw new Unsafe("a named back-reference (\\k<name>) reads what the expression already matched");
      at += 2;
      return;
    }
    if (c === "[") {
      at++;
      if (peek() === "^") at++;
      // A `]` first in a class is a literal one.
      if (peek() === "]") at++;
      while (at < source.length && source[at] !== "]") {
        if (source[at] === "\\") at++;
        at++;
      }
      if (source[at] !== "]") throw new Unsafe("a character class is not closed");
      at++;
      return;
    }
    at++;
  }

  function parseGroup(): Node {
    // `(` is already read by the caller's peek; consume it and any group prefix.
    at++;
    if (peek() === "?") {
      const rest = source.slice(at);
      if (rest.startsWith("?<=") || rest.startsWith("?<!")) throw new Unsafe("a look-behind reads text the expression has already passed");
      if (rest.startsWith("?:") || rest.startsWith("?=") || rest.startsWith("?!")) at += 2;
      else if (rest.startsWith("?<")) {
        const close = rest.indexOf(">");
        if (close < 0) throw new Unsafe("a group name is not closed");
        at += close + 1;
      } else throw new Unsafe("an unknown group syntax");
    }
    const body = parseAlternation();
    if (peek() !== ")") throw new Unsafe("a group is not closed");
    at++;
    return { kind: "group", quant: parseQuantifier(), body };
  }

  function parseAlternation(): Alternation {
    const branches: Node[][] = [[]];
    while (at < source.length && peek() !== ")") {
      if (peek() === "|") {
        at++;
        branches.push([]);
        continue;
      }
      if (peek() === "(") {
        branches[branches.length - 1]!.push(parseGroup());
        continue;
      }
      parseAtomText();
      branches[branches.length - 1]!.push({ kind: "atom", quant: parseQuantifier() });
    }
    return { branches };
  }

  const tree = parseAlternation();
  if (at < source.length) throw new Unsafe("a closing parenthesis has no opening one");
  return { tree, unbounded };
}

/* Whether anything inside repeats more than once, and whether any of it has no bound. */
function inside(alt: Alternation): { repeats: boolean; unbounded: boolean; alternates: boolean } {
  let repeats = false;
  let unbounded = false;
  let alternates = alt.branches.length > 1;
  for (const branch of alt.branches) {
    for (const node of branch) {
      if (node.quant && node.quant.max > 1) repeats = true;
      if (node.quant && node.quant.max === Infinity) unbounded = true;
      if (node.body) {
        const nested = inside(node.body);
        repeats ||= nested.repeats;
        unbounded ||= nested.unbounded;
        alternates ||= nested.alternates;
      }
    }
  }
  return { repeats, unbounded, alternates };
}

/* The most times anything inside repeats, counting a group's own repetitions into what it holds: `(a{1,100}){1,100}` is 10,000, `(\d{1,3}\.){3}` is 9.
   Infinity is left to the rule about groups without a bound. */
function repetitions(alt: Alternation): number {
  let most = 1;
  for (const branch of alt.branches) {
    for (const node of branch) {
      const own = node.quant ? node.quant.max : 1;
      const held = node.body ? repetitions(node.body) : 1;
      if (own === Infinity || held === Infinity) continue;
      most = Math.max(most, own * held);
    }
  }
  return most;
}

/* A group repeated a few times around something that repeats a few times is fine and common (an address: `(\d{1,3}\.){3}`). Repeated a hundred
   times around something repeated a hundred times it is `(a+)+` with a ceiling of ten thousand, and a backtracking engine takes a time that
   doubles with every character to refuse a line: `(À{1,100}){1,100}x` took 13 seconds at 30 characters. It passed the analyser, which only looked at
   unbounded repeats, and the probe, which only built ASCII lines (the audit of 0.9.5). */
const MAX_NESTED_REPETITIONS = 64;

function checkNesting(alt: Alternation): string | null {
  for (const branch of alt.branches) {
    for (const node of branch) {
      if (!node.body) continue;
      const within = inside(node.body);
      const q = node.quant;
      if (q && q.max === Infinity) {
        if (within.repeats) return "a group that repeats without a bound holds something that repeats too (`(a+)+`): that is how an expression goes exponential";
        if (within.alternates) return "a group that repeats without a bound holds an alternation (`(a|aa)+`): the branches can match the same text in several ways";
      } else if (q && q.max > 3 && within.unbounded) {
        return "a group repeated more than three times holds something with no bound";
      }
      if (q && q.max > 1 && q.max !== Infinity && within.repeats && !within.unbounded) {
        const product = q.max * repetitions(node.body);
        if (product > MAX_NESTED_REPETITIONS) {
          return `a group repeated up to ${q.max} times holds something that repeats too, ${product} repetitions in all (the most is ${MAX_NESTED_REPETITIONS}): that is \`(a+)+\` with a ceiling, and it goes exponential all the same`;
        }
      }
      const deeper = checkNesting(node.body);
      if (deeper) return deeper;
    }
  }
  return null;
}

/** Why an expression may not be in a manifest, one sentence each; empty when it may. */
export function regexProblems(pattern: string): string[] {
  if (typeof pattern !== "string" || pattern.length === 0) return ["the expression is empty"];
  if (pattern.length > MAX_PATTERN_LENGTH) return [`the expression is ${pattern.length} characters; the most is ${MAX_PATTERN_LENGTH}`];
  if (/[\u0000-\u001f\u007f]/.test(pattern)) return ["the expression holds a control character"];
  try {
    new RegExp(pattern);
  } catch {
    return ["the expression does not compile"];
  }
  try {
    const { tree, unbounded } = parse(pattern);
    if (unbounded > MAX_UNBOUNDED) {
      return [`the expression has ${unbounded} quantifiers with no bound (\`*\`, \`+\`, \`{n,}\`); the most is ${MAX_UNBOUNDED}`];
    }
    const nesting = checkNesting(tree);
    return nesting ? [nesting] : [];
  } catch (error) {
    if (error instanceof Unsafe) return [error.message];
    throw error;
  }
}
