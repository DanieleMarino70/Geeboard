import "server-only";
import type { User } from "@prisma/client";
import { asPlatformError } from "@/domain/errors";
import { allGames } from "@/domain/games/registry";
import { db } from "./db";
import { logger } from "./log";
import { decryptSecret, encryptSecret } from "./secrets";
import type { OpResult } from "./server-ops";
import { searchWorkshop } from "./workshop";

/* The Steam Web API key, and the one thing it is for: searching the
   Workshop. Adding a mod by its link or id, or a whole collection, needs
   no key and never reads this.

   It can come from two places, and which one wins is decided here rather
   than left to whichever was read first:

     STEAM_API_KEY in the panel's environment    wins, when set
     a key saved from the Mods tab               used otherwise

   The environment wins because it was there first — every installation
   that set one keeps working, unchanged, across the upgrade that added
   the other — and because it is the only order in which the page never
   has to hedge: while the environment sets a key, the page says so and
   offers nothing to save, since a saved key would not be the one used.
   The other order would let "Remove" leave searching on, quietly, with a
   key nobody on the page can see.

   Saved like the bucket's secret: encrypted at rest, tested before it is
   kept, and never sent back to a browser — not even a few characters of
   it, since unlike the bucket's key id no part of it is not the secret. */

export type KeySource = "environment" | "panel";

const ID = "steam";

function mayManage(actor: User): boolean {
  return actor.role === "OWNER" || actor.role === "ADMIN";
}

function fromEnvironment(): string | null {
  return process.env.STEAM_API_KEY?.trim() || null;
}

/** The key searching uses, and where it came from. Null when there is none. */
export async function workshopKey(): Promise<{ key: string; source: KeySource } | null> {
  const env = fromEnvironment();
  if (env) return { key: env, source: "environment" };

  const row = await db.workshopKey.findUnique({ where: { id: ID } });
  if (!row) return null;
  try {
    return { key: decryptSecret(row.apiKey), source: "panel" };
  } catch (error) {
    /* SECRETS_KEY changed since it was saved. Not a key anybody can use,
       so there is none; the Mods tab says so and asks for it again. */
    logger.warn("workshop key does not decrypt", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export interface WorkshopKeyStatus {
  /** Where the key in use comes from; null when searching is off. */
  source: KeySource | null;
  /** A key is saved here, and the environment's is the one used instead. */
  shadowed: boolean;
  /** A key is saved here and cannot be decrypted with this panel's SECRETS_KEY. */
  unreadable: boolean;
  configuredBy: string | null;
  configuredAt: Date | null;
  checkedAt: Date | null;
  checkError: string | null;
}

/** What the Mods tab shows about the key — nothing of the key itself. */
export async function workshopKeyStatus(): Promise<WorkshopKeyStatus> {
  const [row, key] = await Promise.all([db.workshopKey.findUnique({ where: { id: ID } }), workshopKey()]);
  const by = row?.configuredById
    ? await db.user.findUnique({ where: { id: row.configuredById }, select: { name: true } })
    : null;
  return {
    source: key?.source ?? null,
    shadowed: Boolean(row) && key?.source === "environment",
    unreadable: Boolean(row) && key === null,
    configuredBy: by?.name ?? null,
    configuredAt: row?.updatedAt ?? null,
    checkedAt: row?.checkedAt ?? null,
    checkError: row?.checkError ?? null,
  };
}

/* The same question searching asks, as small as it can be asked: one
   result, for a game that takes mods from the Workshop. A key that can
   do something else and not this is no use here. */
async function probe(key: string): Promise<void> {
  const appId = allGames().find((game) => game.mods?.provider === "steam-workshop")?.mods?.appId;
  if (!appId) throw new Error("no game in the catalogue takes mods from the Steam Workshop");
  await searchWorkshop(key, appId, "", { perPage: 1 });
}

/* What searching learned about a saved key, kept so the tab can say it
   has stopped working before somebody wonders why the shelf is empty.
   Written only when it changes: a search is not a reason to write a row. */
export async function noteKeyAnswer(source: KeySource, refusal: string | null): Promise<void> {
  if (source !== "panel") return;
  if (refusal) {
    await db.workshopKey.updateMany({ where: { id: ID }, data: { checkedAt: new Date(), checkError: refusal } });
  } else {
    await db.workshopKey.updateMany({ where: { id: ID, checkError: { not: null } }, data: { checkedAt: new Date(), checkError: null } });
  }
}

async function record(actor: User, action: string, tone: "INFO" | "WARNING") {
  await db.activityEvent.create({ data: { actor: actor.name, action, target: "Steam Web API key", tone, userId: actor.id } });
}

const IN_ENVIRONMENT =
  "STEAM_API_KEY is set in the panel's environment, and that key is the one used. To manage it here, remove it from deploy/panel/.env and restart the panel.";

export async function setWorkshopKeyOp(actor: User, raw: string): Promise<OpResult> {
  if (!mayManage(actor)) return { ok: false, title: "Not permitted", body: "Only owners and admins can set the Steam key." };
  if (fromEnvironment()) return { ok: false, title: "Set in the environment", body: IN_ENVIRONMENT };

  const key = raw.trim().toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(key)) {
    return {
      ok: false,
      title: "That is not a Steam Web API key",
      body: "A key is 32 letters and digits, from steamcommunity.com/dev/apikey.",
    };
  }

  /* Nothing is saved that did not just work, as with the bucket: a key
     Steam turns down is refused here, with Steam's reason. */
  try {
    await probe(key);
  } catch (error) {
    const failure = asPlatformError(error);
    return failure.code === "MOD_KEY_REFUSED"
      ? { ok: false, title: "Steam refused that key", body: "Check it was copied whole, from steamcommunity.com/dev/apikey. Nothing was saved." }
      : { ok: false, title: "Could not ask Steam", body: `${failure.message} Nothing was saved.` };
  }

  const data = { apiKey: encryptSecret(key), checkedAt: new Date(), checkError: null, configuredById: actor.id };
  await db.workshopKey.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });
  await record(actor, "workshop.key.set", "INFO");

  return {
    ok: true,
    tone: "success",
    title: "Searching the Workshop is on",
    body: "Steam accepted the key. It is stored encrypted and will not be shown again.",
  };
}

export async function checkWorkshopKeyOp(actor: User): Promise<OpResult> {
  if (!mayManage(actor)) return { ok: false, title: "Not permitted", body: "Only owners and admins can check the Steam key." };
  const key = await workshopKey();
  if (!key) return { ok: false, title: "No key", body: "There is no Steam key to check. Set one first." };

  try {
    await probe(key.key);
  } catch (error) {
    const failure = asPlatformError(error);
    if (key.source === "panel") {
      await db.workshopKey.update({ where: { id: ID }, data: { checkedAt: new Date(), checkError: failure.message } });
    }
    if (failure.code !== "MOD_KEY_REFUSED") return { ok: false, title: "Could not ask Steam", body: failure.message };
    return {
      ok: false,
      title: "Steam refused the key",
      body:
        key.source === "environment"
          ? "Revoked or mistyped, most likely. It is STEAM_API_KEY, in the panel's environment."
          : "Revoked or mistyped, most likely. Replace it here.",
    };
  }

  if (key.source === "panel") {
    await db.workshopKey.update({ where: { id: ID }, data: { checkedAt: new Date(), checkError: null } });
  }
  return {
    ok: true,
    tone: "success",
    title: "Steam accepts the key",
    body: key.source === "environment" ? "The key in the panel's environment works." : "Searching the Workshop works.",
  };
}

/* Forgetting the key. Nothing else is touched: the mods already chosen
   stay chosen, and adding one by its link still works. */
export async function removeWorkshopKeyOp(actor: User): Promise<OpResult> {
  if (!mayManage(actor)) return { ok: false, title: "Not permitted", body: "Only owners and admins can remove the Steam key." };
  const row = await db.workshopKey.findUnique({ where: { id: ID } });
  if (!row) return { ok: false, title: "No key", body: "No key is saved in the panel." };

  await db.workshopKey.delete({ where: { id: ID } });
  await record(actor, "workshop.key.removed", "WARNING");
  return {
    ok: true,
    tone: "warning",
    title: "Steam key removed",
    body: fromEnvironment()
      ? "The key in the panel's environment is still the one used."
      : "Searching the Workshop is off. Adding a mod or a collection by its link still works.",
  };
}
