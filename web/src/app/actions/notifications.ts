"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  createChannelOp,
  removeChannelOp,
  rotateSigningSecretOp,
  testChannelOp,
  updateChannelOp,
  type ChannelChange,
  type ChannelInput,
  type ChannelResult,
} from "@/lib/notify/channel-ops";

/* The workspace's notification channels, set from the Notifications page.
   Every result is the page's to show; the page is refreshed either way,
   because a test that failed is a status it has to draw. */

function refresh() {
  revalidatePath("/notifications");
  revalidatePath("/audit");
}

export async function addChannel(input: ChannelInput): Promise<ChannelResult> {
  const result = await createChannelOp(await requireUser(), {
    name: String(input.name ?? ""),
    kind: String(input.kind ?? ""),
    url: String(input.url ?? ""),
    choices: Array.isArray(input.choices) ? input.choices.map(String) : [],
  });
  if (result.ok) refresh();
  return result;
}

export async function changeChannel(id: string, change: ChannelChange): Promise<ChannelResult> {
  const result = await updateChannelOp(await requireUser(), String(id ?? ""), {
    ...(change.name !== undefined ? { name: String(change.name) } : {}),
    ...(change.enabled !== undefined ? { enabled: Boolean(change.enabled) } : {}),
    ...(change.choices !== undefined ? { choices: Array.isArray(change.choices) ? change.choices.map(String) : [] } : {}),
  });
  if (result.ok) refresh();
  return result;
}

export async function testChannel(id: string): Promise<ChannelResult> {
  const result = await testChannelOp(await requireUser(), String(id ?? ""));
  refresh();
  return result;
}

export async function rotateChannelKey(id: string): Promise<ChannelResult> {
  const result = await rotateSigningSecretOp(await requireUser(), String(id ?? ""));
  if (result.ok) refresh();
  return result;
}

export async function removeChannel(id: string): Promise<ChannelResult> {
  const result = await removeChannelOp(await requireUser(), String(id ?? ""));
  if (result.ok) refresh();
  return result;
}
