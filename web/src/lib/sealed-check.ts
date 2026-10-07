import "server-only";
import type { SealedReport } from "@/domain/sealed";
import { db } from "./db";
import { decryptSecret } from "./secrets";

/* Does the key this process has open what the database holds?

   Nothing said so. A restored dump beside another key, an edited `.env` or a `rekey` finished without the new value swapped in left the
   panel running, the nodes reading healthy and every sign-in with two-factor an error page, while the poller logged OpenSSL's words once a
   pass. This opens every sealed value once, at start, and counts the ones that do not: one line for the log and, from the poller, one on
   the Nodes page for each node whose token is among them. The columns are the ones `rekey` re-seals (lib/rekey-ops.ts). */

export async function checkSealedSecrets(): Promise<SealedReport> {
  let opened = 0;
  const failed = new Map<string, number>();
  const open = (what: string, stored: string | null | undefined) => {
    if (!stored) return;
    try {
      decryptSecret(stored);
      opened++;
    } catch {
      failed.set(what, (failed.get(what) ?? 0) + 1);
    }
  };

  for (const row of await db.node.findMany({ where: { daemonToken: { not: null } }, select: { daemonToken: true } })) open("node tokens", row.daemonToken);
  for (const row of await db.user.findMany({ where: { totpSecret: { not: null } }, select: { totpSecret: true } })) open("two-factor secrets", row.totpSecret);
  for (const row of await db.backupStorage.findMany({ select: { secretAccessKey: true } })) open("the off-site bucket's key", row.secretAccessKey);
  for (const row of await db.workshopKey.findMany({ select: { apiKey: true } })) open("the Steam key", row.apiKey);
  for (const row of await db.dnsProvider.findMany({ select: { token: true, endpoint: true } })) {
    open("the DNS provider's token", row.token);
    open("the DNS provider's token", row.endpoint);
  }
  for (const row of await db.notificationChannel.findMany({ select: { url: true, signingSecret: true } })) {
    open("notification channels", row.url);
    open("notification channels", row.signingSecret);
  }

  return { opened, unreadable: [...failed].map(([what, count]) => ({ what, count })) };
}
