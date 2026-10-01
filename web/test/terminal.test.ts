import assert from "node:assert/strict";
import { test } from "node:test";
import { sameOrigin } from "../src/domain/access/origin.ts";
import { acceptSequence, plainHttpRisk, terminalDecision, terminalMessage, type TerminalNodeFacts } from "../src/domain/access/terminal.ts";
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

/* What crosses a network in the clear. A terminal carries keystrokes and
   what the shell prints, and the panel reaches most agents over plain HTTP:
   fine on a private network or the loopback, not across the Internet. */

test("plain HTTP to a private or loopback address may carry a terminal", () => {
  const owner = account("OWNER");
  for (const url of [
    "http://192.168.0.100:8080",
    "http://10.1.2.3:8711",
    "http://172.16.5.5:8711",
    "http://172.31.255.254:8711",
    "http://127.0.0.1:8711",
    "http://[::1]:8711",
    "http://[fd12:3456::1]:8711",
    "http://[fe80::1]:8711",
    "http://169.254.10.10:8711",
    "http://100.64.0.9:8711",
  ]) {
    assert.deepEqual(terminalDecision(owner, node({ daemonUrl: url })), { ok: true }, url);
  }
});

test("plain HTTP to a public address is refused, with why and what to do", () => {
  const owner = account("OWNER");
  for (const url of ["http://203.0.113.9:8080", "http://8.8.8.8:8711", "http://172.32.0.1:8711", "http://[2001:db8::1]:8711", "http://[::ffff:8.8.8.8]:8711"]) {
    const facts = node({ daemonUrl: url });
    assert.equal(code(terminalDecision(owner, facts)), "plain-http", url);
    const said = terminalMessage("plain-http", facts);
    assert.match(said, /plain HTTP at a public address/, url);
    assert.match(said, /unencrypted/);
    assert.match(said, /TLS/);
    assert.match(said, /private network/);
  }
  assert.match(terminalMessage("plain-http", node({ daemonUrl: "http://203.0.113.9:8080" })), /203\.0\.113\.9/, "names the address");
});

test("a name is not known to be private, so plain HTTP to one is refused too", () => {
  const owner = account("OWNER");
  for (const url of ["http://node.example.com:8080", "http://fra-node-02.internal:8711", "http://localhost:8711", "http://agent:8080"]) {
    const facts = node({ daemonUrl: url });
    assert.equal(code(terminalDecision(owner, facts)), "plain-http", url);
    assert.match(terminalMessage("plain-http", facts), /a name can point anywhere/, url);
    assert.match(terminalMessage("plain-http", facts), /IP address/);
  }
});

test("https is always allowed, at any address", () => {
  const owner = account("OWNER");
  for (const url of ["https://node.example.com", "https://203.0.113.9:8711", "https://192.168.0.100:8711", "https://localhost:8711", "https://[2001:db8::1]:8711"]) {
    assert.deepEqual(terminalDecision(owner, node({ daemonUrl: url })), { ok: true }, url);
  }
});

test("an address nobody can read, or another scheme, is treated as not known to be private", () => {
  assert.equal(plainHttpRisk("not a url")?.kind, "name");
  assert.equal(plainHttpRisk("ftp://192.168.0.1/")?.kind, "name");
  assert.equal(plainHttpRisk(null), null, "no address is for the no-agent refusal to say");
  assert.equal(plainHttpRisk(""), null);
});

test("the road is judged last: a machine that says no is told so, and an unapproved or agentless node first", () => {
  const owner = account("OWNER");
  const out = "http://203.0.113.9:8080";
  assert.equal(code(terminalDecision(owner, node({ daemonUrl: out, terminal: { ...ON, state: "off" } }))), "terminal-off");
  assert.equal(code(terminalDecision(owner, node({ daemonUrl: out, terminal: null }))), "agent-old");
  assert.equal(code(terminalDecision(owner, node({ daemonUrl: out, approvedAt: null }))), "node-pending");
  assert.equal(code(terminalDecision(account("ADMIN"), node({ daemonUrl: out }))), "forbidden", "and the matrix before all of it");
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
