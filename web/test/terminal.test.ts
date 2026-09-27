import assert from "node:assert/strict";
import { test } from "node:test";
import { sameOrigin } from "../src/domain/access/origin.ts";
import { acceptSequence, terminalDecision, terminalMessage, type TerminalNodeFacts } from "../src/domain/access/terminal.ts";
import { cleanTerminal } from "../src/domain/nodes/terminal.ts";

/* The node terminal: who may open one, on which node, and the two small
   rules the typing path relies on. Everything here is decided without a
   node or a database, so every refusal a person can be shown is a line
   below. */

const account = (role: "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER", over: { twoFactor?: boolean; passwordSetAt?: Date | null } = {}) => ({
  id: `u-${role.toLowerCase()}`,
  role,
  twoFactor: over.twoFactor ?? true,
  passwordSetAt: over.passwordSetAt === undefined ? new Date(0) : over.passwordSetAt,
});

const ON: TerminalNodeFacts["terminal"] = { state: "on", os: "windows", user: "giorg", shell: "powershell.exe", scope: "machine" };
const node = (over: Partial<TerminalNodeFacts> = {}): TerminalNodeFacts => ({
  name: "win-node-01",
  approvedAt: new Date(0),
  daemonUrl: "http://192.168.0.100:8080",
  daemonToken: "v1.enc",
  daemon: "0.3.5",
  terminal: ON,
  ...over,
});

const code = (decision: ReturnType<typeof terminalDecision>) => (decision.ok ? null : decision.code);

test("an owner with two-factor opens a terminal on an approved node whose machine allows it", () => {
  assert.deepEqual(terminalDecision(account("OWNER"), node()), { ok: true });
});

test("the sign-in and the account gate come first, as for every stream", () => {
  assert.equal(code(terminalDecision(null, node())), "signed-out");
  assert.equal(code(terminalDecision(account("OWNER", { passwordSetAt: null }), node())), "password");
  assert.equal(code(terminalDecision(account("OWNER", { twoFactor: false }), node())), "two-factor");
});

test("only an owner: an admin is refused by the matrix, whatever the node says", () => {
  assert.equal(code(terminalDecision(account("ADMIN"), node())), "forbidden");
  assert.equal(code(terminalDecision(account("MODERATOR"), node())), "forbidden");
  assert.equal(code(terminalDecision(account("MEMBER"), node())), "forbidden");
  assert.match(terminalMessage("forbidden", node()), /Only an owner/);
});

test("the node has to be there, approved, and carry an agent", () => {
  const owner = account("OWNER");
  assert.equal(code(terminalDecision(owner, null)), "node-gone");
  assert.equal(code(terminalDecision(owner, node({ approvedAt: null }))), "node-pending");
  assert.equal(code(terminalDecision(owner, node({ daemonUrl: null }))), "no-agent");
  assert.equal(code(terminalDecision(owner, node({ daemonToken: null }))), "no-agent");
  assert.match(terminalMessage("node-pending", node()), /win-node-01 is waiting for approval/);
});

test("what the machine said decides the rest: never said, off, or cannot", () => {
  const owner = account("OWNER");
  assert.equal(code(terminalDecision(owner, node({ terminal: null, daemon: "0.3.2" }))), "agent-old");
  assert.match(terminalMessage("agent-old", node({ daemon: "0.3.2" })), /runs agent 0\.3\.2, which has no terminal/);
  assert.equal(code(terminalDecision(owner, node({ terminal: { ...ON, state: "off" } }))), "terminal-off");
  assert.match(terminalMessage("terminal-off", node()), /GEEBOARD_TERMINAL=1/);
  const cannot = node({ terminal: { ...ON, state: "unavailable", reason: "the PTY library is not installed" } });
  assert.equal(code(terminalDecision(owner, cannot)), "terminal-unavailable");
  assert.match(terminalMessage("terminal-unavailable", cannot), /cannot open one: the PTY library is not installed/);
});

test("a descriptor is kept only in the shape the agent speaks", () => {
  assert.deepEqual(cleanTerminal(ON), ON);
  assert.deepEqual(cleanTerminal({ ...ON, reason: "x", extra: "dropped" }), { ...ON, reason: "x" });
  assert.equal(cleanTerminal(null), null);
  assert.equal(cleanTerminal("on"), null);
  assert.equal(cleanTerminal({ ...ON, state: "maybe" }), null);
  assert.equal(cleanTerminal({ ...ON, scope: "host" }), null);
  assert.equal(cleanTerminal({ ...ON, user: "" }), null);
  assert.equal(cleanTerminal({ ...ON, shell: "x".repeat(201) }), null);
  assert.equal(cleanTerminal({ ...ON, os: "linux\nrm" }), null, "a control character is not a name");
});

test("typing is numbered, taken once, and never out of order", () => {
  assert.deepEqual(acceptSequence(-1, 0), { accept: true, last: 0 });
  assert.deepEqual(acceptSequence(0, 1), { accept: true, last: 1 });
  assert.deepEqual(acceptSequence(1, 1), { accept: false, last: 1 }, "a repeat is not typed twice");
  assert.deepEqual(acceptSequence(5, 3), { accept: false, last: 5 }, "an older one is not typed after a newer");
  assert.deepEqual(acceptSequence(5, 9), { accept: true, last: 9 }, "a gap is the browser's to worry about");
  assert.deepEqual(acceptSequence(5, "6"), { accept: false, last: 5 });
  assert.deepEqual(acceptSequence(5, 6.5), { accept: false, last: 5 });
});

test("typing has to come from the panel's own page", () => {
  const request = (headers: Record<string, string>) => new Request("http://panel.example/api/terminal/x/input", { method: "POST", headers });
  assert.equal(sameOrigin(request({ origin: "http://panel.example", host: "panel.example" })), true);
  assert.equal(sameOrigin(request({ origin: "https://Panel.Example", host: "panel.example" })), true, "the scheme is not the point; the host is");
  assert.equal(sameOrigin(request({ origin: "http://panel.example", "x-forwarded-host": "panel.example", host: "127.0.0.1:3000" })), true, "behind a proxy, the host the proxy was asked for");
  assert.equal(sameOrigin(request({ origin: "http://evil.example", host: "panel.example" })), false);
  assert.equal(sameOrigin(request({ host: "panel.example" })), false, "no Origin is not a page of ours");
  assert.equal(sameOrigin(request({ origin: "not a url", host: "panel.example" })), false);
});
