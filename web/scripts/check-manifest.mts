import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { DEFAULT_REGISTRIES, normaliseRegistries } from "../src/domain/games/image-ref";
import { MAX_MANIFEST_CHARS, validateManifest, type ManifestResult } from "../src/domain/games/manifest";

/* Checks community-game manifests with the panel's own checker, without a panel.

     npm run manifest:check -- path/to/manifest.json
     npm run manifest:check -- games/                      every manifest.json under it
     npm run manifest:check -- games/ --registries docker.io,ghcr.io,quay.io
     npm run manifest:check -- games/ --json               one JSON array on stdout, for a script
     npm run manifest:check -- games/ --no-probe           skip the timed run of each regular expression

   It is the same function the Community games page calls when a manifest is proposed, with the registries a
   workspace starts with unless --registries says otherwise, so a manifest that passes here passes there — and what
   an owner's own list does not allow is the one thing it cannot know. It checks that a manifest is *well formed and
   safe to put in front of an owner*. It does not check that the image is the one the author means, that the digest
   exists, or that the game runs: that is what the owner reads on the approval page, and what testing is for.

   Exit status: 0 when every manifest passes, 1 when one does not, 2 when it could not be run at all. */

interface Options {
  targets: string[];
  registries: readonly string[];
  probe: boolean;
  json: boolean;
}

function usage(message?: string): never {
  if (message) console.error(`${message}\n`);
  console.error("usage: npm run manifest:check -- <manifest.json | directory> [...] [--registries a,b] [--no-probe] [--json]");
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const options: Options = { targets: [], registries: DEFAULT_REGISTRIES, probe: true, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--no-probe") options.probe = false;
    else if (arg === "--json") options.json = true;
    else if (arg === "--registries" || arg.startsWith("--registries=")) {
      const value = arg === "--registries" ? argv[++i] : arg.slice("--registries=".length);
      if (!value) usage("--registries needs a comma-separated list of hosts.");
      const list = normaliseRegistries(value.split(","));
      if (list.length === 0) usage("--registries needs at least one host.");
      options.registries = list;
    } else if (arg === "--help" || arg === "-h") usage();
    else if (arg.startsWith("-")) usage(`Unknown option ${arg}.`);
    else options.targets.push(arg);
  }
  if (options.targets.length === 0) usage("Give a manifest, or a directory to look in.");
  return options;
}

/** The manifest.json files at or below a target, in a stable order. */
function manifestsIn(target: string): string[] {
  let info;
  try {
    info = statSync(target);
  } catch {
    console.error(`${target}: no such file or directory`);
    process.exit(2);
  }
  if (info.isFile()) return [target];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "manifest.json") found.push(full);
    }
  };
  walk(target);
  return found;
}

const options = parseArgs(process.argv.slice(2));
const files = [...new Set(options.targets.flatMap(manifestsIn))];
if (files.length === 0) {
  console.error("No manifest.json found.");
  process.exit(2);
}

interface Report {
  file: string;
  ok: boolean;
  id?: string;
  name?: string;
  hash?: string | null;
  images?: string[];
  problems?: Array<{ path: string; message: string }>;
}

const reports: Report[] = files.map((file) => {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return { file, ok: false, problems: [{ path: "", message: `could not be read: ${(error as Error).message}` }] };
  }
  if (text.length > MAX_MANIFEST_CHARS) {
    return { file, ok: false, problems: [{ path: "", message: `is ${text.length} characters; a manifest is at most ${MAX_MANIFEST_CHARS / 1024} KB` }] };
  }
  const result: ManifestResult = validateManifest(text, { registries: options.registries, probe: options.probe });
  return result.ok
    ? { file, ok: true, id: result.definition.id, name: result.definition.name, hash: result.hash, images: result.images.map((i) => i.canonical) }
    : { file, ok: false, hash: result.hash, problems: result.problems };
});

if (options.json) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const r of reports) {
    if (r.ok) {
      console.log(`ok    ${r.file}  ${r.id}  “${r.name}”`);
      for (const image of r.images ?? []) console.log(`        ${image}`);
      console.log(`        sha256 ${r.hash}`);
    } else {
      console.log(`FAIL  ${r.file}`);
      for (const p of r.problems ?? []) console.log(`        ${p.path || "manifest"}  ${p.message}`);
    }
  }
  const failed = reports.filter((r) => !r.ok).length;
  console.log(`\n${reports.length - failed} of ${reports.length} manifest${reports.length === 1 ? "" : "s"} passed${failed ? `, ${failed} did not` : ""}.`);
  if (failed === 0) console.log("Passing means well formed and safe to show an owner. It does not mean the image is the one you mean, or that the game runs.");
}

process.exit(reports.every((r) => r.ok) ? 0 : 1);
