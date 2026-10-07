// Stands in front of the prisma commands that change a database wholesale (`db:reset`, `db:seed`, `db:seed:empty`),
// and says which database `db:migrate` is about to change. Usage: tsx scripts/guard-db.mts <reset|seed|migrate>
import "./load-env.mts";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { databaseOf, judgeDestructive } from "./db-guard.mts";

const what = process.argv[2] ?? "";
const WORDS: Record<string, string> = {
  reset: "drop every table and rebuild the schema",
  seed: "replace its contents with the sample workspace",
  migrate: "apply migrations to",
};
if (!WORDS[what]) {
  console.error(`usage: guard-db.mts <${Object.keys(WORDS).join("|")}>`);
  process.exit(2);
}

const target = databaseOf(process.env.DATABASE_URL);
if (!target) process.exit(0); // nothing named: prisma says what is missing

console.log(`database: ${target.name} on ${target.where}`);
if (what === "migrate") process.exit(0);

const judged = judgeDestructive(process.env.DATABASE_URL);
if (judged.verdict === "run") process.exit(0);

const typed = process.env.GEEBOARD_CONFIRM_DB;
if (typed === judged.target.name) process.exit(0);

if (!process.stdin.isTTY) {
  console.error(
    `refusing to ${WORDS[what]} "${judged.target.name}" on ${judged.target.where} without being told it is meant: ` +
      `this is not a database named for verification. Set GEEBOARD_CONFIRM_DB=${judged.target.name} to go ahead.`,
  );
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`This will ${WORDS[what]} "${judged.target.name}" on ${judged.target.where}. Type its name to continue: `);
rl.close();
if (answer.trim() !== judged.target.name) {
  console.error("Not the name. Nothing was changed.");
  process.exit(1);
}
