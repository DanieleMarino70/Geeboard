"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { checkAddressOp, type AddressCheck } from "@/lib/address-check";
import { checkDnsOp, configureDnsOp, newWebhookSecretOp, removeDnsOp, retryServerDnsOp, type DnsProviderInput } from "@/lib/dns-ops";
import type { OpResult } from "@/lib/server-ops";

/* The DNS provider is the workspace's; it is set from the DNS page,
   which is where its records are listed. */

function refresh() {
  revalidatePath("/dns");
  revalidatePath("/servers");
  revalidatePath("/audit");
}

export async function configureDns(input: DnsProviderInput): Promise<OpResult> {
  const result = await configureDnsOp(await requireUser(), {
    kind: String(input.kind ?? ""),
    token: String(input.token ?? ""),
    zone: String(input.zone ?? ""),
    checkHost: String(input.checkHost ?? ""),
    endpoint: String(input.endpoint ?? ""),
  });
  if (result.ok) refresh();
  return result;
}

/* A signing secret for a webhook, to be put in the receiver before the test that saves it. Nothing is stored. */
export async function makeWebhookSecret(): Promise<{ ok: true; secret: string } | { ok: false; title: string; body: string }> {
  return newWebhookSecretOp(await requireUser());
}

// Refreshes either way: a token the provider stopped taking is a result the page has to show.
export async function checkDns(): Promise<OpResult> {
  const result = await checkDnsOp(await requireUser());
  refresh();
  return result;
}

export async function removeDns(): Promise<OpResult> {
  const result = await removeDnsOp(await requireUser());
  if (result.ok) refresh();
  return result;
}

export async function retryServerDns(slug: string): Promise<OpResult> {
  const result = await retryServerDnsOp(await requireUser(), slug);
  refresh();
  revalidatePath(`/servers/${slug}`);
  return result;
}

/* The create wizard's look at the address somebody typed: does the name
   exist, where does it point, and what does that mean for this workspace. */
export async function checkServerAddress(host: string): Promise<AddressCheck> {
  return checkAddressOp(await requireUser(), String(host ?? ""));
}
