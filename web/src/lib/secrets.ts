import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/* Node agent tokens are the one secret the panel must be able to read
   back — it presents them to the agent — so they cannot be hashed.
   They are encrypted at rest instead, with AES-256-GCM so a tampered
   ciphertext fails to decrypt rather than yielding garbage. */

const VERSION = "v1";

function key(): Buffer {
  const secret = process.env.SECRETS_KEY ?? process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SECRETS_KEY (or SESSION_SECRET) must be set and at least 32 characters to encrypt node tokens",
    );
  }
  // A fixed salt is acceptable here: the input is already a
  // high-entropy secret, not a user-chosen password.
  return scryptSync(secret, "geeboard-node-tokens", 32);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(stored: string): string {
  const [version, ivB64, tagB64, dataB64] = stored.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("stored secret is not in the expected format");
  }

  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
