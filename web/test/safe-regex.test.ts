import assert from "node:assert/strict";
import { test } from "node:test";
import { regexProblems } from "../src/domain/games/safe-regex.ts";
import { PROBE_ATTEMPTS, adversarialInputs, probeRegex, safeExec, safeTest } from "../src/domain/games/regex-guard.ts";

/* The three defences against a manifest's regular expressions: a static
   check that also protects the browser, a timed run at approval, and a timed
   run on every use. The cases are the shapes that actually go wrong. */

const refused = (pattern: string) => regexProblems(pattern).length > 0;

test("the expressions games really use are accepted", () => {
  for (const pattern of [
    "^\\[[^\\]]*\\]: (?<name>[^ ]+) joined the game$",
    "^(?<name>\\S+) left the game$",
    "Done \\([0-9.]+s\\)! For help",
    "Server started",
    "^[a-zA-Z0-9_ .-]+$",
    "^[^/\\\\]+\\.wld$",
    "(\\d{1,3}\\.){3}\\d{1,3}",
    "^(?:\\d+)-(?:\\d+)$",
    "(?:error|fatal): (?<what>.*)",
    "^\\w+(?:\\.\\w+){0,3}$",
  ]) {
    assert.deepEqual(regexProblems(pattern), [], pattern);
  }
});

test("a group that repeats without a bound may not hold something that repeats: the exponential shapes", () => {
  for (const pattern of ["^(a+)+$", "(a*)*b", "^(\\w+\\s?)*$", "(x+x+)+y", "^(.*a){20}$x", "((a+))+", "(?:a+)*", "(a{1,50})+", "(\\d+,?)+$"]) {
    assert.ok(refused(pattern), pattern);
  }
  assert.match(regexProblems("^(a+)+$")[0]!, /repeats too/);
});

test("an alternation inside a group that repeats without a bound is refused: the branches can match the same text twice", () => {
  for (const pattern of ["(a|aa)+", "(a|a)*b", "^(foo|foobar)+$", "(?:x|y)*z"]) assert.ok(refused(pattern), pattern);
  assert.match(regexProblems("(a|aa)+")[0]!, /alternation/);
  // The same alternation outside a loop is how a line is told from another.
  assert.deepEqual(regexProblems("^(joined|left) the game$"), []);
});

test("a group repeated a few times holds nothing unbounded", () => {
  assert.ok(refused("(a+){5}"));
  assert.ok(refused("(\\w*){4}"));
  assert.deepEqual(regexProblems("(a+){2}"), [], "twice is polynomial, not exponential");
  assert.deepEqual(regexProblems("(\\d{1,3}){3}"), []);
  assert.ok(refused("^\\w+(?:\\.\\w+){0,4}$"), "four repeats of something unbounded: refused even where it would have been safe");
});

test("more than three unbounded quantifiers is a polynomial that a long line makes fatal", () => {
  assert.ok(refused(".*.*.*.*x"));
  assert.ok(refused("a+b+c+d+"));
  assert.deepEqual(regexProblems(".*a.*b.*"), []);
  assert.match(regexProblems(".*.*.*.*x")[0]!, /4 quantifiers with no bound/);
});

test("back-references and look-behind are refused: the two ways to read what has already been matched", () => {
  for (const pattern of ["(a)\\1", "(?<x>a)\\k<x>", "(?<=a)b", "(?<!a)b"]) assert.ok(refused(pattern), pattern);
});

test("counts are bounded, and one that runs backwards is a mistake", () => {
  assert.ok(refused("a{1,101}"));
  assert.ok(refused("a{101}"));
  assert.ok(refused("a{5,2}"));
  assert.deepEqual(regexProblems("a{0,100}"), []);
});

test("what is not an expression is refused with a reason, not thrown", () => {
  for (const pattern of ["", "(", "a)", "[abc", "a**", "\\", "(?z)", "x".repeat(201), "a\u0000b", "a\nb"]) {
    assert.ok(refused(pattern), JSON.stringify(pattern));
  }
  assert.match(regexProblems("x".repeat(201))[0]!, /201 characters/);
  assert.match(regexProblems("(")[0]!, /compile/);
});

test("a class is read as one atom, whatever is in it", () => {
  assert.deepEqual(regexProblems("^[(+*?{|)]+$"), []);
  assert.deepEqual(regexProblems("^[^\\]]*$"), []);
  assert.deepEqual(regexProblems("^[]a]+$"), []);
});

/* ── The timed run at approval ────────────────────────────────── */

test("an expression that passes the static check and is still fatal is caught by the timed run", () => {
  // Three unbounded quantifiers: allowed statically, and a cubic on a 2000-character line.
  const pattern = ".*.*.*x";
  assert.deepEqual(regexProblems(pattern), []);
  const result = probeRegex(pattern);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.reason : "", /took more than 40 ms/);
});

test("a fatal expression is also fatal to the probe's own clock: it comes back in about the budget", () => {
  const started = Date.now();
  const result = probeRegex("^(a+)+$", 50);
  assert.equal(result.ok, false);
  assert.ok(Date.now() - started < 1500, `${Date.now() - started} ms`);
});

/* The watchdog that cuts a script off at the budget is as likely to fire because its thread was not scheduled as because
   the expression is slow. A good expression was refused on a machine that was busy, and these hold what is done about it:
   a line is tried again, and an expression is slow only when it is on every try. */
test("a line that is cut off once and not again is not slow", () => {
  let tries = 0;
  const flaky = () => ++tries === 1; // cut off the first time it is asked, and never again
  assert.deepEqual(probeRegex("Server started", 40, flaky), { ok: true });
  assert.ok(tries > 1, "the first line was tried again");
  let calls = 0;
  const twice = () => ++calls <= 2;
  assert.deepEqual(probeRegex("Server started", 40, twice), { ok: true }, "cut off twice, and then not");
});

test("an expression that is cut off on every try is slow, and costs three tries and not one", () => {
  let calls = 0;
  const always = () => (calls++, true);
  const result = probeRegex("Server started", 40, always);
  assert.equal(result.ok, false);
  assert.equal(calls, PROBE_ATTEMPTS, "three tries of the first line, and none after it");
  assert.equal(PROBE_ATTEMPTS, 3);
  assert.match(!result.ok ? result.reason : "", /took more than 40 ms/);
});

test("ordinary expressions pass the timed run, including the real ones", () => {
  for (const pattern of ["^\\[[^\\]]*\\]: (?<name>[^ ]+) joined the game$", "Server started", "^(joined|left) the game$", "Done \\([0-9.]+s\\)!"]) {
    assert.deepEqual(probeRegex(pattern), { ok: true }, pattern);
  }
});

test("the lines it tries are built from the expression's own characters, and are as long as a console line", () => {
  const inputs = adversarialInputs("^\\[ready\\]: (?<name>\\w+)$");
  assert.ok(inputs.length >= 5 && inputs.length <= 20);
  assert.ok(inputs.every((line) => line.length >= 1000 && line.length <= 2001));
  assert.ok(inputs.some((line) => line.startsWith("[[[[")), "the bracket the pattern names");
  assert.ok(inputs.some((line) => line.startsWith("aaaa")));
});

/* ── The timed run on every use ───────────────────────────────── */

test("a match comes back as plain data, with its named groups", () => {
  const none = safeExec("^\\[[^\\]]*\\]: (?<name>[^ ]+) joined the game$", "[10:00:01] [Server thread/INFO]: Alex joined the game");
  assert.deepEqual(none, { timedOut: false, match: null }, "the first bracket is closed by the timestamp, not by the second");
  const ok = safeExec("^\\[[^\\]]*\\]: (?<name>[^ ]+) joined the game$", "[Server thread/INFO]: Alex joined the game");
  assert.equal(ok.match?.named?.name, "Alex");
  assert.equal(ok.match?.groups[0], "[Server thread/INFO]: Alex joined the game");
  assert.deepEqual(Object.getPrototypeOf(ok.match?.named ?? {}), Object.prototype, "an object of this realm, not the sandbox's");
});

test("no match is null, and an expression with no named groups says so", () => {
  assert.deepEqual(safeExec("^abc$", "abd"), { timedOut: false, match: null });
  const plain = safeExec("(\\d+)", "port 25565");
  assert.equal(plain.match?.named, null);
  assert.deepEqual(plain.match?.groups, ["25565", "25565"]);
});

test("a fatal expression is cut off at the budget and reported, instead of holding the process", () => {
  const started = Date.now();
  const result = safeExec("^(a+)+$", `${"a".repeat(40)}!`, 25);
  const took = Date.now() - started;
  assert.deepEqual(result, { timedOut: true, match: null });
  assert.ok(took < 500, `${took} ms`);
  assert.deepEqual(safeTest("^(a+)+$", `${"a".repeat(40)}!`), { matched: false, timedOut: true });
});

test("the next line is matched normally after one that timed out", () => {
  safeExec("^(a+)+$", `${"a".repeat(40)}!`, 25);
  assert.deepEqual(safeTest("^(a+)+$", "aaa"), { matched: true, timedOut: false });
});

test("a line longer than a console line is cut before it is matched", () => {
  const long = `${"x".repeat(5000)}needle`;
  assert.deepEqual(safeTest("needle$", long), { matched: false, timedOut: false });
  assert.deepEqual(safeTest("^x+", long), { matched: true, timedOut: false });
});

test("an expression that does not compile never matches, and nobody has to catch it", () => {
  assert.deepEqual(safeExec("(", "text"), { timedOut: false, match: null });
});

test("the same pattern is compiled once", () => {
  const started = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) safeTest("^ready$", i % 2 === 0 ? "ready" : "not");
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms for 2000 lines`);
});

/* One stall is not a verdict. The watchdog that cuts a match off fires when its thread is not scheduled as much as when the expression is
   slow, so the run on every use tries a line three times, as the approval probe does, before an expression is called broken. */
test("a match that stalls once and answers on the second try is not broken", async () => {
  const { MATCH_ATTEMPTS, brokenPatterns, execPattern, guardPatterns, whenBroken } = await import("../src/domain/games/matcher.ts");
  const pattern = "^(?<name>\\S+) joined the game$";
  guardPatterns([pattern]);
  const said: string[] = [];
  whenBroken((p) => said.push(p));
  let calls = 0;
  const stallsOnce: typeof safeExec = (p, text) => {
    calls++;
    return calls === 1 ? { timedOut: true, match: null } : safeExec(p, text);
  };
  assert.deepEqual(execPattern(pattern, "Steve joined the game", stallsOnce)?.groups, { name: "Steve" });
  assert.equal(calls, 2);
  assert.deepEqual(brokenPatterns(), []);
  assert.deepEqual(said, []);

  // One that is cut off on every try is broken: after exactly the attempts it is given, once said, and never run again.
  let tries = 0;
  const alwaysSlow: typeof safeExec = () => {
    tries++;
    return { timedOut: true, match: null };
  };
  assert.equal(execPattern(pattern, "Steve joined the game", alwaysSlow), null);
  assert.equal(tries, MATCH_ATTEMPTS);
  assert.deepEqual(brokenPatterns(), [pattern]);
  assert.deepEqual(said, [pattern]);
  assert.equal(execPattern(pattern, "Steve joined the game", alwaysSlow), null);
  assert.equal(tries, MATCH_ATTEMPTS, "a broken expression is not tried again");
  assert.equal(said.length, 1);

  whenBroken(null);
  guardPatterns([]);
});

/* The audit of 0.9.5 found `(À{1,100}){1,100}x` passing both the static check and the probe: a group repeated a hundred times around something repeated a
   hundred times is `(a+)+` with a ceiling of ten thousand, and the probe only ever built lines of ASCII, so it never tried a letter the pattern was about. */

test("a group repeated many times around something repeated many times is refused, bounded as both are", () => {
  for (const pattern of ["(À{1,100}){1,100}x", "(a{1,100}){1,100}x", "(a{1,10}){1,10}b", "((a{1,5}){1,5}){1,5}$"]) {
    assert.ok(refused(pattern), pattern);
  }
  assert.match(regexProblems("(À{1,100}){1,100}x")[0]!, /ceiling/);
});

test("a few repeats of a few repeats are still fine: an address, a date, a version", () => {
  for (const pattern of ["(\d{1,3}\.){3}\d{1,3}", "^(\d{2}:){2}\d{2}$", "^(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$", "^v?(\d{1,2}\.){1,3}\d{1,2}$"]) {
    assert.deepEqual(regexProblems(pattern), [], pattern);
  }
});

test("the probe tries the letters the pattern names, whatever alphabet they are in", () => {
  const lines = adversarialInputs("(À{1,100}){1,100}x");
  assert.ok(lines.some((line) => line.startsWith("ÀÀÀÀ")), "a line made of À");
  assert.ok(lines.some((line) => line.startsWith("éééé")) && lines.some((line) => line.startsWith("中中中")), "and a filler past ASCII");
});

test("an exponential expression the static check misses is still found by the probe, in any alphabet", () => {
  // Written with an unusual quantifier shape that the analyser does not read as nesting: a bounded group over an alternation of overlapping branches.
  const found = probeRegex("^(?:À|ÀÀ){1,22}!$", 5);
  assert.equal(found.ok, false, "a line of À made it slow");
});
