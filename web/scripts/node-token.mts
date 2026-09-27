import "./load-env.mts";
import process from "node:process";

/* npm run node-token -- <node name> [--label "<text>"] [--ttl-hours <n>] [--json]

   A registration token for one node, from a terminal on the panel's own
   machine — what the Add a node dialog mints, for the case where there
   is no browser in the loop: the panel installer asking whether this
   machine should run game servers too, and joining it itself.

   Being able to run this is the proof of being the administrator, the
   same rule `setup` and `recover` follow; the audit log names the
   installer. The token works once, for that name, for a day, and the
   node it registers still lands as PENDING: approval is a person's.

   The secret is the last line on stdout and nothing else is, so a script
   can take it with `tail -n 1`; everything said to a person goes to
   stderr. With --json, stdout is one object instead. */

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const positional = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith("--") && !(all[i - 1] ?? "").match(/^--(label|ttl-hours)$/));
const nodeName = positional[0];
if (!nodeName) {
  console.error('Say which node: npm run node-token -- <node name> [--label "<text>"] [--ttl-hours <n>] [--json]');
  process.exit(2);
}
const ttlRaw = argument("ttl-hours");
const ttlHours = ttlRaw === undefined ? undefined : Number(ttlRaw);
const asJson = process.argv.includes("--json");

const { db } = await import("../src/lib/db");
const { INSTALLER, mintRegistrationToken } = await import("../src/lib/node-ops");

const minted = await mintRegistrationToken({ nodeName, label: argument("label"), ttlHours }, INSTALLER);
await db.$disconnect();

if (!minted.ok) {
  console.error(`${minted.title}: ${minted.body}`);
  process.exit(3);
}

if (asJson) {
  console.log(JSON.stringify({ node: nodeName.trim().toLowerCase(), token: minted.secret, expiresAt: minted.expiresAt, replaces: minted.replaces }));
} else {
  console.error(
    `\n  A registration token for ${nodeName.trim().toLowerCase()}, good until ${minted.expiresAt!.toISOString().replace("T", " ").slice(0, 16)} UTC and for one join.` +
      (minted.replaces ? "\n  A node of that name exists: registering with this replaces its agent and keeps its approval." : "") +
      "\n  Shown this once; stored only as a hash. On the machine:\n" +
      `\n    sudo bash deploy/linux/install.sh <panel address> '${minted.secret}'\n`,
  );
  console.log(minted.secret);
}
