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

// Every image a build or the stack starts that is somebody else's is named by its digest, not by a tag that moves. Dependabot (docker,
// docker-compose) proposes the new digest and a person reads it; a tag that moved under a release is how the same commit builds two images.
for (const file of tracked.filter((f) => /(^|\/)Dockerfile$/.test(f) || /docker-compose\.ya?ml$/.test(f))) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split(/\r?\n/).forEach((line, i) => {
    const from = /^FROM\s+(?:--platform=\S+\s+)?(\S+)/.exec(line)?.[1];
    const image = from ?? /^\s+image:\s*(\S+)/.exec(line)?.[1];
    if (!image || image.includes("${") || /^[a-z][\w-]*$/.test(image) /* a build stage's name, as in FROM build */) return;
    if (!image.includes("@sha256:")) problems.push(`${file}:${i + 1}: ${image} is not pinned by digest (name@sha256:…); a tag can move under a release.`);
  });
}
// `writer | grep -q x` in a script that runs under pipefail. grep -q leaves at the first match, a writer that still has something to say
// dies of SIGPIPE, and the pipeline reports failure for a line that was found: on a Debian 13 VPS `systemctl list-unit-files caddy.service |
// grep -q` told the installer that Caddy had no unit and it never reloaded it. `writer | grep_in -q x` (deploy/lib/common.sh) reads it all
// first. A writer that cannot be cut off — one line of a file, a printf of a variable — may stay, and says so with `# pipe-ok`.
const QUIET_GREP = /\|\s*grep\s+-[A-Za-z]*q/;
const CANNOT_BE_CUT_OFF = [/head -n 1 [^|]*\|\s*grep/, /printf '%s' [^|]*\|\s*grep/, /# pipe-ok/];
for (const file of tracked.filter((f) => /\.sh$/.test(f))) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*#/.test(line) || !QUIET_GREP.test(line) || CANNOT_BE_CUT_OFF.some((re) => re.test(line))) return;
    problems.push(`${file}:${i + 1}: a pipe into grep -q; under pipefail the writer can die of SIGPIPE and the match is reported as a failure. Use grep_in -q (deploy/lib/common.sh).`);
  });
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log(`ok: ${tracked.length} tracked files; no raw NUL in a text source, every shell script executable, every PowerShell script with its byte-order mark`);
