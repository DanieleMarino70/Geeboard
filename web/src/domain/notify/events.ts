/* What the panel can tell people about, and what each choice on the page means.

   The events are not new: the panel already writes a row to its audit log
   when a server crashes, when a node goes quiet, when a backup fails. The
   notifier reads those rows (lib/notify/ops.ts) and never hooks the places
   that write them, so a row that is added to the log is one line here away
   from being a notification, and a row that is changed cannot silently stop
   being one.

   What is left out is as deliberate as what is in. `server.stopped.unexpectedly`
   is what the panel writes when a server's process exits cleanly without the
   panel having asked it to — including when somebody types `stop` at the
   game's own console — and calling that an alarm would page people for doing
   their job. `server.unhealthy` flaps. `backups.verified` is a summary of the
   `backup.damaged` rows that matter. Everything a person did is in the audit
   log already. */

export type NotificationKind =
  | "server.crashed"
  | "server.recovery.abandoned"
  | "node.unreachable"
  | "node.recovered"
  | "backup.failed"
  | "backup.damaged"
  | "server.update.available";

/** The audit rows that become messages. `server.recovered` is read too, but only to say a crash was put right. */
export const NOTIFIABLE_ACTIONS: readonly NotificationKind[] = [
  "server.crashed",
  "server.recovery.abandoned",
  "node.unreachable",
  "node.recovered",
  "backup.failed",
  "backup.damaged",
  "server.update.available",
];

export const AUDIT_ACTIONS_READ: readonly string[] = [...NOTIFIABLE_ACTIONS, "server.recovered"];

export interface EventChoice {
  id: string;
  label: string;
  note: string;
  /** The kinds a channel receives when this is ticked. */
  kinds: readonly NotificationKind[];
}

/** The six things a channel can be asked for. Every channel starts with all of them. */
export const EVENT_CHOICES: readonly EventChoice[] = [
  {
    id: "crash",
    label: "A server crashed",
    note: "One message for a crash, with whether the panel restarted it. Several at once are one message.",
    kinds: ["server.crashed"],
  },
  {
    id: "gave-up",
    label: "The panel gave up restarting a server",
    note: "It crashed again and again, or ran out of memory. Somebody has to look at it.",
    kinds: ["server.recovery.abandoned"],
  },
  {
    id: "node-down",
    label: "A node went offline",
    note: "The panel has not heard from it for several minutes. Its servers are probably still running.",
    kinds: ["node.unreachable"],
  },
  {
    id: "node-up",
    label: "A node came back",
    note: "The panel can reach it again.",
    kinds: ["node.recovered"],
  },
  {
    id: "backup",
    label: "A backup failed, or one is damaged",
    note: "A backup that could not be made, or an archive that is gone or no longer matches its checksum.",
    kinds: ["backup.failed", "backup.damaged"],
  },
  {
    id: "update",
    label: "An update is available for a server",
    note: "Once for each server and each version it could move to.",
    kinds: ["server.update.available"],
  },
];

export const ALL_KINDS: readonly NotificationKind[] = EVENT_CHOICES.flatMap((c) => c.kinds);

export function isNotificationKind(value: string): value is NotificationKind {
  return (ALL_KINDS as readonly string[]).includes(value);
}

/** What a channel keeps of a list the page sent: only kinds that exist, once each, in the page's order. */
export function cleanKinds(raw: unknown): NotificationKind[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<NotificationKind>();
  for (const item of raw) {
    if (typeof item === "string" && isNotificationKind(item)) seen.add(item);
  }
  return ALL_KINDS.filter((kind) => seen.has(kind));
}

/** Which choices are fully ticked by a list of kinds, for showing a saved channel. */
export function choicesOf(kinds: readonly string[]): string[] {
  return EVENT_CHOICES.filter((c) => c.kinds.every((k) => kinds.includes(k))).map((c) => c.id);
}

/** The kinds the ticked choices stand for, for saving what the page sent. */
export function kindsOf(choiceIds: readonly string[]): NotificationKind[] {
  return cleanKinds(EVENT_CHOICES.filter((c) => choiceIds.includes(c.id)).flatMap((c) => c.kinds));
}
