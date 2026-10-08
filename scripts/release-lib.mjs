// What a release has to leave true, as functions of a checkout, and the one thing that makes it true by hand: the version bump.
//
// A cut edits about eight files by hand, and nothing held them to each other: the tag was compared with two package.json files
// and nothing else, so a lock file, a line of the docs or a CHANGELOG heading could say another version and the first symptom
// was somebody following a stale tag. This module is those checks, and `bump`, which writes them instead of a person. It reads
// files and nothing else — no git, no network, no dependency — so a unit test can run it on a copy of a tree in a temporary
// directory, and scripts/cut.mjs adds what needs git and the network.
//
//   consistency(root)   the problems with this tree, each naming the file
//   bump(root, version) rewrites what is mechanical; the prose is for a person
//   pinMigrations(root) the hashes of the migrations a release ships (web/test/migrations-pinned.json)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SLUG = "DanieleMarino70/Geeboard";
export const IMAGE_OWNER = "danielemarino70";
export const IMAGES = ["geeboard-panel", "geeboard-agent"];
/* The branch a person installs from: always a released checkout, moved by the Release workflow after the images exist, so that a
   failed release moves nothing and `git pull` is an upgrade to the last release and never to work in progress. */
export const STABLE = "stable";

/* What a person decides at a cut, and nothing a script could: whether this release should be taken soon, and below which versions a security
   problem is known (the panel's, and separately the agent's, because an agent is upgraded on its own machine and not every release needs it). It
   is a file in the repository so that the decision is reviewed like the code it is about, and it becomes release.json, the one small file that
   every panel reads now and then to learn that a newer release exists (web/src/domain/updates/release.ts, docs/upgrading.md). A floor is the
   lowest version WITHOUT the problem, so it is never above the release being cut. */
export const POLICY_FILE = "release-policy.json";
const POLICY_KEYS = ["recommended", "securityFloor", "agentFloor", "agentSecurityFloor", "summary"];
const PLAIN = /^\d+\.\d+\.\d+$/;
const order = (a, b) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

export function readPolicy(root) {
  return JSON.parse(read(root, POLICY_FILE));
}

/** What is wrong with a policy, as sentences, for a release of this version. */
export function policyProblems(policy, version) {
  const problems = [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return [`${POLICY_FILE} is not a JSON object`];
  for (const key of Object.keys(policy)) if (!POLICY_KEYS.includes(key)) problems.push(`${POLICY_FILE} has "${key}", which nothing reads`);
  if (typeof policy.recommended !== "boolean") problems.push(`${POLICY_FILE}: "recommended" is true or false`);
  for (const key of ["securityFloor", "agentFloor", "agentSecurityFloor"]) {
    const value = policy[key];
    if (value === null) continue;
    if (typeof value !== "string" || !PLAIN.test(value)) problems.push(`${POLICY_FILE}: "${key}" is major.minor.patch, or null for none`);
    else if (PLAIN.test(version) && order(value, version) > 0) problems.push(`${POLICY_FILE}: "${key}" is ${value}, above the release itself (${version}): it would call every release, this one included, a problem`);
  }
  if (policy.summary !== null && (typeof policy.summary !== "string" || policy.summary.length > 300 || /[\r\n]/.test(policy.summary))) {
    problems.push(`${POLICY_FILE}: "summary" is one line of at most 300 characters, or null`);
  }
  return problems;
}

/** release.json: the file every release carries as an asset. The schema is web/src/domain/updates/release.ts's, and a unit test reads one with the other. */
export function releaseJson(root) {
  const version = versions(root).web;
  if (!PLAIN.test(version)) throw new Error(`${version} is a pre-release: it carries no release.json, because "latest" is never one`);
  const top = sections(root).sections.find((s) => s.name === version);
  if (!top?.date) throw new Error(`CHANGELOG.md has no dated section for ${version}`);
  const policy = readPolicy(root);
  return {
    schema: 1,
    version,
    date: top.date,
    url: `https://github.com/${SLUG}/releases/tag/v${version}`,
    changelog: `https://github.com/${SLUG}/blob/v${version}/CHANGELOG.md`,
    recommended: policy.recommended === true,
    securityFloor: policy.securityFloor ?? null,
    agentFloor: policy.agentFloor ?? null,
    agentSecurityFloor: policy.agentSecurityFloor ?? null,
    summary: policy.summary ?? null,
  };
}

const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;
const lf = (text) => text.split("\r\n").join("\n");

function raw(root, file) {
  return readFileSync(path.join(root, file), "utf8");
}
const read = (root, file) => lf(raw(root, file));

/* A file rewritten with the line endings it had: a checkout on Windows may hold CRLF and git will normalise it, but a tool should not
   be the thing that changes every line of a file to change one. */
function edit(root, file, change) {
  const before = raw(root, file);
  const crlf = before.includes("\r\n");
  const text = lf(before);
  const after = change(text);
  if (after === text) return false;
  writeFileSync(path.join(root, file), crlf ? after.split("\n").join("\r\n") : after);
  return true;
}

/** The pages whose version literals a cut owns: everything a person follows, and not the history of what was released. */
export function docFiles(root) {
  const docs = readdirSync(path.join(root, "docs"))
    .filter((name) => name.endsWith(".md") && name !== "roadmap.md")
    .map((name) => `docs/${name}`);
  return [...docs, "README.md"].filter((file) => existsSync(path.join(root, file)));
}

/** Every version literal in a page: an image tag, a checkout of a tag, a clone of one. */
const LITERALS = [
  new RegExp(String.raw`(geeboard-(?:panel|agent):)(${VERSION})`, "g"),
  new RegExp(String.raw`(git checkout v)(${VERSION})`, "g"),
  new RegExp(String.raw`(--branch v)(${VERSION})`, "g"),
];

export function versions(root) {
  const json = (file) => JSON.parse(read(root, file));
  const lock = (file) => {
    const parsed = json(file);
    return { top: parsed.version, root: parsed.packages?.[""]?.version };
  };
  return {
    web: json("web/package.json").version,
    daemon: json("daemon/package.json").version,
    webLock: lock("web/package-lock.json"),
    daemonLock: lock("daemon/package-lock.json"),
  };
}

/** The changelog's sections, in the order they are written: heading, version (or "Unreleased"), date, text. */
export function sections(root) {
  const text = read(root, "CHANGELOG.md");
  const out = [];
  const lines = text.split("\n");
  let current = null;
  for (const line of lines) {
    const heading = /^## \[([^\]]+)\](?: — (.*))?$/.exec(line);
    if (heading) {
      current = { name: heading[1], tail: heading[2] ?? "", date: /^\d{4}-\d{2}-\d{2}$/.test(heading[2] ?? "") ? heading[2] : null, body: [] };
      out.push(current);
    } else if (current) current.body.push(line);
  }
  for (const section of out) section.body = section.body.join("\n");
  const definitions = new Map([...text.matchAll(/^\[([^\]]+)\]: (\S+)$/gm)].map((m) => [m[1], m[2]]));
  return { sections: out, definitions };
}

const constant = (root, file, name) => {
  const match = new RegExp(String.raw`export const ${name}\s*=\s*(\d+)`).exec(read(root, file));
  return match ? Number(match[1]) : null;
};

/** One entry per thing that is not true: the file, and what it says against what it should. */
export function consistency(root) {
  const problems = [];
  const bad = (file, message) => problems.push({ file, message });

  const v = versions(root);
  const version = v.web;
  if (v.daemon !== version) bad("daemon/package.json", `says ${v.daemon}, and web/package.json says ${version}: a release tags the panel and the agent together`);
  for (const [file, lock] of [["web/package-lock.json", v.webLock], ["daemon/package-lock.json", v.daemonLock]]) {
    if (lock.top !== version) bad(file, `its version is ${lock.top}, and the package says ${version}`);
    if (lock.root !== version) bad(file, `packages[""].version is ${lock.root}, and the package says ${version}`);
  }

  if (!existsSync(path.join(root, POLICY_FILE))) bad(POLICY_FILE, "is missing: every release says whether it is recommended and what its floors are, even if the answer is none");
  else {
    try {
      for (const message of policyProblems(readPolicy(root), version)) bad(POLICY_FILE, message);
    } catch (error) {
      bad(POLICY_FILE, `is not JSON: ${error.message}`);
    }
  }

  // The pages a person follows say the version that exists: an image that was never built, or a tag that is not there, is a failed install.
  for (const file of docFiles(root)) {
    const text = read(root, file);
    for (const pattern of LITERALS) {
      for (const match of text.matchAll(pattern)) {
        if (match[2] !== version) bad(file, `names ${match[1]}${match[2]} and the release is ${version}`);
      }
    }
    for (const line of text.split("\n")) {
      if (line.includes(`github.com/${SLUG}.git`) && /git clone\b/.test(line) && !new RegExp(String.raw`--branch (?:${STABLE}|v${version.replace(/\./g, "\\.")})\b`).test(line)) {
        bad(file, `clones the default branch, which is ahead of the last release: git clone --branch ${STABLE} (${line.trim().slice(0, 80)})`);
      }
    }
  }

  const { sections: changelog, definitions } = sections(root);
  const top = changelog[0];
  if (!top) bad("CHANGELOG.md", "has no sections");
  else {
    const released = top.name !== "Unreleased";
    if (released && top.name !== version) bad("CHANGELOG.md", `its first section is ${top.name} and the release is ${version}`);
    if (!released) {
      // While a release is being made the package still names the last one, and the section that collects it is the next.
      const last = changelog.find((s) => s.name !== "Unreleased");
      if (last && last.name !== version) bad("CHANGELOG.md", `the section below Unreleased is ${last.name} and the package says ${version}`);
    }
    if (released) {
      if (!top.date) bad("CHANGELOG.md", `${top.name} has no date after its heading ("## [${top.name}] — YYYY-MM-DD")`);
      const below = changelog.find((s, i) => i > 0 && s.date);
      if (top.date && below?.date && top.date < below.date) bad("CHANGELOG.md", `${top.name} is dated ${top.date}, before ${below.name}, ${below.date}`);
      if (/^\*Work in progress/m.test(top.body)) bad("CHANGELOG.md", `${top.name} still says it is work in progress: rewrite the section as the story of the release`);
    }
    const contract = /Agent contract: (\d+)/.exec(top.body)?.[1];
    const panel = constant(root, "web/src/domain/nodes/agent-version.ts", "PANEL_CONTRACT");
    const agent = constant(root, "daemon/src/contract.ts", "AGENT_CONTRACT");
    if (!contract) bad("CHANGELOG.md", `${top.name} does not say "Agent contract: N", which is what somebody upgrading reads first`);
    else if (Number(contract) !== panel || Number(contract) !== agent) bad("CHANGELOG.md", `${top.name} says contract ${contract}; the panel's is ${panel} and the agent's is ${agent}`);
  }
  for (const section of changelog) {
    if (!definitions.has(section.name)) bad("CHANGELOG.md", `## [${section.name}] has no "[${section.name}]: …" line at the foot, so its heading is not a link`);
  }
  for (const name of definitions.keys()) {
    if (!changelog.some((s) => s.name === name)) bad("CHANGELOG.md", `"[${name}]: …" at the foot has no heading`);
  }

  // What somebody upgrading from the release before is told, and where the roadmap says what it was.
  if (!changelog[0] || changelog[0].name !== "Unreleased") {
    const [major, minor, patch] = version.split(/[.-]/).map(Number);
    if (patch === 0 && minor > 0) {
      const from = new RegExp(String.raw`\*\*From ${major}\.${minor - 1} to ${major}\.${minor}[,.]`);
      if (!from.test(read(root, "docs/upgrading.md"))) bad("docs/upgrading.md", `has no "**From ${major}.${minor - 1} to ${major}.${minor}" paragraph, which says whether the agents need upgrading`);
      if (!new RegExp(String.raw`^#{2,3} .*\(${major}\.${minor}\.0\)`, "m").test(read(root, "docs/roadmap.md"))) bad("docs/roadmap.md", `has no heading ending (${major}.${minor}.0), which is where the release is explained`);
    }
  }
  return problems;
}

/** The hash of each migration as a release ships it: the text with its line endings made one, as web/test/migrations.test.ts hashes it. */
export function pinMigrations(root) {
  const dir = path.join(root, "web", "prisma", "migrations");
  const pinned = {};
  for (const name of readdirSync(dir).sort()) {
    if (!statSync(path.join(dir, name)).isDirectory()) continue;
    pinned[name] = createHash("sha256").update(lf(readFileSync(path.join(dir, name, "migration.sql"), "utf8"))).digest("hex");
  }
  return pinned;
}

const REPO_URL = `https://github.com/${SLUG}`;

/**
 * What is mechanical in a cut, written. The package versions, the two lock files' two version fields each, every literal in the pages
 * a person follows, the CHANGELOG's heading, date and link, and the pins of the migrations this release ships. What is not: the prose of
 * the section, the "From X to Y" paragraph and the roadmap's entry, which `consistency` then asks for.
 *
 * Not through `npm version`: npm on Windows is known to rewrite and prune lock entries that only `npm ci` on Linux notices.
 */
export function bump(root, version, { date = new Date().toISOString().slice(0, 10) } = {}) {
  if (!new RegExp(`^${VERSION}$`).test(version)) throw new Error(`"${version}" is not a version (1.2.3, or 1.2.3-rc.1)`);
  const changed = [];
  const did = (file, yes) => yes && changed.push(file);

  for (const file of ["web/package.json", "daemon/package.json"]) {
    did(file, edit(root, file, (text) => text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`)));
  }
  for (const file of ["web/package-lock.json", "daemon/package-lock.json"]) {
    did(
      file,
      edit(root, file, (text) =>
        // The first "version" after the package's name, at the top and under packages[""]: two fields, and no dependency's.
        text.replace(/^(\{\n {2}"name": "[^"]+",\n {2}"version": ")[^"]+(")/, `$1${version}$2`).replace(/^( {4}"": \{\n {6}"name": "[^"]+",\n {6}"version": ")[^"]+(")/m, `$1${version}$2`),
      ),
    );
  }
  for (const file of docFiles(root)) {
    did(file, edit(root, file, (text) => LITERALS.reduce((acc, pattern) => acc.replace(pattern, `$1${version}`), text)));
  }

  did(
    "CHANGELOG.md",
    edit(root, "CHANGELOG.md", (text) => {
      let next = text;
      const heading = /^## \[Unreleased\](?: — (\S+))?$/m.exec(next);
      if (heading) {
        if (heading[1] && heading[1] !== version) throw new Error(`CHANGELOG.md collects ${heading[1]} under Unreleased, and this is ${version}: rename the heading, or cut ${heading[1]}`);
        // The section that collected the release becomes it. Its italic line says it is a draft; consistency refuses a release that keeps it.
        next = next.replace(heading[0], `## [${version}] — ${date}`).replace(/^\[Unreleased\]: .*\n/m, "");
      } else if (!new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m").test(next)) {
        const first = /^## \[/m.exec(next);
        const contract = constant(root, "daemon/src/contract.ts", "AGENT_CONTRACT");
        const skeleton = `## [${version}] — ${date}\n\n**Agent contract: ${contract}, unchanged.**\n\n`;
        next = first ? next.slice(0, first.index) + skeleton + next.slice(first.index) : next + skeleton;
      }
      if (!new RegExp(`^\\[${version.replace(/\./g, "\\.")}\\]: `, "m").test(next)) {
        const definition = `[${version}]: ${REPO_URL}/releases/tag/v${version}\n`;
        const firstDefinition = /^\[[^\]]+\]: \S+$/m.exec(next);
        next = firstDefinition ? next.slice(0, firstDefinition.index) + definition + next.slice(firstDefinition.index) : `${next.replace(/\n*$/, "\n")}\n${definition}`;
      }
      return next;
    }),
  );

  const pins = path.join(root, "web", "test", "migrations-pinned.json");
  const pinned = `${JSON.stringify({ release: `v${version}`, migrations: pinMigrations(root) }, null, 2)}\n`;
  if (!existsSync(pins) || lf(readFileSync(pins, "utf8")) !== pinned) {
    writeFileSync(pins, pinned);
    changed.push("web/test/migrations-pinned.json");
  }
  return changed;
}
