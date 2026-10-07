import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/* A secret column that rekey does not know is a secret that stops opening the day the key is changed. rekey used to know its columns from a
   list inside a function, nothing tied that list to the schema or to the code that seals, and every new provider, store or channel kind was a
   chance to add a column and forget it. This reads the three places that say what is sealed, and fails when they disagree: the schema (a
   column documented as encrypted), the table rekey iterates (SEALED_COLUMNS in lib/rekey-ops.ts) and the code that seals (encryptSecret). */

const WEB = path.join(import.meta.dirname, "..");

/** Every "Model.column" the schema documents as encrypted: a `///` comment on the lines just before a field that says so. */
function documentedAsEncrypted(schema = readFileSync(path.join(WEB, "prisma", "schema.prisma"), "utf8")): string[] {
  const out: string[] = [];
  let model = "";
  let comment: string[] = [];
  for (const line of schema.split(/\r?\n/)) {
    const opens = /^model\s+(\w+)\s*\{/.exec(line);
    if (opens) {
      model = opens[1]!;
      comment = [];
      continue;
    }
    if (/^\}/.test(line)) {
      model = "";
      comment = [];
      continue;
    }
    if (!model) continue;
    if (/^\s*\/\/\//.test(line)) {
      comment.push(line);
      continue;
    }
    const field = /^\s+(\w+)\s+\S+/.exec(line);
    if (field && comment.some((c) => /\bencrypted\b/i.test(c))) out.push(`${model}.${field[1]}`);
    comment = [];
  }
  return out.sort();
}

/** The keys of SEALED_COLUMNS, read from the source: the module is server-only and cannot be loaded here. */
function inTheTable(): string[] {
  const source = readFileSync(path.join(WEB, "src", "lib", "rekey-ops.ts"), "utf8");
  const body = /export const SEALED_COLUMNS = \{([\s\S]*?)\} as const;/.exec(source)?.[1] ?? "";
  return [...body.matchAll(/^\s*"(\w+\.\w+)":/gm)].map((m) => m[1]!).sort();
}

test("every column the schema says is encrypted is one rekey seals again, and the other way round", () => {
  assert.deepEqual(inTheTable(), documentedAsEncrypted());
});

test("a throw-away encrypted column is found, so the guard above fails on it", () => {
  const schema = readFileSync(path.join(WEB, "prisma", "schema.prisma"), "utf8").replace(
    "model Node {",
    "model Node {\n  /// Encrypted; see lib/secrets.ts. A throw-away.\n  scratchToken String?",
  );
  const found = documentedAsEncrypted(schema);
  assert.ok(found.includes("Node.scratchToken"), found.join(", "));
  assert.notDeepEqual(inTheTable(), found);
});

test("a new place that seals a secret is a place somebody has looked at rekey for", () => {
  // File -> how many encryptSecret( calls it has: each writes one of the columns in the table. A new call, or a new file, fails here
  // until its column is in SEALED_COLUMNS (and its loader), and this list says so.
  const known: Record<string, number> = {
    "account-ops.ts": 1, // User.totpSecret
    "dns-ops.ts": 2, // DnsProvider.token, DnsProvider.endpoint
    "node-ops.ts": 2, // Node.daemonToken, twice (registration, rotation)
    "notify/channel-ops.ts": 3, // NotificationChannel.url, .signingSecret, and the signing key's rotation
    "steam-ops.ts": 1, // WorkshopKey.apiKey
    "storage-ops.ts": 1, // BackupStorage.secretAccessKey
  };
  const lib = path.join(WEB, "src", "lib");
  const found: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.tsx?$/.test(name) && name !== "secrets.ts") {
        const n = (readFileSync(file, "utf8").match(/\bencryptSecret\(/g) ?? []).length;
        if (n > 0) found[path.relative(lib, file).replaceAll("\\", "/")] = n;
      }
    }
  };
  walk(lib);
  // rekey-ops.ts names the function in a comment only.
  delete found["rekey-ops.ts"];
  assert.deepEqual(found, known, "a call to encryptSecret( that is not here writes a column rekey may not know: add it to SEALED_COLUMNS in lib/rekey-ops.ts, give it a loader, then add the call here");
});
