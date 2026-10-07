import assert from "node:assert/strict";
import { test } from "node:test";
import { choicesOf, cleanKinds, EVENT_CHOICES, kindsOf } from "../src/domain/notify/events.ts";
import {
  afterAttempt,
  cleanReason,
  limitMessages,
  listNames,
  MAX_AGE_MS,
  messagesFor,
  RETRY_DELAYS_MS,
  type AuditEvent,
} from "../src/domain/notify/rules.ts";
import type { NotificationMessage } from "../src/domain/notify/format.ts";

/* From rows of the audit log to the messages worth sending. The shapes of
   the rows are the ones the real poller wrote when they were measured. */

const T0 = Date.parse("2026-10-02T10:00:00Z");
let n = 0;
const server = (id: string, name: string, node = "fra-node-02", over: Partial<NonNullable<AuditEvent["server"]>> = {}) => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  nodeName: node,
  lastExitCode: 1,
  oomKilled: false,
  ...over,
});
const row = (action: string, over: Partial<AuditEvent> & { reason?: string; attempt?: string } = {}): AuditEvent => {
  const { reason, attempt, ...rest } = over;
  return {
    id: `e${String(++n).padStart(4, "0")}`,
    action,
    at: new Date(T0 + n * 100),
    actor: "Watchdog",
    target: null,
    changes: reason ? { Reason: { from: "-", to: reason } } : attempt ? { Attempt: { from: "-", to: attempt } } : { State: { from: "RUNNING", to: "CRASHED" } },
    server: null,
    serverName: null,
    ...rest,
  };
};
const crash = (id: string, name: string, node?: string, over: Partial<NonNullable<AuditEvent["server"]>> = {}) =>
  row("server.crashed", { target: name, server: server(id, name, node, over) });
const restart = (id: string, name: string, attempt = "1 of 3") => row("server.recovered", { target: name, attempt, server: server(id, name) });
const CTX = { panelUrl: "https://panel.example.com" };

test("a crash the panel puts right is one message that says so", () => {
  const out = messagesFor([crash("s1", "Aurora SMP"), restart("s1", "Aurora SMP")], CTX);
  assert.equal(out.length, 1);
  const m = out[0]!;
  assert.equal(m.kind, "server.crashed");
  assert.equal(m.tone, "warning", "put right, so not the loudest tone");
  assert.match(m.title, /^Aurora SMP crashed$/);
  assert.match(m.text, /restarted it \(1 of 3\)/);
  assert.equal(m.link, "https://panel.example.com/servers/aurora-smp");
  assert.deepEqual(m.details, { "Exit code": "1", Restart: "1 of 3" });
  assert.deepEqual(m.node, { name: "fra-node-02" });
});

test("a crash with no restart in the batch says it is not back yet, in the loudest tone", () => {
  const m = messagesFor([crash("s1", "Aurora SMP")], CTX)[0]!;
  assert.equal(m.tone, "danger");
  assert.match(m.text, /not back yet/);
  assert.ok(!m.details?.Restart);
});

test("an out-of-memory kill is said, not an exit code", () => {
  const m = messagesFor([crash("s1", "Rust Wipe", "fra-node-02", { oomKilled: true, lastExitCode: 137 })], CTX)[0]!;
  assert.deepEqual(m.details, { "Out of memory": "yes" });
});

test("a server that crashes again within the batch is one message with the count", () => {
  const m = messagesFor([crash("s1", "Aurora SMP"), crash("s1", "Aurora SMP"), crash("s1", "Aurora SMP")], CTX);
  assert.equal(m.length, 1);
  assert.match(m[0]!.title, /crashed 3 times/);
  assert.equal(m[0]!.count, 3);
});

test("a host restart that takes every server of a node down is one message, naming them", () => {
  const events = ["Aurora SMP", "World Lab", "Zomboid Mods", "Nightfall PvP", "Paper Update", "Wipe Wednesday", "Creative"].map((name, i) => crash(`s${i}`, name));
  const out = messagesFor(events, CTX);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, "7 servers crashed on fra-node-02");
  assert.match(out[0]!.text, /Aurora SMP, World Lab, Zomboid Mods, Nightfall PvP, Paper Update and 2 more/);
  assert.equal(out[0]!.count, 7);
  assert.deepEqual(out[0]!.node, { name: "fra-node-02" });
  assert.equal(out[0]!.link, "https://panel.example.com/servers");
});

test("crashes on two nodes are one message that does not claim one node", () => {
  const m = messagesFor([crash("a", "One", "fra-node-02"), crash("b", "Two", "ash-node-01")], CTX)[0]!;
  assert.equal(m.title, "2 servers crashed");
  assert.equal(m.node, null);
});

test("a group where only some were restarted says so", () => {
  const m = messagesFor([crash("a", "One"), crash("b", "Two"), restart("a", "One")], CTX)[0]!;
  assert.match(m.text, /restarted 1 of them/);
  assert.equal(m.tone, "danger");
});

test("a server the panel gave up on is its own message, with the panel's reason and no path in it", () => {
  const reason = "It crashed 3 times in a row without staying up. Something is wrong that restarting will not fix. See /var/lib/geeboard/servers/abc123/logs/latest.log";
  const m = messagesFor([row("server.recovery.abandoned", { target: "Aurora SMP", server: server("s1", "Aurora SMP"), reason })], CTX)[0]!;
  assert.equal(m.kind, "server.recovery.abandoned");
  assert.equal(m.tone, "danger");
  assert.match(m.text, /gave up restarting Aurora SMP on fra-node-02/);
  assert.match(m.text, /crashed 3 times in a row/);
  assert.ok(!m.text.includes("/var/lib"), m.text);
});

test("a node going down and coming back are each one message, and a backup that failed because of it is not a third", () => {
  const down = row("node.unreachable", { target: "fra-node-02" });
  const failed = row("backup.failed", { target: "auto-10-02", server: server("s1", "Aurora SMP"), reason: "fra-node-02 is unreachable" });
  const out = messagesFor([down, failed], CTX);
  assert.deepEqual(out.map((m) => m.kind), ["node.unreachable"]);
  assert.match(out[0]!.text, /Its servers are probably still running/);
  assert.equal(out[0]!.link, "https://panel.example.com/nodes/fra-node-02");
  assert.deepEqual(messagesFor([row("node.recovered", { target: "fra-node-02" })], CTX).map((m) => [m.kind, m.tone]), [["node.recovered", "success"]]);
});

test("a backup that failed for its own reason is a message even while a different node is down", () => {
  const out = messagesFor(
    [
      row("node.unreachable", { target: "ash-node-01" }),
      row("backup.failed", { target: "auto-10-02", server: server("s1", "Aurora SMP", "fra-node-02"), reason: "There is not enough free space for the archive." }),
      row("backup.failed", { target: "auto-10-02", server: server("s2", "Rust Wipe", "ash-node-01"), reason: "ash-node-01 is unreachable" }),
    ],
    CTX,
  );
  assert.deepEqual(out.map((m) => m.kind).sort(), ["backup.failed", "node.unreachable"]);
  assert.match(out.find((m) => m.kind === "backup.failed")!.text, /not enough free space/);
});

test("a backup's failure is not repeated for the whole of the node being down: the reason is read, not guessed", () => {
  const m = messagesFor([row("backup.failed", { target: "manual-10-02", server: server("s1", "Aurora SMP"), reason: "fra-node-02 is unreachable" })], CTX);
  assert.equal(m.length, 1, "with no node.unreachable in the batch it is the news");
});

test("several backups that failed are one message; a damaged one is its own kind", () => {
  const failed = messagesFor(
    [1, 2, 3].map((i) => row("backup.failed", { target: `auto-${i}`, server: server(`s${i}`, `Server ${i}`), reason: "The archive could not be written." })),
    CTX,
  );
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.title, "3 backups failed");
  const damaged = messagesFor([row("backup.damaged", { target: "manual-10-01", server: server("s1", "Aurora SMP") })], CTX)[0]!;
  assert.equal(damaged.kind, "backup.damaged");
  assert.match(damaged.title, /A backup of Aurora SMP is damaged/);
});

test("a deleted server is still named, by what its row kept", () => {
  const m = messagesFor([row("backup.failed", { target: "auto-1", server: null, serverName: "Old World", reason: "x" })], CTX)[0]!;
  assert.match(m.title, /A backup of Old World failed/);
  assert.equal(m.link, "https://panel.example.com/backups");
});

test("an update is announced with what it moves from and to", () => {
  const e = row("server.update.available", { actor: "Catalog", target: "Aurora SMP", server: server("s1", "Aurora SMP"), changes: { Update: { from: "1.20.4", to: "1.21.1" } } });
  const m = messagesFor([e], CTX)[0]!;
  assert.equal(m.tone, "info");
  assert.match(m.text, /Aurora SMP runs 1\.20\.4; 1\.21\.1 is available/);
  assert.deepEqual(m.details, { Available: "1.21.1" });
});

test("rows that are not worth a message are left out: the panel's own restart, a clean stop, a summary", () => {
  const out = messagesFor(
    [
      restart("s1", "Aurora SMP"),
      row("server.stopped.unexpectedly", { target: "Aurora SMP", server: server("s1", "Aurora SMP") }),
      row("backups.verified", { target: "Aurora SMP", server: server("s1", "Aurora SMP") }),
      row("server.unhealthy", { target: "Aurora SMP", server: server("s1", "Aurora SMP") }),
      row("server.created", { target: "Aurora SMP", actor: "Mara" }),
    ],
    CTX,
  );
  assert.deepEqual(out, []);
});

test("with no panel address there is no link, and nothing else changes", () => {
  const m = messagesFor([crash("s1", "Aurora SMP")], { panelUrl: null })[0]!;
  assert.equal(m.link, null);
});

test("messages come oldest first", () => {
  const out = messagesFor([row("node.recovered", { target: "fra-node-02" }), crash("s1", "Aurora SMP")], CTX);
  assert.deepEqual(out.map((m) => m.kind), ["node.recovered", "server.crashed"]);
});

test("a reason is made safe to send: no path, no control characters, not long", () => {
  assert.equal(cleanReason("failed at /var/lib/geeboard/servers/x/world.tar.gz now"), "failed at \u2026 now");
  assert.equal(cleanReason("failed at C:\\ProgramData\\Geeboard\\servers\\x\\w.tar.gz now"), "failed at \u2026 now");
  assert.equal(cleanReason("two\nlines\tand\u0000a null"), "two lines and a null");
  assert.ok(cleanReason("x".repeat(1000)).length <= 240);
  assert.equal(cleanReason("The store refused: 403 AccessDenied"), "The store refused: 403 AccessDenied", "a status is not a path");
  assert.equal(cleanReason("https://s3.example.com/bucket is down"), "https://s3.example.com/bucket is down", "a URL is not a file path");
});

test("a list of names reads like one", () => {
  assert.equal(listNames(["A"]), "A");
  assert.equal(listNames(["A", "B"]), "A and B");
  assert.equal(listNames(["A", "B", "C"]), "A, B and C");
  assert.equal(listNames(["A", "B", "C", "D", "E", "F", "G"]), "A, B, C, D, E and 2 more");
});

/* ── Rate ─────────────────────────────────────────────────────── */

const msg = (i: number): NotificationMessage => ({ kind: "server.crashed", at: new Date(T0).toISOString(), tone: "danger", title: `m${i}`, text: "t" });

test("a channel is never sent more than the limit in a minute, and one notice says so", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => msg(i));
  const r = limitMessages(twenty, 0, false, 10, new Date(T0));
  assert.equal(r.send.length, 10);
  assert.equal(r.suppressed, 10);
  assert.ok(r.notice && /10 more notifications not sent/.test(r.notice.title) && r.notice.kind === "notifications.suppressed");
  assert.match(r.notice!.text, /at most 10 messages a minute/);
});

test("past the limit already, the rest is dropped, with a notice only the first time in the minute", () => {
  const first = limitMessages([msg(1), msg(2)], 10, false, 10);
  assert.deepEqual(first.send, []);
  assert.equal(first.suppressed, 2);
  assert.ok(first.notice, "a storm of single messages is noticed by the first that does not fit");
  const later = limitMessages([msg(1), msg(2)], 11, true, 10);
  assert.deepEqual(later.send, []);
  assert.equal(later.suppressed, 2);
  assert.equal(later.notice, null, "and not again");
});

test("under the limit nothing is touched", () => {
  const r = limitMessages([msg(1), msg(2), msg(3)], 4, false, 10);
  assert.equal(r.send.length, 3);
  assert.equal(r.suppressed, 0);
  assert.equal(r.notice, null);
  assert.equal(limitMessages([msg(1), msg(2)], 8, false, 10).send.length, 2, "exactly the room that is left");
  assert.equal(limitMessages([msg(1)], 0, false, 10).notice, null);
});

/* ── Delivery ─────────────────────────────────────────────────── */

test("a failure worth retrying is tried again after a minute, five, thirty, and then given up on", () => {
  const createdAt = new Date(T0);
  const now = new Date(T0 + 1000);
  assert.deepEqual(RETRY_DELAYS_MS, [60_000, 300_000, 1_800_000]);
  const first = afterAttempt({ attempts: 1, createdAt, now, retry: true });
  assert.equal(first.state, "PENDING");
  assert.equal(first.nextAttemptAt!.getTime(), now.getTime() + 60_000);
  assert.equal(afterAttempt({ attempts: 2, createdAt, now, retry: true }).nextAttemptAt!.getTime(), now.getTime() + 300_000);
  assert.equal(afterAttempt({ attempts: 3, createdAt, now, retry: true }).nextAttemptAt!.getTime(), now.getTime() + 1_800_000);
  assert.deepEqual(afterAttempt({ attempts: 4, createdAt, now, retry: true }), { state: "FAILED", nextAttemptAt: null });
});

test("a failure that would not help to retry is final, and so is a message too old to matter", () => {
  const createdAt = new Date(T0);
  assert.deepEqual(afterAttempt({ attempts: 1, createdAt, now: new Date(T0), retry: false }), { state: "FAILED", nextAttemptAt: null });
  const late = new Date(T0 + MAX_AGE_MS - 10_000);
  assert.deepEqual(afterAttempt({ attempts: 1, createdAt, now: late, retry: true }), { state: "FAILED", nextAttemptAt: null });
});

/* ── Choices ──────────────────────────────────────────────────── */

test("the page's seven choices stand for eight kinds, and a channel keeps only kinds that exist", () => {
  assert.equal(EVENT_CHOICES.length, 7);
  assert.deepEqual(kindsOf(EVENT_CHOICES.map((c) => c.id)).length, 8);
  assert.deepEqual(kindsOf(["backup"]), ["backup.failed", "backup.damaged"]);
  assert.deepEqual(kindsOf(["nonsense"]), []);
  assert.deepEqual(cleanKinds(["server.crashed", "server.crashed", "made.up", 7, null]), ["server.crashed"]);
  assert.deepEqual(cleanKinds("server.crashed"), []);
  assert.deepEqual(choicesOf(["backup.failed"]), [], "half a choice is not the choice");
  assert.deepEqual(choicesOf(["backup.failed", "backup.damaged", "node.unreachable"]).sort(), ["backup", "node-down"]);
});

/* ── A server nobody asked to stop, left down ─────────────────── */

const leftStopped = (id: string, name: string, node = "fra-node-02") =>
  row("server.left.stopped", { target: name, server: server(id, name, node), reason: 'It stopped together with 2 other servers on fra-node-02, which points at the machine or Docker restarting. Its restart policy is "Never restart", which does not start it again, so it was left stopped. Start it from this page.' });

test("a server nobody asked to stop, left down by its policy, is one message, with the reason the panel wrote down", () => {
  const out = messagesFor([leftStopped("s1", "Aurora SMP")], CTX);
  assert.equal(out.length, 1);
  const m = out[0]!;
  assert.equal(m.kind, "server.left.stopped");
  assert.equal(m.tone, "warning");
  assert.equal(m.title, "Aurora SMP was left stopped");
  assert.match(m.text, /^Aurora SMP on fra-node-02 is stopped\. It stopped together with 2 other servers/);
  assert.match(m.text, /Never restart/);
  assert.equal(m.link, "https://panel.example.com/servers/aurora-smp");
  assert.deepEqual(m.node, { name: "fra-node-02" });
});

test("a host that restarted and left several servers down is one message naming them, not one each", () => {
  const out = messagesFor([leftStopped("a", "One"), leftStopped("b", "Two"), leftStopped("c", "Three")], CTX);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, "3 servers were left stopped");
  assert.match(out[0]!.text, /^One, Two and Three are stopped\. The panel did not stop them/);
  assert.match(out[0]!.text, /page says what is known about why/);
  assert.equal(out[0]!.count, 3);
});

test("the drift row itself is not a message: the result of it is", () => {
  assert.deepEqual(messagesFor([row("server.stopped.unexpectedly", { target: "Aurora SMP", server: server("s1", "Aurora SMP") })], CTX), []);
});
