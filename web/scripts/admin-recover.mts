import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";

/* npm run admin:recover [-- --email owner@example.com] [--yes]

   The way back into an owner account, from a terminal on the panel's own
   machine — for a temporary password that was lost or ran out, a password
   forgotten, or a phone and its recovery codes both gone.

   Being able to run this is the proof of being the administrator:
   whoever can run a command as the panel against its database already has
   everything the panel protects. There is no web equivalent, by design.

   It makes a new temporary password (shown once, good for a day), removes
   two-factor from the account, ends every session it has, and writes
   `installation.owner.recovered` to the audit log — so a recovery nobody
   expected is something the other owners can see. */

if (existsSync(path.join(process.cwd(), ".env"))) process.loadEnvFile(path.join(process.cwd(), ".env"));

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const { db } = await import("../src/lib/db");
const { recoverOwnerOp } = await import("../src/lib/setup-ops");

const email = argument("email");
if (!process.argv.includes("--yes")) {
  if (!process.stdin.isTTY) {
    console.error("This ends the owner's sessions and removes their two-factor. Say so with --yes to run it unattended.");
    process.exit(2);
  }
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await ask.question(
    `This gives ${email ?? "the owner"} a new temporary password, removes two-factor from the account and signs it out everywhere.\nType "recover" to go on: `,
  );
  ask.close();
  if (answer.trim().toLowerCase() !== "recover") {
    console.log("Nothing was changed.");
    await db.$disconnect();
    process.exit(0);
  }
}

const result = await recoverOwnerOp({ email });
await db.$disconnect();

if (!result.ok) {
  console.error(result.reason);
  process.exit(3);
}

console.log(`
  ${result.name} <${result.email}> has a new temporary password.

  Temporary password:   ${result.password}

  Shown this once; stored only as a hash. It works until ${result.expiresAt.toISOString().replace("T", " ").slice(0, 16)} UTC.
  Two-factor was removed and every session ended. After signing in, the
  panel asks for a password of your own and then for two-factor again.
  This recovery is in the audit log.
`);
