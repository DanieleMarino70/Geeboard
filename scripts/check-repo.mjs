// What the repository must be before anything is built from it. Run by CI (the "Installers and repository" job) and by hand:
//
//   node scripts/check-repo.mjs
//
// A raw NUL in a source file makes git treat it as binary: `git diff` stops showing it, `git grep` prints "Binary file matches"
// and ripgrep skips what follows it. daemon/src/provision.ts had one for several releases, inside the regex that keeps control
// characters out of a container's environment, and every review of that file was blind. Nothing text should hold one.
//
// And two things a checkout carries to the machines it is installed on:
//
// - Every shell script is recorded executable (mode 100755). All of them were 100644, so the installer's own chmod made a clone
//   "modified" and the next `git pull` or `git checkout vX` refused over every script that had changed in between — which is
//   where an upgrade from an older release fell over first.
// - Every PowerShell script starts with a UTF-8 byte-order mark. Windows PowerShell 5.1 reads one without as ANSI, and the first
//   non-ASCII character in a message turns into something else on the first machine it runs on.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const SOURCE = /\.(ts|tsx|mts|mjs|js|json|md|yml|yaml|sh|ps1|css|html|service|tmpl|caddyfile|conf|toml|sql|prisma|txt|env\.example)$|(^|\/)(Dockerfile|Caddyfile|\.gitignore|\.gitattributes|\.nvmrc)$/i;

const tracked = execFileSync("git", ["ls-files", "-z"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean);
const problems = [];

// "100755 <hash> 0\t<path>", one per file, as the index records them rather than as this machine's file system shows them.
const modes = new Map();
for (const entry of execFileSync("git", ["ls-files", "-s", "-z"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean)) {
  const [meta, file] = entry.split("\t");
  modes.set(file, meta.split(" ")[0]);
}

for (const file of tracked) {
  if (!SOURCE.test(file)) continue;
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    continue; // listed and not on disk: a sparse checkout, not this check's business
  }
  if (file.endsWith(".sh") && modes.get(file) !== "100755") {
    problems.push(`${file}: recorded as mode ${modes.get(file)}, not 100755. git update-index --chmod=+x ${file}`);
  }
  if (file.endsWith(".ps1") && !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
    problems.push(`${file}: no UTF-8 byte-order mark at the start; Windows PowerShell 5.1 would read it as ANSI.`);
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
console.log(`ok: ${tracked.length} tracked files; no raw NUL in a text source, every shell script executable, every PowerShell script with its byte-order mark`);
