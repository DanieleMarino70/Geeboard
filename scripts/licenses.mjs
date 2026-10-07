// The licenses of what the panel and the agent ship, counted, and refused when one is not on a list a person has read.
//
//   node scripts/licenses.mjs          from the repository root, after `npm ci` in web/ and in daemon/
//
// Geeboard is AGPL-3.0-only, and what it depends on is installed into images other people run. A dependency whose license nobody looked
// at is how a project learns that it ships something it may not: the census reads every package of the production tree (dev tools are
// not shipped) from the lock file and its own package.json, passes the licenses that are permissive, and fails on any other unless it
// is named below with the reason. A new one is a decision, written here, not a surprise in an image.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Permissive, and compatible with AGPL-3.0-only without a word more. */
const PERMISSIVE = new Set(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Unlicense", "CC0-1.0", "BlueOak-1.0.0", "Python-2.0", "WTFPL"]);

/* Everything else that is shipped, and why that is all right. A package matches by name; its license has to be the one written here, so a
   package that changes its license is a failure to look at again. */
const KNOWN = {
  "caniuse-lite": ["CC-BY-4.0", "Browser support data that Next.js reads at build time to decide what to compile; attribution is its only term, and it is in the package."],
  elkjs: ["EPL-2.0", "The Eclipse Layout Kernel, a dependency of Prisma Studio (prisma → @prisma/studio-core), which Geeboard never starts; EPL-2.0 is file-level copyleft, the files are unmodified, and it is allowed beside AGPL."],
  "@visx/vendor": ["MIT and ISC", "Two permissive licenses for the bundled d3 modules."],
  "seq-queue": ["UNKNOWN", "A dependency of mysql2, which Prisma's CLI carries; its package.json names no license and its LICENSE file is the MIT license."],
};
/* sharp's prebuilt libvips binaries are LGPL-3.0-or-later and are linked dynamically, one per platform, optionally; the node binding is Apache-2.0. */
const LGPL_BINARIES = /^@img\/sharp-/;
/* "A OR B" where any one is permissive is permissive (the user may take that one). */
const OR_OF_PERMISSIVE = (license) => /^\(?[\w.\- ]+( OR [\w.\- ]+)+\)?$/.test(license) && license.replace(/[()]/g, "").split(" OR ").some((l) => PERMISSIVE.has(l.trim()));

function licenseOf(info, manifest) {
  if (typeof manifest.license === "string") return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses) && manifest.licenses[0]?.type) return manifest.licenses.map((l) => l.type).join(" AND ");
  return info.license ?? "UNKNOWN";
}

const problems = [];
const rows = [];
for (const pkg of ["web", "daemon"]) {
  const lock = JSON.parse(readFileSync(path.join(root, pkg, "package-lock.json"), "utf8"));
  const counts = new Map();
  let read = 0;
  for (const [location, info] of Object.entries(lock.packages)) {
    if (!location || info.dev) continue;
    const name = location.replace(/^.*node_modules\//, "");
    const file = path.join(root, pkg, location, "package.json");
    // An optional package that was not installed on this platform is not on disk; its license is the lock file's, when it has one.
    const manifest = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    if (existsSync(file)) read++;
    const license = licenseOf(info, manifest);
    counts.set(license, (counts.get(license) ?? 0) + 1);
    if (PERMISSIVE.has(license) || OR_OF_PERMISSIVE(license)) continue;
    if (LGPL_BINARIES.test(name) && /LGPL-3\.0-or-later/.test(license)) continue;
    if (KNOWN[name]?.[0] === license) continue;
    problems.push(`${pkg}: ${name} is ${license}, which is not on the list in scripts/licenses.mjs. Read it, then add it with the reason or remove the dependency.`);
  }
  if (read === 0) problems.push(`${pkg}: no installed packages to read (npm ci in ${pkg}/ first)`);
  rows.push(`${pkg.padEnd(7)} ${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(", ")}`);
}

console.log("Production dependencies by license:");
for (const row of rows) console.log(`  ${row}`);
console.log("Named exceptions:");
for (const [name, [license, why]] of Object.entries(KNOWN)) console.log(`  ${name} (${license}): ${why}`);
console.log("  @img/sharp-*: LGPL-3.0-or-later prebuilt libvips binaries, dynamically linked, optional, one per platform.");
if (problems.length) {
  console.log("");
  for (const line of problems) console.log(`FAIL ${line}`);
  process.exit(1);
}
console.log("\nok: every license is permissive or named above");
