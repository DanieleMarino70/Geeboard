import "server-only";
import { db } from "./db";
import { secretProblem } from "./env-check";
import { openWith, sealWith } from "./secrets";

/* Changing the key the panel encrypts its stored secrets with.

   Until this existed, rotating SECRETS_KEY made every stored secret unreadable
   at once — the nodes' tokens, the off-site bucket's key, the Steam key, a DNS
   provider's token, every account's two-factor secret — and the only way out was
   to register every node again and set everything else up again. A key that
   cannot be changed without that is a key nobody changes, and one that leaks is
   then a leak for good.

   This reads every stored secret, opens each with the current key and seals it
   with a new one, in one transaction, so what it does it does entirely or not at
   all. The agents are not touched: a node's token lives in plain text on its own
   machine, and only the panel's copy is encrypted.

   What it will not do, and says:
     - write anything when any value does not open with the current key. A value
       that does not open is a sign the key is not the one the data was written
       with — most often because SECRETS_KEY was changed in the environment before
       this ran — and re-encrypting the rest would leave the panel with two keys.
     - write a value that changed under it. The panel and the poller are stopped
       first, as they are for a migration; if a secret is written between the read
       and the write anyway, the write of that row finds it changed, and the whole
       transaction is undone.
     - say a key, or a secret, anywhere. It names kinds and counts, and for a value
       that does not open, the node's name or the account's address, which are not
       secrets and are what somebody needs to find it. */

export interface RekeyInput {
  /** What the panel encrypts with now: SECRETS_KEY, or SESSION_SECRET when that is not set. */
  currentKey: string | undefined;
  newKey: string | undefined;
  /** SESSION_SECRET, which the new key must not be: they are separate so one can be rotated alone. */
  sessionSecret: string | undefined;
  dryRun?: boolean;
  /** For tests: run after everything is read and sealed, and before the write. */
  beforeWrite?: () => Promise<void>;
}

export interface RekeyReport {
  ok: boolean;
  dryRun: boolean;
  /** How many values of each kind were, or would be, sealed again. */
  counts: Array<{ kind: string; values: number }>;
  /** One sentence for a person, when ok is false. Never a key or a secret. */
  problem?: string;
}

interface Found {
  kind: string;
  /** What to call it when it will not open: a node's name, an account's address. */
  name: string;
  /** Where it lives, to write it back. */
  write: (tx: Tx, from: string, to: string) => Promise<number>;
  stored: string;
}

type Tx = Omit<typeof db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

const KINDS = {
  node: "node tokens",
  totp: "two-factor secrets",
  bucket: "off-site bucket keys",
  steam: "Steam keys",
  dns: "DNS provider tokens",
  dnsEndpoint: "DNS webhook addresses",
  channelUrl: "notification addresses",
  channelKey: "webhook signing keys",
} as const;

/* Every column the panel seals with SECRETS_KEY, and what rekey calls it.

   It was a list written inside `everything()`, so a new secret column that nobody added to it was never sealed again: after a rekey that
   reported success the DNS provider, a channel or the bucket stopped opening, which is the failure rekey exists to prevent, and every new
   provider, store or channel kind is a chance to cause it. The table is the one place a sealed column is named; the loaders below are keyed by
   it (the compiler asks for one for each entry), and test/sealed-columns.test.ts reads schema.prisma for every column documented as encrypted
   and every encryptSecret( call under src/lib, and fails on one that is not here. */
export const SEALED_COLUMNS = {
  "Node.daemonToken": KINDS.node,
  "User.totpSecret": KINDS.totp,
  "BackupStorage.secretAccessKey": KINDS.bucket,
  "WorkshopKey.apiKey": KINDS.steam,
  "DnsProvider.token": KINDS.dns,
  // A webhook's address can hold a secret, so it is sealed like the token beside it and has to be sealed again with it.
  "DnsProvider.endpoint": KINDS.dnsEndpoint,
  "NotificationChannel.url": KINDS.channelUrl,
  "NotificationChannel.signingSecret": KINDS.channelKey,
} as const;

type Sealed = keyof typeof SEALED_COLUMNS;

const LOADERS: Record<Sealed, () => Promise<Found[]>> = {
  "Node.daemonToken": async () =>
    (await db.node.findMany({ where: { daemonToken: { not: null } }, select: { id: true, name: true, daemonToken: true } })).map((node) => ({
      kind: KINDS.node,
      name: node.name,
      stored: node.daemonToken!,
      write: async (tx, from, to) => (await tx.node.updateMany({ where: { id: node.id, daemonToken: from }, data: { daemonToken: to } })).count,
    })),
  "User.totpSecret": async () =>
    (await db.user.findMany({ where: { totpSecret: { not: null } }, select: { id: true, email: true, totpSecret: true } })).map((user) => ({
      kind: KINDS.totp,
      name: user.email,
      stored: user.totpSecret!,
      write: async (tx, from, to) => (await tx.user.updateMany({ where: { id: user.id, totpSecret: from }, data: { totpSecret: to } })).count,
    })),
  "BackupStorage.secretAccessKey": async () =>
    (await db.backupStorage.findMany({ select: { id: true, secretAccessKey: true } })).map((row) => ({
      kind: KINDS.bucket,
      name: "the off-site bucket",
      stored: row.secretAccessKey,
      write: async (tx, from, to) => (await tx.backupStorage.updateMany({ where: { id: row.id, secretAccessKey: from }, data: { secretAccessKey: to } })).count,
    })),
  "WorkshopKey.apiKey": async () =>
    (await db.workshopKey.findMany({ select: { id: true, apiKey: true } })).map((row) => ({
      kind: KINDS.steam,
      name: "the Steam key",
      stored: row.apiKey,
      write: async (tx, from, to) => (await tx.workshopKey.updateMany({ where: { id: row.id, apiKey: from }, data: { apiKey: to } })).count,
    })),
  "DnsProvider.token": async () =>
    (await db.dnsProvider.findMany({ select: { id: true, token: true } })).map((row) => ({
      kind: KINDS.dns,
      name: "the DNS provider",
      stored: row.token,
      write: async (tx, from, to) => (await tx.dnsProvider.updateMany({ where: { id: row.id, token: from }, data: { token: to } })).count,
    })),
  "DnsProvider.endpoint": async () =>
    (await db.dnsProvider.findMany({ where: { endpoint: { not: null } }, select: { id: true, endpoint: true } })).map((row) => ({
      kind: KINDS.dnsEndpoint,
      name: "the DNS provider's address",
      stored: row.endpoint!,
      write: async (tx, from, to) => (await tx.dnsProvider.updateMany({ where: { id: row.id, endpoint: from }, data: { endpoint: to } })).count,
    })),
  "NotificationChannel.url": async () =>
    (await db.notificationChannel.findMany({ select: { id: true, name: true, url: true } })).map((row) => ({
      kind: KINDS.channelUrl,
      name: `the notification channel ${row.name}`,
      stored: row.url,
      write: async (tx, from, to) => (await tx.notificationChannel.updateMany({ where: { id: row.id, url: from }, data: { url: to } })).count,
    })),
  "NotificationChannel.signingSecret": async () =>
    (await db.notificationChannel.findMany({ where: { signingSecret: { not: null } }, select: { id: true, name: true, signingSecret: true } })).map((row) => ({
      kind: KINDS.channelKey,
      name: `the notification channel ${row.name}`,
      stored: row.signingSecret!,
      write: async (tx, from, to) => (await tx.notificationChannel.updateMany({ where: { id: row.id, signingSecret: from }, data: { signingSecret: to } })).count,
    })),
};

async function everything(): Promise<Found[]> {
  return (await Promise.all(Object.values(LOADERS).map((load) => load()))).flat();
}

function countsOf(values: Found[]): RekeyReport["counts"] {
  return Object.values(KINDS).map((kind) => ({ kind, values: values.filter((v) => v.kind === kind).length }));
}

class Changed extends Error {}

export async function rekeyOp(input: RekeyInput): Promise<RekeyReport> {
  const dryRun = Boolean(input.dryRun);
  const refuse = (problem: string): RekeyReport => ({ ok: false, dryRun, counts: [], problem });

  if (!input.currentKey || input.currentKey.length < 32) {
    return refuse("The current key is missing or shorter than 32 characters: set SECRETS_KEY to what the secrets were written with — or SESSION_SECRET, if SECRETS_KEY was never set.");
  }
  const bad = secretProblem("SECRETS_KEY_NEW", input.newKey);
  if (bad) return refuse(bad);
  if (input.newKey === input.currentKey) return refuse("SECRETS_KEY_NEW is the key the secrets are already sealed with. Generate another: openssl rand -hex 32.");
  if (input.newKey === input.sessionSecret) {
    return refuse("SECRETS_KEY_NEW is the same as SESSION_SECRET. They are separate so that one can be rotated without the other. Generate another: openssl rand -hex 32.");
  }
  const currentKey = input.currentKey;
  const newKey = input.newKey!;

  const values = await everything();

  // Everything must open with the current key before anything is written.
  const opened: Array<{ value: Found; plain: string }> = [];
  const unreadable: Found[] = [];
  for (const value of values) {
    try {
      opened.push({ value, plain: openWith(currentKey, value.stored) });
    } catch {
      unreadable.push(value);
    }
  }
  if (unreadable.length > 0) {
    const kinds = [...new Set(unreadable.map((v) => v.kind))];
    const names = unreadable.slice(0, 5).map((v) => v.name).join(", ") + (unreadable.length > 5 ? `, and ${unreadable.length - 5} more` : "");
    if (opened.length === 0) {
      return refuse(
        `Nothing the panel has stored opens with the current key (${kinds.join(", ")}: ${names}). If SECRETS_KEY was changed in the environment before this ran, put the value it had back, pass the new one as SECRETS_KEY_NEW, and run this again — the change comes after.`,
      );
    }
    return refuse(
      `${unreadable.length} of ${values.length} stored secrets do not open with the current key (${kinds.join(", ")}: ${names}). Nothing was changed: sealing the rest with a new key would leave two keys in use. Find out which key these were written with, or remove them and set them up again.`,
    );
  }

  const sealed = opened.map(({ value, plain }) => ({ value, plain, to: sealWith(newKey, plain) }));
  // A value that does not open again with the new key is found now, in memory, and not after the commit.
  for (const { plain, to } of sealed) {
    if (openWith(newKey, to) !== plain) return refuse("A value did not open again with the new key after it was sealed with it. Nothing was changed.");
  }

  const counts = countsOf(values);
  if (dryRun) return { ok: true, dryRun, counts };

  await input.beforeWrite?.();

  try {
    await db.$transaction(async (tx) => {
      for (const { value, to } of sealed) {
        if ((await value.write(tx, value.stored, to)) !== 1) throw new Changed();
      }
      await tx.activityEvent.create({
        data: {
          actor: "Operator",
          action: "secrets.rekeyed",
          target: `${values.length} stored secret${values.length === 1 ? "" : "s"}`,
          tone: "WARNING",
          changes: Object.fromEntries(counts.filter((c) => c.values > 0).map((c) => [c.kind, { from: "old key", to: `new key · ${c.values}` }])),
        },
      });
    });
  } catch (error) {
    if (error instanceof Changed) {
      return refuse("A stored secret changed while this ran, so nothing was changed. Stop the panel and the poller, as for a migration, and run it again.");
    }
    throw error;
  }
  return { ok: true, dryRun, counts };
}
