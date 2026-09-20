import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { checkEnvironment } from "../src/lib/env-check.ts";

/* npm run setup:env [-- --database-url <url>] [--panel-url <url>]

   Writes web/.env from .env.example with two generated secrets, once.

   It never overwrites. A .env that exists holds the key every stored
   node token is encrypted under, and a helpful script that regenerated it
   would cut a running panel off from every machine it manages. Given one
   that exists, this says what is wrong with it, if anything, and changes
   nothing.

   The secrets are made here, by the machine that will use them, and are
   written to the file and nowhere else: they are not printed. */

const root = process.cwd();
const target = path.join(root, ".env");
const example = path.join(root, ".env.example");

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (match) out[match[1]!] = match[2]!;
  }
  return out;
}

if (!existsSync(example)) {
  console.error("Run this in web/: there is no .env.example here.");
  process.exit(2);
}

if (existsSync(target)) {
  const report = checkEnvironment({ ...parse(readFileSync(target, "utf8")), NODE_ENV: process.env.NODE_ENV });
  console.log(`${target} already exists, and was not changed.`);
  for (const problem of report.problems) console.log(`  problem: ${problem}`);
  for (const warning of report.warnings) console.log(`  note:    ${warning}`);
  if (report.problems.length === 0) console.log("  Nothing wrong with it.");
  else {
    console.log(
      "\n  To fix a secret by hand, put 32 or more random characters in it — for example the output of\n" +
        '    node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"\n' +
        "  Changing SECRETS_KEY on a panel that already has nodes makes their stored tokens, and the\n" +
        "  off-site bucket's keys, undecryptable: the nodes have to be registered again and the bucket\n" +
        "  configured again. SESSION_SECRET can be changed freely; everybody is signed out.",
    );
  }
  process.exit(report.problems.length === 0 ? 0 : 1);
}

const secret = () => randomBytes(32).toString("base64");
let text = readFileSync(example, "utf8")
  .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET="${secret()}"`)
  .replace(/^SECRETS_KEY=.*$/m, `SECRETS_KEY="${secret()}"`);

const databaseUrl = argument("database-url");
if (databaseUrl) text = text.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${databaseUrl}"`);
const panelUrl = argument("panel-url");
if (panelUrl) text = text.replace(/^# PANEL_URL=.*$/m, `PANEL_URL="${panelUrl}"`);

// Readable by this account alone, where the file system has such a thing.
writeFileSync(target, text, { mode: 0o600 });
console.log(`Wrote ${target} with a generated SESSION_SECRET and SECRETS_KEY. They were not printed.`);
if (!databaseUrl) console.log("DATABASE_URL is the development database's. For production, edit it or pass --database-url.");
console.log("Next: npm run setup");
