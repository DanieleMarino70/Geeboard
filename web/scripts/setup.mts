import "./load-env.mts";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createInterface } from "node:readline/promises";

/* npm run setup [-- --email you@example.com --name "Your Name"]

   The first installation of a panel, from a terminal on its own machine:

     the environment   checked, and refused if a secret is missing or an example
     the schema        prisma migrate deploy — never migrate dev, which may reset
     the catalog       written from the game definitions, with no network
     the first owner   one account, with a temporary password shown once

   It makes the first owner and is not a way to make a second: run on an
   installation that already has an account, it refuses, and says which
   command gets an owner back in. An upgrade does not need it — that is
   `npm run db:deploy`, which applies migrations and nothing else.

   There is no web page that does this. On a VPS the first visitor to a
   new port is as often a scanner as the installer, and a first-run form
   hands the panel to whoever arrives first. */


const { checkEnvironment } = await import("../src/lib/env-check.ts");
const report = checkEnvironment(process.env);
if (report.problems.length > 0) {
  console.error("The environment is not ready:");
  for (const problem of report.problems) console.error(`  ${problem}`);
  console.error("\n`npm run setup:env` writes a .env with generated secrets, if there is none yet.");
  process.exit(1);
}
for (const warning of report.warnings) console.warn(`note: ${warning}`);

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

console.log("== schema ==");
// npx is a .cmd on Windows and needs a shell there; the command line is fixed, so there is nothing to escape.
const migrated =
  process.platform === "win32"
    ? spawnSync("npx.cmd prisma migrate deploy", { stdio: "inherit", shell: true })
    : spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
if (migrated.status !== 0) {
  console.error("\nThe migrations did not apply, so nothing else was done. Is the database reachable at DATABASE_URL?");
  process.exit(1);
}

const { db } = await import("../src/lib/db");
const { syncCatalog } = await import("../src/lib/catalog-sync");
const { createFirstOwnerOp } = await import("../src/lib/setup-ops");

console.log("\n== game catalog ==");
const catalog = await syncCatalog({ offline: true });
console.log(`${catalog.games} games, ${catalog.versions} versions, from the definitions. The poller refreshes them from upstream.`);

console.log("\n== the first owner ==");
let email = argument("email");
let name = argument("name");
if ((!email || !name) && process.stdin.isTTY) {
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  email ??= (await ask.question("Your email, which you will sign in with: ")).trim();
  name ??= (await ask.question("Your name, as the audit log will show it: ")).trim();
  ask.close();
}
if (!email || !name) {
  console.error('Say who the owner is: npm run setup -- --email you@example.com --name "Your Name"');
  await db.$disconnect();
  process.exit(2);
}

const result = await createFirstOwnerOp({ email, name });
await db.$disconnect();

if (!result.ok) {
  console.error(result.reason);
  process.exit(3);
}

/* The way back in, named for the place this is being run.

   It used to say `npm run admin:recover` to everybody, including the
   Docker installation — where there is no checkout, no npm, and the
   command is a verb on the image. The installation walkthrough found it:
   the one line somebody reads when they have lost the password told half
   of them to run something they do not have. */
function recoveryCommand(): string {
  return process.env.GEEBOARD_IN_IMAGE === "1"
    ? "    docker compose -f deploy/panel/docker-compose.yml run --rm panel recover"
    : "    npm run admin:recover";
}

/* To the terminal and nowhere else: not a file, not a log line with a
   timestamp that a log shipper would carry off. It is stored only as a
   hash, so this is the one time it can be read. */
console.log(`
  ${result.name} <${result.email}> is the owner of this installation.

  Temporary password:   ${result.password}

  It is shown this once and is not stored anywhere it can be read back.
  It works until ${result.expiresAt.toISOString().replace("T", " ").slice(0, 16)} UTC — a day. Sign in, and the panel
  will ask for nothing else until you have replaced it with a password of
  your own, and then set up two-factor sign-in.

  Lost it, or the day ran out?
${recoveryCommand()}
`);
