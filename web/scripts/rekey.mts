import "./load-env.mts";
import process from "node:process";

/* npm run rekey -- [--dry-run]        docker compose run --rm -e SECRETS_KEY_NEW panel rekey [--dry-run]

   Changes the key the panel encrypts its stored secrets with — node tokens,
   the off-site bucket's key, the Steam key, a DNS provider's token, every
   account's two-factor secret — without registering the nodes again. See
   lib/rekey-ops.ts for what it will and will not do.

   The current key is what the environment already holds: SECRETS_KEY, or
   SESSION_SECRET where that was never set. The new one is SECRETS_KEY_NEW, and
   both come from the environment and never from the command line, where they
   would sit in the process list and the shell's history. Nothing here prints a
   key. With --dry-run it reads and checks everything and writes nothing.

   Stop the panel and the poller first, as for a migration. When it has
   finished, put the new key in SECRETS_KEY and start them again: until then the
   panel cannot read what was just sealed.

   Running this is the proof of being the administrator, the same rule `setup`
   and `recover` follow. Everything said to a person goes to stderr. */

const dryRun = process.argv.includes("--dry-run");
const unknown = process.argv.slice(2).filter((arg) => arg !== "--dry-run");
if (unknown.length > 0) {
  console.error(`Unknown option ${unknown[0]}. Usage: npm run rekey -- [--dry-run]. The new key is SECRETS_KEY_NEW, from the environment.`);
  process.exit(2);
}
if (!process.env.SECRETS_KEY_NEW) {
  console.error(
    "Set SECRETS_KEY_NEW to the new key — `openssl rand -hex 32` makes one — and keep it: it is what SECRETS_KEY becomes.\n" +
      "It is read from the environment and not from the command line, so it stays out of the shell's history.\n" +
      "Under sudo it has to be passed on: `sudo --preserve-env=SECRETS_KEY_NEW docker compose run --rm -e SECRETS_KEY_NEW panel rekey` (sudo-rs, Ubuntu 25.10 and later, ignores `sudo -E`).",
  );
  process.exit(2);
}

const { db } = await import("../src/lib/db");
const { rekeyOp } = await import("../src/lib/rekey-ops");

const usingFallback = !process.env.SECRETS_KEY;
const report = await rekeyOp({
  currentKey: process.env.SECRETS_KEY ?? process.env.SESSION_SECRET,
  newKey: process.env.SECRETS_KEY_NEW,
  sessionSecret: process.env.SESSION_SECRET,
  dryRun,
});
await db.$disconnect();

if (!report.ok) {
  console.error(`\n  ${report.problem}\n`);
  process.exit(3);
}

const total = report.counts.reduce((sum, c) => sum + c.values, 0);
const lines = report.counts.filter((c) => c.values > 0).map((c) => `    ${String(c.values).padStart(4)}  ${c.kind}`);
console.error(
  `\n  ${dryRun ? "Would seal again" : "Sealed again"} ${total} stored secret${total === 1 ? "" : "s"} with the new key:\n${lines.join("\n") || "    none: there is nothing stored to re-encrypt."}\n`,
);
if (dryRun) {
  console.error("  Nothing was written. Run it again without --dry-run to do it.\n");
} else {
  console.error(
    `  Now set SECRETS_KEY to the value you passed as SECRETS_KEY_NEW${usingFallback ? " — it was never set here, and SESSION_SECRET stood in for it —" : ""}, and start the panel and the poller.\n` +
      "  Until you do, the panel cannot read what was just re-encrypted. The nodes need nothing: their own tokens were not touched.\n",
  );
}
