// `npm audit` for the production dependencies of each package, minus the advisories somebody has read and written down.
//
//   node scripts/audit-gate.mjs web daemon docs-src            fails on any advisory at "high" or above that is not allowed
//   node scripts/audit-gate.mjs --level moderate web
//
// The allow list is .github/audit-allow.json: `{ "id": "GHSA-…", "package": "…", "reason": "…" }`. An entry that no longer
// matches anything is reported, so the list can only shrink. `npm audit fix --force` is not the answer for those entries: for the
// Prisma CLI's own tree npm's suggested fix is a downgrade across a major version.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);
const levelAt = args.indexOf("--level");
const level = levelAt >= 0 ? args.splice(levelAt, 2)[1] : "high";
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
if (!(level in RANK)) throw new Error(`--level is one of ${Object.keys(RANK).join(", ")}`);
const dirs = args.length > 0 ? args : ["web", "daemon", "docs-src"];

const allowFile = ".github/audit-allow.json";
const allowed = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, "utf8")) : [];
const used = new Set();

function audit(dir) {
  // npm exits non-zero when it finds anything, and still prints the JSON.
  let out;
  try {
    out = execFileSync("npm", ["audit", "--omit=dev", "--json"], { cwd: dir, shell: process.platform === "win32", maxBuffer: 32 * 1024 * 1024 }).toString("utf8");
  } catch (error) {
    out = error.stdout?.toString("utf8") ?? "";
    if (!out) throw error;
  }
  return JSON.parse(out);
}

let failed = 0;
for (const dir of dirs) {
  const report = audit(dir);
  const found = new Map();
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via) {
      if (typeof via === "string") continue;
      const id = /GHSA-[a-z0-9-]+/i.exec(via.url ?? "")?.[0] ?? String(via.source);
      found.set(id, { id, package: via.name ?? name, severity: via.severity, title: via.title });
    }
  }
  const open = [];
  for (const advisory of found.values()) {
    const entry = allowed.find((a) => a.id === advisory.id);
    if (entry) {
      used.add(entry.id);
      continue;
    }
    if (RANK[advisory.severity] >= RANK[level]) open.push(advisory);
  }
  console.log(`${dir}: ${found.size} advisories, ${open.length} at ${level} or above and not allowed`);
  for (const a of open) console.log(`  ${a.severity.padEnd(8)} ${a.id}  ${a.package}  ${a.title}`);
  failed += open.length;
}

for (const entry of allowed) {
  if (!used.has(entry.id)) console.log(`allow list: ${entry.id} (${entry.package}) matches nothing now; remove it`);
}
process.exit(failed > 0 ? 1 : 0);
