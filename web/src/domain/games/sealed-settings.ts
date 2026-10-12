import { secretKeys, type ConfigValues } from "./config";
import type { GameDefinition } from "./types";

/* A server's secret settings, sealed at rest.

   A setting a definition marks `secret` (a join password, Garry's Mod's game server login token) was kept in the clear in the server's
   settings column, beside five columns sealed with SECRETS_KEY and outside `rekey`. From 0.11.0 the secret ones are kept sealed, as one
   JSON object in a column of their own (`servers.secretSettings`); this is the arithmetic of that, without the key or the database, which
   lib/server-secrets.ts brings.

   0.11.0 also kept a clear copy in the settings column, written on every save, because 0.10.1 reads it there. From 0.12.0 a save writes
   the sealed column and nowhere else, and the poller's first start takes out the clear copies already stored. A clear copy can still be
   there: one 0.12.0 has not reached yet, one a server whose sealed value does not open keeps, and one a panel rolled back to 0.11 writes
   again on every save. While it is there it is what the server has — that panel may have changed it after it was sealed — so the clear
   copy wins (withSealedValues), the poller seals it and takes it out at its next start (sealedIsCurrent), and otherwise the sealed
   copy is all there is. */

/** How a sealed value is made and opened: lib/secrets.ts, with the panel's key. */
export interface Sealer {
  seal: (plain: string) => string;
  open: (stored: string) => string;
}

/** The secret keys a server's settings hold, and their values; empty when it holds none. */
export function secretValuesOf(game: Pick<GameDefinition, "config">, values: ConfigValues): ConfigValues {
  const out: ConfigValues = {};
  for (const key of secretKeys(game).sort()) {
    if (key in values) out[key] = values[key]!;
  }
  return out;
}

/** What goes in the sealed column for these settings: the secret ones, sealed together, or null when there are none. */
export function sealSecretValues(game: Pick<GameDefinition, "config">, values: ConfigValues, sealer: Pick<Sealer, "seal">): string | null {
  const secret = secretValuesOf(game, values);
  return Object.keys(secret).length > 0 ? sealer.seal(JSON.stringify(secret)) : null;
}

/** The sealed column, opened. A value that does not open throws (a SecretsKeyError from lib/secrets.ts), the way every sealed column does. */
export function openSecretValues(stored: string | null | undefined, sealer: Pick<Sealer, "open">): ConfigValues {
  if (!stored) return {};
  const parsed: unknown = JSON.parse(sealer.open(stored));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: ConfigValues = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

/* What a server's settings are: the clear column, and from the sealed one every key the clear one does not have. The clear copy wins while
   it is there (see above); in the release that removes it, the sealed copy is all there is, and this is already what reads it. */
export function withSealedValues(clear: ConfigValues, opened: ConfigValues): ConfigValues {
  return { ...opened, ...clear };
}

/* Whether the sealed column says what the clear one does, for the secret keys the clear one has: what the poller asks at start, to seal
   settings this release has not seen (written by 0.10.1, before the upgrade or after a rollback) and to leave alone the ones it has. */
export function sealedIsCurrent(game: Pick<GameDefinition, "config">, clear: ConfigValues, opened: ConfigValues): boolean {
  const wanted = secretValuesOf(game, clear);
  return Object.entries(wanted).every(([key, value]) => opened[key] === value);
}
