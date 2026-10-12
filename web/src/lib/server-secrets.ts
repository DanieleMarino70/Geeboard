import "server-only";
import { Prisma } from "@prisma/client";
import { redactTyped, secretKeys, TYPED_SECRET_MARK, withoutSecrets, type ConfigValues } from "@/domain/games/config";
import { findGame } from "@/domain/games/registry";
import { openSecretValues, sealedIsCurrent, sealSecretValues, secretValuesOf, withSealedValues } from "@/domain/games/sealed-settings";
import type { GameDefinition } from "@/domain/games/types";
import { readWorkloadSpec, withoutSecretEnv } from "@/domain/games/workload";
import { db } from "./db";
import { refreshCommunityGames } from "./community-games";
import { decryptSecret, encryptSecret } from "./secrets";

/* A server's secret settings, sealed with SECRETS_KEY (0.11.0); the arithmetic is domain/games/sealed-settings.ts, and this brings the key
   and the database. 0.11.0 kept a clear copy of them in the settings column for one more release, so that 0.10.1's code could still give
   the game its password; from 0.12.0 a save writes them sealed and nowhere else, and the poller's first start removes the copies already
   stored (sealServerSettings below), so a dump of the database no longer holds a join password in the clear. A clear copy that is there is
   still what the server has: a panel rolled back to 0.11 writes one again on every save, and the next start seals it and removes it. */

const sealer = { seal: (plain: string) => encryptSecret(plain), open: decryptSecret };

/** A server's settings as they are, sealed ones included: what is rendered for the game and what a typed command is redacted against. */
export function storedSettings(server: { config?: unknown; secretSettings?: string | null }): ConfigValues {
  const clear = (server.config ?? {}) as ConfigValues;
  if (!server.secretSettings) return clear;
  return withSealedValues(clear, openSecretValues(server.secretSettings, sealer));
}

/* A typed command or a task's text as the audit log keeps it (domain/games/config.ts, redactTyped), which must be written whatever the key.
   When the sealed settings do not open (the boot check has said so) the values to take out of it cannot be known, and what followed the
   command's first word is taken out instead: 0.11.0 redacted against the clear copy, which held every secret then and holds none now. */
export function commandForAudit(
  game: Pick<GameDefinition, "config"> | undefined,
  server: { config?: unknown; secretSettings?: string | null },
  text: string,
): string {
  try {
    return redactTyped(game, storedSettings(server), text);
  } catch {
    if (!game || secretKeys(game).length === 0) return text;
    const [, verb, rest] = /^(\s*\S+)(\s+\S[\s\S]*)?$/.exec(text) ?? [];
    return verb && rest ? `${verb} ${TYPED_SECRET_MARK}` : text;
  }
}

/** The columns a save writes: the settings without the secret ones, and the secret ones sealed. */
export function settingsData(
  game: Pick<GameDefinition, "config">,
  values: ConfigValues,
): { config: Prisma.InputJsonValue; secretSettings: string | null } {
  return { config: withoutSecrets(game, values) as Prisma.InputJsonValue, secretSettings: sealSecretValues(game, values, sealer) };
}

/* Run by the poller when it starts, before it checks that the stored secrets open. A server whose settings column still holds a secret —
   every one 0.11.0 saved, and any a panel rolled back to 0.11 saved since — has it sealed, when the sealed column does not already say the
   same, and taken out of the settings, in one write. The secrets of a server that 0.10.1 left and nothing has sealed yet go the same way.
   The poller also takes them out of the record of what its workload was made from, where an environment variable's value was kept in the
   clear (domain/games/workload.ts). Each write is a compare-and-set on what was read, so a save that lands in between is not overwritten.
   A sealed value that does not open is left as it is, with its clear copy, for the boot check to report: sealing it again with this key
   would leave two keys in the column, and removing the clear copy would lose the one copy that can still be read. */
export async function sealServerSettings(): Promise<{ sealed: number; cleared: number; specs: number; unreadable: number }> {
  await refreshCommunityGames().catch(() => {});
  const servers = await db.server.findMany({
    where: { gameId: { not: null } },
    select: { id: true, gameId: true, config: true, secretSettings: true, builtSpec: true },
  });

  let sealed = 0;
  let cleared = 0;
  let specs = 0;
  let unreadable = 0;
  for (const server of servers) {
    const game = findGame(server.gameId!);
    if (!game) continue;

    const clear = (server.config ?? {}) as ConfigValues;
    if (Object.keys(secretValuesOf(game, clear)).length > 0) {
      let opened: ConfigValues | null;
      try {
        opened = openSecretValues(server.secretSettings, sealer);
      } catch {
        opened = null;
        unreadable++;
      }
      if (opened) {
        const current = sealedIsCurrent(game, clear, opened);
        const written = await db.server.updateMany({
          where: { id: server.id, secretSettings: server.secretSettings, config: { equals: server.config as Prisma.InputJsonValue } },
          data: {
            ...(current ? {} : { secretSettings: sealSecretValues(game, withSealedValues(clear, opened), sealer) }),
            config: withoutSecrets(game, clear) as Prisma.InputJsonValue,
          },
        });
        if (!current) sealed += written.count;
        cleared += written.count;
      }
    }

    const spec = readWorkloadSpec(server.builtSpec);
    if (spec) {
      const kept = withoutSecretEnv(spec, game);
      if (Object.keys(kept.env).length !== Object.keys(spec.env).length) {
        const written = await db.server.updateMany({
          where: { id: server.id, builtSpec: { equals: server.builtSpec as Prisma.InputJsonValue } },
          data: { builtSpec: kept as unknown as Prisma.InputJsonValue },
        });
        specs += written.count;
      }
    }
  }
  return { sealed, cleared, specs, unreadable };
}
