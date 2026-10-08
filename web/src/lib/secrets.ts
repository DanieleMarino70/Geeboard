import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { SecretsKeyError } from "@/domain/errors";

/* Node agent tokens are the one secret the panel must be able to read
   back — it presents them to the agent — so they cannot be hashed.
   They are encrypted at rest instead, with AES-256-GCM so a tampered
   ciphertext fails to decrypt rather than yielding garbage. The same goes
   for the other secrets the panel holds to use later: a TOTP secret, the
   off-site bucket's key, the Steam key, a DNS provider's token. */

const VERSION = "v1";

/* The key the panel encrypts with, from its environment: SECRETS_KEY, and in
   development, where it may be left out, SESSION_SECRET in its place. */
function currentSecret(): string {
  const secret = process.env.SECRETS_KEY ?? process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SECRETS_KEY (or SESSION_SECRET) must be set and at least 32 characters to encrypt node tokens",
    );
  }
  return secret;
}

/* A fixed salt is acceptable here: the input is already a high-entropy
   secret, not a user-chosen password.

   And a fixed salt makes the key a pure function of the secret string, so it is derived once and
   kept. It was derived on every decrypt: scrypt is 30 ms of synchronous work, 99.98 % of a
   decrypt (the AES-GCM open with a key in hand is 0.005 ms), and it stops the whole process while
   it runs — every request, every stream. Every page that touched a node, a bucket, a DNS provider
   or a notification channel paid it, the poller paid it per node per pass, and the heartbeat, which
   anyone can send, paid it before it compared the token. The map is keyed by the secret itself
   because `rekey` holds two at once, and is a few entries long. */
const keys = new Map<string, Buffer>();
const KEPT = 4;

function deriveKey(secret: string): Buffer {
  const known = keys.get(secret);
  if (known) return known;
  const key = scryptSync(secret, "geeboard-node-tokens", 32);
  if (keys.size >= KEPT) keys.delete(keys.keys().next().value!);
  keys.set(secret, key);
  return key;
}

/* Sealing and opening with a secret handed in rather than read from the
   environment. The panel never needs this — it has one key — but changing the
   key does: `rekey` opens every stored secret with the old one and seals it
   with the new one, and has to hold both at once (see lib/rekey-ops.ts). The
   format is the one encryptSecret and decryptSecret have always written. */
export function sealWith(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function openWith(secret: string, stored: string): string {
  const [version, ivB64, tagB64, dataB64] = stored.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("stored secret is not in the expected format");
  }

  /* The whole tag, and nothing shorter: GCM accepts a tag of four bytes if it is told to expect one, which turns forging a value from a 2^128 problem into
     a 2^32 one against anything that will say whether a value opened (the audit of 0.9.5). */
  const tag = Buffer.from(tagB64, "base64url");
  if (tag.length !== 16) throw new Error("stored secret is not in the expected format");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(ivB64, "base64url"), { authTagLength: 16 });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    // GCM's tag does not match: a value sealed with another key, or one that was changed. It said "Unsupported state or unable to authenticate data".
    throw new SecretsKeyError(cause);
  }
}

export function encryptSecret(plaintext: string): string {
  return sealWith(currentSecret(), plaintext);
}

export function decryptSecret(stored: string): string {
  return openWith(currentSecret(), stored);
}
