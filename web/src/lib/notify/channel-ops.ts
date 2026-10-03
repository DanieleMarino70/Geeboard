import "server-only";
import type { User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { PRIVATE_NETWORKS_VARIABLE, describeDestination, judgeUrl, policyFromEnvironment, type DestinationKind, type DestinationPolicy } from "@/domain/notify/destination";
import { EVENT_CHOICES, choicesOf, cleanKinds, kindsOf } from "@/domain/notify/events";
import { newSigningSecret, type NotificationMessage } from "@/domain/notify/format";
import { uniqueViolation } from "../db-errors";
import { db } from "../db";
import { decryptSecret, encryptSecret } from "../secrets";
import { sendNotification, type SendOptions, type SendResult } from "./send";

/* The channels a workspace's messages go to, and everything a person does to them.

   A channel is an address somebody pasted, so it is held like a key: owners'
   and admins', encrypted, shown on the page only as where it goes and never as
   the token in it, in no API scope, and — the part that is not true of a key —
   it is judged again every time before it is called, because what a name
   resolves to is not a thing that was checked once.

   Adding one sends a test message first and saves it only if that got through,
   which is how the DNS token and the bucket work: the check is the same call
   the real messages will make, with the same rules, so the first surprise is
   not the first crash. */

const MAX_CHANNELS = 10;

export type ChannelResult = ({ ok: true; title: string; body: string; tone: "success" | "warning" } | { ok: false; title: string; body: string }) & {
  /** A webhook's signing key, once, when it was made. Never again. */
  secret?: string;
};

/** What the operations are handed to be tested without a network: never passed by the page. */
export interface ChannelDeps {
  policy?: DestinationPolicy;
  send?: (channel: Parameters<typeof sendNotification>[0], message: NotificationMessage, options?: SendOptions) => Promise<SendResult>;
}

function refuse(title: string, body: string): ChannelResult {
  return { ok: false, title, body };
}

function mayManage(actor: User): boolean {
  return can(actor, "notifications.manage");
}

async function record(actor: User, action: string, target: string, tone: "INFO" | "WARNING", changes?: Record<string, { from: string; to: string }>) {
  await db.activityEvent.create({ data: { actor: actor.name, action, target, tone, userId: actor.id, changes } });
}

const testMessage = (name: string): NotificationMessage => ({
  kind: "notifications.test",
  at: new Date().toISOString(),
  tone: "info",
  title: "Geeboard test message",
  text: `The channel ${name} is set up. Geeboard will tell it about the events you picked, and about nothing else.`,
});

function nameProblem(name: string): string | null {
  if (name.length < 2) return "Give the channel a name of at least two characters.";
  if (name.length > 40) return "That name is too long; forty characters is enough.";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "A name is text, without control characters.";
  return null;
}

const kindOf = (value: string): DestinationKind | null => (value === "DISCORD" || value === "WEBHOOK" ? value : null);

export interface ChannelInput {
  name: string;
  kind: string;
  /** The address, typed once. */
  url: string;
  /** The ticked choices, by id. */
  choices: string[];
}

export async function createChannelOp(actor: User, input: ChannelInput, deps: ChannelDeps = {}): Promise<ChannelResult> {
  if (!mayManage(actor)) return refuse("Not permitted", "Only owners and admins can set up notifications.");
  const name = String(input.name ?? "").trim();
  const kind = kindOf(String(input.kind ?? ""));
  const url = String(input.url ?? "").trim();
  if (!kind) return refuse("Check the form", "Pick Discord or a webhook.");
  const problem = nameProblem(name);
  if (problem) return refuse("Check the form", problem);
  const events = kindsOf(Array.isArray(input.choices) ? input.choices.map(String) : []);
  if (events.length === 0) return refuse("Check the form", "Pick at least one thing to be told about.");
  if ((await db.notificationChannel.count()) >= MAX_CHANNELS) {
    return refuse("Too many channels", `${MAX_CHANNELS} channels is the most this panel will send to. Remove one first.`);
  }

  const policy = deps.policy ?? policyFromEnvironment();
  const verdict = judgeUrl(kind, url, policy);
  if (!verdict.ok) return refuse("That address cannot be used", verdict.reason);

  const signingSecret = kind === "WEBHOOK" ? newSigningSecret() : null;

  // The test message is the check: the same call, with the same rules, and nothing is saved that did not just go through.
  const sent = await (deps.send ?? sendNotification)({ kind, url, signingSecret }, testMessage(name), { policy });
  if (!sent.ok) return refuse("The test message did not go through", sent.reason);

  try {
    await db.notificationChannel.create({
      data: {
        name,
        kind,
        url: encryptSecret(url),
        signingSecret: signingSecret ? encryptSecret(signingSecret) : null,
        events,
        lastOkAt: new Date(),
        createdById: actor.id,
      },
    });
  } catch (error) {
    if (uniqueViolation(error) !== null) return refuse("Name in use", `There is already a channel called ${name}.`);
    throw error;
  }
  await record(actor, "notifications.channel.created", name, "INFO", {
    Kind: { from: "—", to: kind === "DISCORD" ? "Discord" : "Webhook" },
    Sends: { from: "—", to: `${events.length} kind${events.length === 1 ? "" : "s"} of event` },
    Goes: { from: "—", to: describeDestination(kind, url) },
  });
  return {
    ok: true,
    tone: "success",
    title: "Channel added",
    body: `${name} accepted a test message. Its address is stored encrypted and will not be shown again.`,
    ...(signingSecret ? { secret: signingSecret } : {}),
  };
}

export interface ChannelChange {
  name?: string;
  enabled?: boolean;
  choices?: string[];
}

export async function updateChannelOp(actor: User, id: string, change: ChannelChange): Promise<ChannelResult> {
  if (!mayManage(actor)) return refuse("Not permitted", "Only owners and admins can change notifications.");
  const channel = await db.notificationChannel.findUnique({ where: { id } });
  if (!channel) return refuse("No such channel", "That channel was removed.");

  const data: { name?: string; enabled?: boolean; events?: string[] } = {};
  const said: Record<string, { from: string; to: string }> = {};
  if (change.name !== undefined) {
    const name = change.name.trim();
    const problem = nameProblem(name);
    if (problem) return refuse("Check the form", problem);
    if (name !== channel.name) {
      data.name = name;
      said.Name = { from: channel.name, to: name };
    }
  }
  if (change.enabled !== undefined && change.enabled !== channel.enabled) {
    data.enabled = change.enabled;
    said.State = { from: channel.enabled ? "on" : "off", to: change.enabled ? "on" : "off" };
  }
  if (change.choices !== undefined) {
    const events = kindsOf(change.choices.map(String));
    if (events.length === 0) return refuse("Check the form", "Pick at least one thing to be told about, or turn the channel off.");
    if (events.join() !== cleanKinds(channel.events).join()) {
      data.events = events;
      said.Sends = { from: `${channel.events.length} kinds`, to: `${events.length} kinds` };
    }
  }
  if (Object.keys(data).length === 0) return { ok: true, tone: "success", title: "Nothing to change", body: `${channel.name} is as it was.` };

  try {
    await db.notificationChannel.update({ where: { id }, data });
  } catch (error) {
    if (uniqueViolation(error) !== null) return refuse("Name in use", "There is already a channel with that name.");
    throw error;
  }
  await record(actor, "notifications.channel.updated", data.name ?? channel.name, "INFO", said);
  return { ok: true, tone: "success", title: "Saved", body: `${data.name ?? channel.name} was updated.` };
}

export async function testChannelOp(actor: User, id: string, deps: ChannelDeps = {}): Promise<ChannelResult> {
  if (!mayManage(actor)) return refuse("Not permitted", "Only owners and admins can test a channel.");
  const channel = await db.notificationChannel.findUnique({ where: { id } });
  if (!channel) return refuse("No such channel", "That channel was removed.");

  let url: string;
  let signingSecret: string | null;
  try {
    url = decryptSecret(channel.url);
    signingSecret = channel.signingSecret ? decryptSecret(channel.signingSecret) : null;
  } catch {
    return refuse("The address cannot be read", "This panel's SECRETS_KEY changed since the channel was saved, without `rekey`. Remove the channel and add it again.");
  }
  const kind = kindOf(channel.kind) ?? "WEBHOOK";
  const policy = deps.policy ?? policyFromEnvironment();
  const sent = await (deps.send ?? sendNotification)({ kind, url, signingSecret }, testMessage(channel.name), { policy });
  const now = new Date();
  if (sent.ok) {
    await db.notificationChannel.update({ where: { id }, data: { lastOkAt: now, lastError: null, lastErrorAt: null } });
    await record(actor, "notifications.channel.tested", channel.name, "INFO");
    return { ok: true, tone: "success", title: "Test message sent", body: `${channel.name} accepted it.` };
  }
  await db.notificationChannel.update({ where: { id }, data: { lastError: sent.reason, lastErrorAt: now } });
  return refuse("The test message did not go through", sent.reason);
}

/** A webhook's signing key, replaced. The old one stops working at once; the new one is shown now and never again. */
export async function rotateSigningSecretOp(actor: User, id: string): Promise<ChannelResult> {
  if (!mayManage(actor)) return refuse("Not permitted", "Only owners and admins can change notifications.");
  const channel = await db.notificationChannel.findUnique({ where: { id } });
  if (!channel) return refuse("No such channel", "That channel was removed.");
  if (channel.kind !== "WEBHOOK") return refuse("Nothing to rotate", "A Discord channel is not signed.");
  const secret = newSigningSecret();
  await db.notificationChannel.update({ where: { id }, data: { signingSecret: encryptSecret(secret) } });
  await record(actor, "notifications.channel.key", channel.name, "WARNING");
  return { ok: true, tone: "warning", title: "New signing key", body: "The old key no longer matches. Put this one in whatever checks the signature.", secret };
}

export async function removeChannelOp(actor: User, id: string): Promise<ChannelResult> {
  if (!mayManage(actor)) return refuse("Not permitted", "Only owners and admins can remove a channel.");
  const channel = await db.notificationChannel.findUnique({ where: { id } });
  if (!channel) return refuse("No such channel", "That channel was already removed.");
  const waiting = await db.notificationDelivery.count({ where: { channelId: id, state: "PENDING" } });
  await db.notificationChannel.delete({ where: { id } });
  await record(actor, "notifications.channel.removed", channel.name, "WARNING", waiting > 0 ? { Waiting: { from: String(waiting), to: "dropped" } } : undefined);
  return { ok: true, tone: "warning", title: "Channel removed", body: `${channel.name} will hear nothing more${waiting > 0 ? `, and its ${waiting} waiting message${waiting === 1 ? "" : "s"} went with it` : ""}.` };
}

/* ── What the page shows ─────────────────────────────────────── */

export interface ChannelView {
  id: string;
  name: string;
  kind: "DISCORD" | "WEBHOOK";
  /** Where it goes: the host, and for Discord the webhook's id. Never the token. */
  goes: string;
  /** The address is saved and this panel cannot decrypt it. */
  unreadable: boolean;
  enabled: boolean;
  choices: string[];
  signed: boolean;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  pending: number;
  failed: number;
}

export interface DeliveryView {
  id: string;
  channel: string;
  kind: string;
  title: string;
  state: "PENDING" | "SENT" | "FAILED";
  attempts: number;
  at: string;
  error: string | null;
}

export interface NotificationsView {
  channels: ChannelView[];
  deliveries: DeliveryView[];
  /** Whether the person who runs the panel has allowed private networks, and the variable that does. */
  privateAllowed: boolean;
  variable: string;
  /** PANEL_URL is set, so the messages can link back. */
  linksOn: boolean;
  full: boolean;
  choices: Array<{ id: string; label: string; note: string }>;
}

export async function notificationsView(): Promise<NotificationsView> {
  const [rows, deliveries] = await Promise.all([
    db.notificationChannel.findMany({ orderBy: { createdAt: "asc" } }),
    db.notificationDelivery.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { channel: { select: { name: true } } } }),
  ]);
  const counts = await db.notificationDelivery.groupBy({ by: ["channelId", "state"], where: { state: { in: ["PENDING", "FAILED"] } }, _count: true });
  const countOf = (channelId: string, state: string) => counts.find((c) => c.channelId === channelId && c.state === state)?._count ?? 0;

  const channels = rows.map((row): ChannelView => {
    const kind: "DISCORD" | "WEBHOOK" = row.kind === "DISCORD" ? "DISCORD" : "WEBHOOK";
    let goes = "an address that cannot be read";
    let unreadable = false;
    try {
      goes = describeDestination(kind, decryptSecret(row.url));
    } catch {
      unreadable = true;
    }
    return {
      id: row.id,
      name: row.name,
      kind,
      goes,
      unreadable,
      enabled: row.enabled,
      choices: choicesOf(row.events),
      signed: Boolean(row.signingSecret),
      lastOkAt: row.lastOkAt?.toISOString() ?? null,
      lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
      lastError: row.lastError,
      pending: countOf(row.id, "PENDING"),
      failed: countOf(row.id, "FAILED"),
    };
  });

  return {
    channels,
    deliveries: deliveries.map((d) => ({
      id: d.id,
      channel: d.channel.name,
      kind: d.kind,
      title: typeof (d.payload as { title?: unknown })?.title === "string" ? String((d.payload as { title: string }).title) : d.kind,
      state: d.state,
      attempts: d.attempts,
      at: d.createdAt.toISOString(),
      error: d.lastError,
    })),
    privateAllowed: policyFromEnvironment().allowPrivate,
    variable: PRIVATE_NETWORKS_VARIABLE,
    linksOn: Boolean(process.env.PANEL_URL?.trim()),
    full: rows.length >= MAX_CHANNELS,
    choices: EVENT_CHOICES.map((c) => ({ id: c.id, label: c.label, note: c.note })),
  };
}
