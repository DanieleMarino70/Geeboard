import "server-only";
import { outlookFor } from "@/domain/games/versions";
import { AUDIT_ACTIONS_READ } from "@/domain/notify/events";
import type { NotificationMessage } from "@/domain/notify/format";
import { afterAttempt, limitMessages, messagesFor, RATE_LIMIT_PER_MINUTE, type AuditEvent } from "@/domain/notify/rules";
import { storedCatalogs } from "../catalog-read";
import { db } from "../db";
import { decryptSecret } from "../secrets";
import { sendNotification, type SendOptions, type SendResult } from "./send";

/* Telling people what the panel already knows.

   Three steps, none of which touches the places the events are written:

     dispatchNotifications  reads the audit log after a cursor, turns what is
                            worth saying into messages (domain/notify/rules.ts)
                            and queues one delivery per message per channel
                            that asked for it. Only the database; it is quick.
     deliverPending         sends what is queued, with the retries and the
                            give-up of domain/notify/rules.ts. This is the one
                            that calls out, and it can be slow, so the poller
                            runs it beside the pass and not in it.
     recordUpdatesAvailable the one event the panel did not already write:
                            "an update is available" was a calculation made
                            every time a page was drawn. It is written once per
                            server and per version it could move to.

   With no channel configured nothing here calls anything: the cursor moves,
   and the only thing written is the line saying an update is available. */

/** A row is not news after this long: a poller that was off for a week does not announce the week. */
const NEWS_MAX_AGE_MS = 24 * 3600_000;
/**
 * Rows this fresh are left for the next look. Two rows the panel writes in one
 * pass — a crash and its restart — must be read together to be one message, and
 * a row committed a moment after a later one must not be stepped over.
 */
const SETTLE_MS = 5_000;
const BATCH = 500;
const PER_CHANNEL_PER_CALL = 10;
const DELIVER_PER_CALL = 200;

export interface DispatchOptions {
  /** The panel's address for links. Defaults to PANEL_URL: the poller has no request to read it from. */
  panelUrl?: string | null;
  settleMs?: number;
}

export interface DispatchReport {
  /** Audit rows read. */
  read: number;
  /** Messages made from them. */
  messages: number;
  /** Deliveries queued, over all channels. */
  queued: number;
  /** Messages kept from a channel by its rate limit. */
  suppressed: number;
  /** More rows are waiting than one call reads. */
  more: boolean;
}

function configuredPanelUrl(): string | null {
  const raw = process.env.PANEL_URL?.trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

export async function dispatchNotifications(now: Date = new Date(), options: DispatchOptions = {}): Promise<DispatchReport> {
  const report: DispatchReport = { read: 0, messages: 0, queued: 0, suppressed: 0, more: false };
  const settleMs = options.settleMs ?? SETTLE_MS;

  const cursor = await db.notificationCursor.findUnique({ where: { id: "events" } });
  if (!cursor) {
    // The first look: start from here. What is in the log already is history, not news.
    await db.notificationCursor.create({ data: { id: "events", lastEventAt: new Date(now.getTime() - settleMs), lastEventId: null } });
    return report;
  }

  const until = new Date(now.getTime() - settleMs);
  const rows = await db.activityEvent.findMany({
    where: {
      action: { in: [...AUDIT_ACTIONS_READ] },
      createdAt: { lte: until },
      OR: [{ createdAt: { gt: cursor.lastEventAt } }, ...(cursor.lastEventId ? [{ createdAt: cursor.lastEventAt, id: { gt: cursor.lastEventId } }] : [])],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: BATCH,
    include: {
      server: { select: { id: true, name: true, slug: true, lastExitCode: true, oomKilled: true, node: { select: { name: true } } } },
    },
  });
  report.read = rows.length;
  report.more = rows.length === BATCH;
  if (rows.length === 0) return report;
  const last = rows[rows.length - 1]!;

  const channels = await db.notificationChannel.findMany({ where: { enabled: true } });
  const fresh = rows.filter((r) => now.getTime() - r.createdAt.getTime() <= NEWS_MAX_AGE_MS);
  const panelUrl = options.panelUrl === undefined ? configuredPanelUrl() : options.panelUrl;

  const events: AuditEvent[] = fresh.map((r) => ({
    id: r.id,
    action: r.action,
    at: r.createdAt,
    actor: r.actor,
    target: r.target,
    changes: r.changes,
    server: r.server ? { id: r.server.id, name: r.server.name, slug: r.server.slug, nodeName: r.server.node?.name ?? null, lastExitCode: r.server.lastExitCode, oomKilled: r.server.oomKilled } : null,
    serverName: r.originServerName,
  }));
  const messages = channels.length > 0 ? messagesFor(events, { panelUrl }) : [];
  report.messages = messages.length;

  const minuteAgo = new Date(now.getTime() - 60_000);
  const queue: Array<{ channelId: string; kind: string; payload: NotificationMessage; nextAttemptAt: Date; createdAt: Date }> = [];
  for (const channel of channels) {
    const wanted = messages.filter((m) => channel.events.includes(m.kind));
    if (wanted.length === 0) continue;
    const already = await db.notificationDelivery.count({ where: { channelId: channel.id, createdAt: { gt: minuteAgo } } });
    const noticed = (await db.notificationDelivery.count({ where: { channelId: channel.id, kind: "notifications.suppressed", createdAt: { gt: minuteAgo } } })) > 0;
    const limited = limitMessages(wanted, already, noticed, RATE_LIMIT_PER_MINUTE, now);
    report.suppressed += limited.suppressed;
    for (const message of [...limited.send, ...(limited.notice ? [limited.notice] : [])]) {
      queue.push({ channelId: channel.id, kind: message.kind, payload: message, nextAttemptAt: now, createdAt: now });
    }
  }
  report.queued = queue.length;

  // Together, so a delivery is queued once: the cursor does not move without its messages, nor the messages without it.
  await db.$transaction([
    ...(queue.length > 0 ? [db.notificationDelivery.createMany({ data: queue.map((q) => ({ ...q, payload: q.payload as never })) })] : []),
    db.notificationCursor.update({ where: { id: "events" }, data: { lastEventAt: last.createdAt, lastEventId: last.id } }),
  ]);
  return report;
}

/* ── Sending ──────────────────────────────────────────────────── */

export interface DeliverReport {
  attempted: number;
  sent: number;
  /** Failed and will be tried again. */
  retrying: number;
  /** Failed for good. */
  failed: number;
}

export interface DeliverOptions {
  /** Tests only: what stands in for the call. */
  send?: (channel: Parameters<typeof sendNotification>[0], message: NotificationMessage, options?: SendOptions) => Promise<SendResult>;
  sendOptions?: SendOptions;
}

let delivering = false;

export async function deliverPending(now: Date = new Date(), options: DeliverOptions = {}): Promise<DeliverReport> {
  const report: DeliverReport = { attempted: 0, sent: 0, retrying: 0, failed: 0 };
  // One at a time: two overlapping calls would send the same message twice.
  if (delivering) return report;
  delivering = true;
  try {
    const due = await db.notificationDelivery.findMany({
      where: { state: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: { createdAt: "asc" },
      take: DELIVER_PER_CALL,
      include: { channel: true },
    });
    const byChannel = new Map<string, typeof due>();
    for (const d of due) {
      const list = byChannel.get(d.channelId) ?? [];
      if (list.length < PER_CHANNEL_PER_CALL) list.push(d);
      byChannel.set(d.channelId, list);
    }
    const send = options.send ?? sendNotification;

    // Channels side by side, so a slow one does not hold up the others; one channel's messages in order.
    await Promise.all(
      [...byChannel.values()].map(async (list) => {
        for (const delivery of list) {
          report.attempted++;
          const channel = delivery.channel;
          const finish = async (result: SendResult) => {
            const attempts = delivery.attempts + 1;
            if (result.ok) {
              report.sent++;
              await db.$transaction([
                db.notificationDelivery.update({ where: { id: delivery.id }, data: { state: "SENT", attempts, sentAt: now, lastError: null } }),
                db.notificationChannel.update({ where: { id: channel.id }, data: { lastOkAt: now, lastError: null, lastErrorAt: null } }),
              ]);
              return;
            }
            const next = afterAttempt({ attempts, createdAt: delivery.createdAt, now, retry: result.retry });
            if (next.state === "PENDING") report.retrying++;
            else report.failed++;
            await db.$transaction([
              db.notificationDelivery.update({
                where: { id: delivery.id },
                data: { state: next.state, attempts, lastError: result.reason, ...(next.nextAttemptAt ? { nextAttemptAt: next.nextAttemptAt } : {}) },
              }),
              db.notificationChannel.update({ where: { id: channel.id }, data: { lastError: result.reason, lastErrorAt: now } }),
            ]);
          };

          if (!channel.enabled) {
            await finish({ ok: false, reason: "The channel was turned off before this was sent.", retry: false });
            continue;
          }
          let url: string;
          let signingSecret: string | null;
          try {
            url = decryptSecret(channel.url);
            signingSecret = channel.signingSecret ? decryptSecret(channel.signingSecret) : null;
          } catch {
            await finish({ ok: false, reason: "The channel's address cannot be read: SECRETS_KEY was changed without `rekey`. Set the channel up again.", retry: false });
            continue;
          }
          const kind = channel.kind === "DISCORD" ? ("DISCORD" as const) : ("WEBHOOK" as const);
          const result = await send({ kind, url, signingSecret }, delivery.payload as unknown as NotificationMessage, options.sendOptions);
          await finish(result);
        }
      }),
    );
  } finally {
    delivering = false;
  }
  return report;
}

/* ── Keeping the table small ──────────────────────────────────── */

const KEEP_SENT_MS = 7 * 24 * 3600_000;
const KEEP_FAILED_MS = 30 * 24 * 3600_000;

/** What was sent goes after a week, what was given up on after a month: long enough to find out why. */
export async function sweepDeliveries(now: Date = new Date()): Promise<number> {
  const sent = await db.notificationDelivery.deleteMany({ where: { state: "SENT", createdAt: { lt: new Date(now.getTime() - KEEP_SENT_MS) } } });
  const failed = await db.notificationDelivery.deleteMany({ where: { state: "FAILED", createdAt: { lt: new Date(now.getTime() - KEEP_FAILED_MS) } } });
  return sent.count + failed.count;
}

/* ── "An update is available" ─────────────────────────────────── */

/**
 * Writes a row to the audit log, once, for each server that has an update it
 * has not been told about. What it was told is `Server.updateNotifiedKey`: the
 * id of the version it could move to, or the build id for a game that has no
 * versions. An update that is applied clears the key, so the next one is news.
 */
export async function recordUpdatesAvailable(): Promise<number> {
  const catalogs = await storedCatalogs();
  const servers = await db.server.findMany({
    where: { gameId: { not: null } },
    select: { id: true, name: true, gameId: true, installedBuildId: true, updateNotifiedKey: true, gameVersionRef: { select: { slug: true } } },
  });

  let written = 0;
  for (const server of servers) {
    const catalog = server.gameId ? catalogs.get(server.gameId) : undefined;
    if (!catalog) continue;
    const outlook = outlookFor(catalog, { versionId: server.gameVersionRef?.slug ?? null, buildId: server.installedBuildId });
    const key = outlook.updateAvailable ? (outlook.updateTo?.id ?? outlook.currentBuildId ?? null) : null;

    if (key && key !== server.updateNotifiedKey) {
      await db.$transaction([
        db.server.update({ where: { id: server.id }, data: { updateNotifiedKey: key } }),
        db.activityEvent.create({
          data: {
            actor: "Catalog",
            action: "server.update.available",
            target: server.name,
            tone: "INFO",
            serverId: server.id,
            changes: { Update: { from: outlook.installedLabel ?? outlook.installed ?? "—", to: outlook.updateTo?.label ?? (outlook.currentBuildId ? `build ${outlook.currentBuildId}` : "a newer version") } },
          },
        }),
      ]);
      written++;
    } else if (!key && server.updateNotifiedKey) {
      await db.server.update({ where: { id: server.id }, data: { updateNotifiedKey: null } });
    }
  }
  return written;
}
