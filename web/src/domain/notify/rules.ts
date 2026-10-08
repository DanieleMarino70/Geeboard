import type { NotificationMessage } from "./format";
import { NOTIFIABLE_ACTIONS, type NotificationKind } from "./events";

/* From rows of the audit log to the messages worth sending.

   Pure: the rows come in with what the dispatcher joined to them (the
   server's name, its node, how its last crash ended), and the messages go
   out. Nothing here reads a clock but the rows', talks to a database or
   sends anything, so each rule below is a test of its own.

   The rules exist because the panel's own rows are written for an audit log
   and not for a person's phone. Measured on the real poller (see
   .claude/prompts/0.5.0-parte-0-nota.md):

     - a crash the panel puts right is TWO rows in the same pass, a
       `server.crashed` and the Watchdog's `server.recovered`. One message:
       it fell over, and it was restarted (1 of 3).
     - a node that goes quiet writes one row and nothing for its servers,
       but a backup asked of it in that time writes a `backup.failed` saying
       it is unreachable. That is one cause and gets one message.
     - a host that restarts takes every server on a node down in one pass.
       That is one message about the node's servers, not twenty.
     - a server in a crash loop is closed by the panel itself, at three
       restarts and then a `server.recovery.abandoned`: six rows at most. */

/** An audit row, with what the dispatcher could join to it. */
export interface AuditEvent {
  id: string;
  action: string;
  at: Date;
  actor: string;
  target: string | null;
  changes: unknown;
  /** The server it was about, while it exists; null once it is gone. */
  server: {
    id: string;
    name: string;
    slug: string | null;
    nodeName: string | null;
    lastExitCode: number | null;
    oomKilled: boolean;
  } | null;
  /** The name the row kept for a server that has since been deleted. */
  serverName: string | null;
}

export interface Context {
  /** The panel's own address, from PANEL_URL, or null where it was not set. */
  panelUrl: string | null;
}

/* ── Wording helpers ───────────────────────────────────────────── */

function change(event: AuditEvent, key: string): string | null {
  const row = event.changes && typeof event.changes === "object" ? (event.changes as Record<string, unknown>)[key] : null;
  const to = row && typeof row === "object" ? (row as { to?: unknown }).to : null;
  return typeof to === "string" ? to : null;
}

/* A reason the panel wrote down, made safe to leave the building: no paths,
   no control characters, not long. Reasons come from the panel and from what
   a node said, and a node's error can name a directory on its disk. */
export function cleanReason(text: string, max = 240): string {
  const plain = text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "…")
    .replace(/(?:^|(?<=[\s("']))\/(?:[\w.@-]+\/)+[\w.@-]+/g, "…")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= max ? plain : `${plain.slice(0, max - 1)}…`;
}

/** "A", "A and B", "A, B and C", and at most five of them. */
export function listNames(names: readonly string[], max = 5): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const head = shown.length <= 1 ? shown.join("") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : head;
}

const nameOf = (event: AuditEvent) => event.server?.name ?? event.serverName ?? event.target ?? "a server";
const nodeOf = (event: AuditEvent) => (event.action.startsWith("node.") ? event.target : (event.server?.nodeName ?? null));

function link(context: Context, path: string): string | null {
  return context.panelUrl ? `${context.panelUrl}${path}` : null;
}

const unreachableReason = (event: AuditEvent) => /unreachable/i.test(change(event, "Reason") ?? "");

/* ── The messages ─────────────────────────────────────────────── */

interface Subject {
  kind: NotificationKind;
  events: AuditEvent[];
  /** For a crash: the Watchdog's restart that put it right in the same batch. */
  restarted: AuditEvent | null;
}

function crashMessage(group: Subject[], context: Context): NotificationMessage {
  const first = group[0]!;
  const nodes = [...new Set(group.map((g) => nodeOf(g.events[0]!)).filter((n): n is string => Boolean(n)))];
  const at = new Date(Math.min(...group.map((g) => g.events[0]!.at.getTime()))).toISOString();

  if (group.length === 1) {
    const event = first.events[0]!;
    const name = nameOf(event);
    const node = nodeOf(event);
    const times = first.events.length;
    const attempt = first.restarted ? change(first.restarted, "Attempt") : null;
    const server = event.server;
    const details: Record<string, string> = {};
    if (server?.oomKilled) details["Out of memory"] = "yes";
    else if (server?.lastExitCode !== null && server?.lastExitCode !== undefined) details["Exit code"] = String(server.lastExitCode);
    if (attempt) details.Restart = attempt;
    return {
      kind: "server.crashed",
      at,
      tone: first.restarted ? "warning" : "danger",
      title: `${name} crashed${times > 1 ? ` ${times} times` : ""}`,
      text:
        `${name} stopped without being asked${node ? ` on ${node}` : ""}. ` +
        (first.restarted
          ? `The panel restarted it${attempt ? ` (${attempt})` : ""}.`
          : "It is not back yet: the panel restarts a crashed server where automatic restart is on, and says if it gives up."),
      server: server ? { name, slug: server.slug } : { name, slug: null },
      node: node ? { name: node } : null,
      count: times,
      link: server?.slug ? link(context, `/servers/${server.slug}`) : null,
      ...(Object.keys(details).length > 0 ? { details } : {}),
    };
  }

  const names = group.map((g) => nameOf(g.events[0]!));
  const onNode = nodes.length === 1 ? ` on ${nodes[0]}` : "";
  const restarted = group.filter((g) => g.restarted).length;
  return {
    kind: "server.crashed",
    at,
    tone: restarted === group.length ? "warning" : "danger",
    title: `${group.length} servers crashed${onNode}`,
    text:
      `${listNames(names)} stopped without being asked${onNode}. ` +
      (restarted === group.length
        ? "The panel restarted all of them."
        : restarted > 0
          ? `The panel restarted ${restarted} of them.`
          : "None is back yet; the panel restarts the ones with automatic restart on, and says if it gives up."),
    node: nodes.length === 1 ? { name: nodes[0]! } : null,
    count: group.length,
    link: link(context, "/servers"),
    details: { Servers: String(group.length) },
  };
}

function single(subject: Subject, context: Context): NotificationMessage {
  const event = subject.events[0]!;
  const at = event.at.toISOString();
  const name = nameOf(event);
  const node = nodeOf(event);
  const slug = event.server?.slug ?? null;
  const serverLink = slug ? link(context, `/servers/${slug}`) : null;
  const serverRef = { name, slug };

  switch (subject.kind) {
    case "server.recovery.abandoned": {
      const reason = cleanReason(change(event, "Reason") ?? "It crashed again and again.");
      return {
        kind: subject.kind,
        at,
        tone: "danger",
        title: `${name} will not be restarted`,
        text: `The panel gave up restarting ${name}${node ? ` on ${node}` : ""}. ${reason}`,
        server: serverRef,
        node: node ? { name: node } : null,
        link: serverLink,
      };
    }
    case "server.left.stopped": {
      const reason = cleanReason(change(event, "Reason") ?? "The panel did not stop it, and its restart policy does not start it again.");
      return {
        kind: subject.kind,
        at,
        tone: "warning",
        title: `${name} was left stopped`,
        text: `${name}${node ? ` on ${node}` : ""} is stopped. ${reason}`,
        server: serverRef,
        node: node ? { name: node } : null,
        link: serverLink,
      };
    }
    case "node.unreachable":
      return {
        kind: subject.kind,
        at,
        tone: "danger",
        title: `${name} is unreachable`,
        text: `The panel has not heard from ${name} for several minutes. Its servers are probably still running. The panel says when it is back.`,
        node: { name },
        link: link(context, `/nodes/${encodeURIComponent(name)}`),
      };
    case "node.recovered":
      return {
        kind: subject.kind,
        at,
        tone: "success",
        title: `${name} is back`,
        text: `The panel can reach ${name} again.`,
        node: { name },
        link: link(context, `/nodes/${encodeURIComponent(name)}`),
      };
    case "backup.failed": {
      const reason = cleanReason(change(event, "Reason") ?? "No reason was given.");
      return {
        kind: subject.kind,
        at,
        tone: "danger",
        title: `A backup of ${name} failed`,
        text: `${event.target ? `${event.target}: ` : ""}${reason}`,
        server: serverRef,
        node: node ? { name: node } : null,
        link: link(context, "/backups"),
      };
    }
    case "backup.damaged":
      return {
        kind: subject.kind,
        at,
        tone: "danger",
        title: `A backup of ${name} is damaged`,
        text: `${event.target ?? "An archive"} is gone from its storage or no longer matches its checksum, so it cannot be restored. Make a new backup.`,
        server: serverRef,
        node: node ? { name: node } : null,
        link: link(context, "/backups"),
      };
    case "server.update.available": {
      const from = event.changes && typeof event.changes === "object" ? ((event.changes as Record<string, { from?: unknown }>).Update?.from ?? null) : null;
      const to = change(event, "Update");
      return {
        kind: subject.kind,
        at,
        tone: "info",
        title: `Update available for ${name}`,
        text: `${name}${typeof from === "string" ? ` runs ${from}` : ""}${to ? `; ${to} is available` : "; a newer version is available"}. Updating takes a backup first and can be rolled back.`,
        server: serverRef,
        link: serverLink,
        ...(to ? { details: { Available: to } } : {}),
      };
    }
    case "panel.update.available": {
      const to = change(event, "Release");
      const state = change(event, "State") ?? "Update available";
      const agents = change(event, "Agents");
      const url = change(event, "Link");
      const security = /security/i.test(state);
      // The row carries no tone of its own here: it is read from the words the panel wrote (panel-update-ops.ts), which are one of four.
      const tone = security || /security update/i.test(agents ?? "") ? "danger" : /recommended/i.test(state) || /below the minimum/i.test(agents ?? "") ? "warning" : "info";
      const behind = state !== "Up to date" && !/^(unknown|supported)$/i.test(state);
      return {
        kind: subject.kind,
        at,
        tone,
        title: security ? "Security update for Geeboard" : behind ? `Geeboard ${to ?? "has a new release"} is out` : "A Geeboard agent is below its minimum",
        text: [
          behind ? `${state}: ${to ? `release ${to}` : "a newer release"} is available for this panel.` : null,
          agents ? `Agents to upgrade on their machines: ${cleanReason(agents)}.` : null,
          "Upgrading is the installer's re-run, which takes a dump first; docs/upgrading.md says how, and how to go back.",
        ]
          .filter(Boolean)
          .join(" "),
        link: url && url.startsWith("https://") ? url : link(context, "/updates"),
        ...(to ? { details: { Release: to, State: state } } : {}),
      };
    }
    case "server.crashed":
      return crashMessage([subject], context);
  }
}

function grouped(kind: NotificationKind, group: Subject[], context: Context): NotificationMessage {
  const at = new Date(Math.min(...group.map((g) => g.events[0]!.at.getTime()))).toISOString();
  const names = group.map((g) => nameOf(g.events[0]!));
  const base = { kind, at, count: group.length } as const;
  switch (kind) {
    case "node.unreachable":
      return { ...base, tone: "danger", title: `${group.length} nodes are unreachable`, text: `${listNames(names)} have not been heard from for several minutes. Their servers are probably still running.`, link: link(context, "/nodes") };
    case "node.recovered":
      return { ...base, tone: "success", title: `${group.length} nodes are back`, text: `${listNames(names)} can be reached again.`, link: link(context, "/nodes") };
    case "server.recovery.abandoned":
      return { ...base, tone: "danger", title: `${group.length} servers will not be restarted`, text: `The panel gave up restarting ${listNames(names)}. Somebody has to look at them.`, link: link(context, "/servers") };
    case "server.left.stopped":
      return { ...base, tone: "warning", title: `${group.length} servers were left stopped`, text: `${listNames(names)} are stopped. The panel did not stop them, and their restart policies do not start them again. Each one's page says what is known about why. Start them from the Servers page.`, link: link(context, "/servers") };
    case "backup.failed":
      return { ...base, tone: "danger", title: `${group.length} backups failed`, text: `Backups of ${listNames(names)} failed.`, link: link(context, "/backups") };
    case "backup.damaged":
      return { ...base, tone: "danger", title: `${group.length} backups are damaged`, text: `Archives of ${listNames(names)} are gone or no longer match their checksums. Make new backups.`, link: link(context, "/backups") };
    case "server.update.available":
      return { ...base, tone: "info", title: `Updates are available for ${group.length} servers`, text: `${listNames(names)} can be updated.`, link: link(context, "/servers") };
    case "panel.update.available":
      return { ...base, tone: "info", title: "Geeboard has news", text: "More than one release note was written in a short time; the Updates page has the latest.", link: link(context, "/updates") };
    case "server.crashed":
      return crashMessage(group, context);
  }
}

/**
 * The messages for a batch of rows, oldest first.
 *
 * Rows are merged and grouped within the batch only: the dispatcher hands
 * over what was written since it last looked, and two things that happened a
 * pass apart are two messages.
 */
export function messagesFor(events: readonly AuditEvent[], context: Context): NotificationMessage[] {
  const ordered = [...events].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));

  const restarts = new Map<string, AuditEvent>();
  for (const e of ordered) {
    if (e.action === "server.recovered" && e.actor === "Watchdog" && e.server && change(e, "Attempt")) restarts.set(e.server.id, e);
  }
  const nodesDown = new Set(ordered.filter((e) => e.action === "node.unreachable").map((e) => e.target).filter((n): n is string => Boolean(n)));

  // One subject per thing that happened: a server's crashes together, a node's outage, a backup.
  const subjects: Subject[] = [];
  const byKey = new Map<string, Subject>();
  for (const e of ordered) {
    if (!(NOTIFIABLE_ACTIONS as readonly string[]).includes(e.action)) continue;
    const kind = e.action as NotificationKind;

    // One cause, one message: a backup that failed because the node is down is the node being down.
    if (kind === "backup.failed" && unreachableReason(e)) {
      const node = nodeOf(e);
      if (node && nodesDown.has(node)) continue;
    }

    const crashLike = kind === "server.crashed" || kind === "server.recovery.abandoned" || kind === "server.update.available";
    const key = crashLike ? `${kind}:${e.server?.id ?? e.serverName ?? e.target}` : kind === "node.unreachable" || kind === "node.recovered" ? `${kind}:${e.target}` : `${kind}:${e.id}`;
    const existing = byKey.get(key);
    if (existing && (kind === "server.crashed" || kind === "node.unreachable" || kind === "node.recovered")) {
      existing.events.push(e);
      continue;
    }
    if (existing) continue;
    const subject: Subject = { kind, events: [e], restarted: kind === "server.crashed" && e.server ? (restarts.get(e.server.id) ?? null) : null };
    byKey.set(key, subject);
    subjects.push(subject);
  }

  // Subjects of one kind in one batch are one message: a host that restarted took them all down together.
  const out: NotificationMessage[] = [];
  const byKind = new Map<NotificationKind, Subject[]>();
  for (const s of subjects) {
    const list = byKind.get(s.kind) ?? [];
    list.push(s);
    byKind.set(s.kind, list);
  }
  for (const [kind, group] of byKind) {
    if (group.length === 1) out.push(single(group[0]!, context));
    else out.push(grouped(kind, group, context));
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/* ── How many, how often ──────────────────────────────────────── */

export const RATE_LIMIT_PER_MINUTE = 10;

/**
 * Keeps one channel from being flooded. `already` is how many messages this
 * channel was queued in the last minute, and `noticed` whether one of them was
 * already the notice. Past the limit the rest are not queued, and one notice
 * says so — the first time in a minute, so a long storm is one notice and not
 * one a pass.
 */
export function limitMessages(
  messages: readonly NotificationMessage[],
  already: number,
  noticed: boolean,
  limit: number = RATE_LIMIT_PER_MINUTE,
  at: Date = new Date(),
): { send: NotificationMessage[]; suppressed: number; notice: NotificationMessage | null } {
  const room = Math.max(0, limit - already);
  if (messages.length <= room) return { send: [...messages], suppressed: 0, notice: null };
  const send = messages.slice(0, room);
  const suppressed = messages.length - room;
  return {
    send,
    suppressed,
    notice: !noticed
      ? {
          kind: "notifications.suppressed",
          at: at.toISOString(),
          tone: "warning",
          title: `${suppressed} more notification${suppressed === 1 ? "" : "s"} not sent`,
          text: `Geeboard sends at most ${limit} messages a minute to one channel, and ${suppressed} more happened. Look at the activity log in the panel for the rest.`,
          count: suppressed,
        }
      : null,
  };
}

/* ── Delivery ─────────────────────────────────────────────────── */

/** After the first attempt fails: a minute, five, thirty. Then it is given up on. */
export const RETRY_DELAYS_MS: readonly number[] = [60_000, 5 * 60_000, 30 * 60_000];
/** A message that has waited this long is no longer news. */
export const MAX_AGE_MS = 24 * 3600_000;

export function afterAttempt(input: { attempts: number; createdAt: Date; now: Date; retry: boolean }): { state: "PENDING" | "FAILED"; nextAttemptAt: Date | null } {
  if (!input.retry) return { state: "FAILED", nextAttemptAt: null };
  const delay = RETRY_DELAYS_MS[input.attempts - 1];
  if (delay === undefined) return { state: "FAILED", nextAttemptAt: null };
  const next = new Date(input.now.getTime() + delay);
  if (next.getTime() - input.createdAt.getTime() > MAX_AGE_MS) return { state: "FAILED", nextAttemptAt: null };
  return { state: "PENDING", nextAttemptAt: next };
}
