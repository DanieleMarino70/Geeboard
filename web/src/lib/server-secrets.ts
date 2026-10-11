import "server-only";
import { Prisma } from "@prisma/client";
import type { ConfigValues } from "@/domain/games/config";
import { findGame } from "@/domain/games/registry";
import { openSecretValues, sealedIsCurrent, sealSecretValues, secretValuesOf, withSealedValues } from "@/domain/games/sealed-settings";
import type { GameDefinition } from "@/domain/games/types";
import { readWorkloadSpec, withoutSecretEnv } from "@/domain/games/workload";
import { db } from "./db";
import { refreshCommunityGames } from "./community-games";
import { decryptSecret, encryptSecret } from "./secrets";

/* A server's secret settings, sealed with SECRETS_KEY (0.11.0). What is sealed and why the clear copy stays one more release is in
   domain/games/sealed-settings.ts; this brings the key and the database. */

const sealer = { seal: (plain: string) => encryptSecret(plain), open: decryptSecret };

/** A server's settings as they are, sealed ones included: what is rendered for the game and what a typed command is redacted against. */
export function storedSettings(server: { config?: unknown; secretSettings?: string | null }): ConfigValues {
  const clear = (server.config ?? {}) as ConfigValues;
  if (!server.secretSettings) return clear;
  return withSealedValues(clear, openSecretValues(server.secretSettings, sealer));
}

/* The same, for a line of the audit log, which must be written whatever the key: a value that does not open (the boot check has said so)
   is redacted against the clear copy alone, which in this release still holds every secret. */
export function settingsForRedaction(server: { config?: unknown; secretSettings?: string | null }): ConfigValues {
  try {
    return storedSettings(server);
  } catch {
    return (server.config ?? {}) as ConfigValues;
  }
}

/** The columns a save writes: the settings, with the clear copy of the secret ones for 0.10.1, and the secret ones sealed. */
export function settingsData(
  game: Pick<GameDefinition, "config">,
  values: ConfigValues,
): { config: Prisma.InputJsonValue; secretSettings: string | null } {
  return { config: values as Prisma.InputJsonValue, secretSettings: sealSecretValues(game, values, sealer) };
}

/* Run by the poller when it starts, before it checks that the stored secrets open: seals the secret settings of every server whose sealed
   column does not yet say what the clear one does — every server, the first time 0.11.0 starts, and any whose settings a 0.10.1 panel
   changed after a rollback — and takes them out of the record of what its workload was made from, where an environment variable's value
   was kept in the clear (domain/games/workload.ts). Each write is a compare-and-set on what was read, so a save that lands in between is
   not overwritten. A sealed value that does not open is left as it is, for the boot check to report: sealing it again with this key would
   leave two keys in the column. */
export async function sealServerSettings(): Promise<{ sealed: number; specs: number; unreadable: number }> {
  await refreshCommunityGames().catch(() => {});
  const servers = await db.server.findMany({
    where: { gameId: { not: null } },
    select: { id: true, gameId: true, config: true, secretSettings: true, builtSpec: true },
  });

  let sealed = 0;
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
      if (opened && !sealedIsCurrent(game, clear, opened)) {
        const written = await db.server.updateMany({
          where: { id: server.id, secretSettings: server.secretSettings },
          data: { secretSettings: sealSecretValues(game, withSealedValues(clear, opened), sealer) },
        });
        sealed += written.count;
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
  return { sealed, specs, unreadable };
}
