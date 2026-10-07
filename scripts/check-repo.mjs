// What the repository must be before anything is built from it. Run by CI (the "Installers and repository" job) and by hand:
//
//   node scripts/check-repo.mjs
//
// A raw NUL in a source file makes git treat it as binary: `git diff` stops showing it, `git grep` prints "Binary file matches"
// and ripgrep skips what follows it. daemon/src/provision.ts had one for several releases, inside the regex that keeps control
// characters out of a container's environment, and every review of that file was blind. Nothing text should hold one.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const SOURCE = /\.(ts|tsx|mts|mjs|js|json|md|yml|yaml|sh|ps1|css|html|service|tmpl|caddyfile|conf|toml|sql|prisma|txt|env\.example)$|(^|\/)(Dockerfile|Caddyfile|\.gitignore|\.gitattributes|\.nvmrc)$/i;

const tracked = execFileSync("git", ["ls-files", "-z"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean);
const problems = [];

for (const file of tracked) {
  if (!SOURCE.test(file)) continue;
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    continue; // listed and not on disk: a sparse checkout, not this check's business
  }
  const at = bytes.indexOf(0);
  if (at >= 0) {
    const line = bytes.subarray(0, at).toString("latin1").split("\n").length;
    problems.push(`${file}:${line}: a raw NUL byte in a text file. Write it as \\x00 (or \\0) in the source.`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log(`ok: ${tracked.length} tracked files, no raw NUL in any text source`);
