#!/usr/bin/env node
// A release, in the order that cannot publish a lie. Dependency-free, run from anywhere in the checkout.
//
//   node scripts/cut.mjs bump 0.9.0   rewrite what is mechanical (versions, locks, page literals, the changelog's heading, date and
//                                     link, the migration pins) and check the tree. What is left is prose, and the check says which.
//   node scripts/cut.mjs verify       only that the tree is true. No git, no network: what the Release workflow runs on a tag.
//   node scripts/cut.mjs release-json the file every release carries as an asset (release-policy.json + the version and date), on stdout:
//                                     what the Release workflow attaches to the draft, and what every panel reads to learn it is behind.
//   node scripts/cut.mjs check        before the tag: the tree is true, clean, pushed and green. Needs git, and `gh` for the CI answer.
//   node scripts/cut.mjs after v0.9.0 after the tag: waits for the Release workflow, then reads what it published, from outside.
//   node scripts/cut.mjs community v0.9.0 [--merge | --dry-run]
//                                     the pull request that moves the community games repository's pin to the tag (see the function).
//   node scripts/cut.mjs check --pushing v0.9.0   the same as `check`, for the tag that exists and is about to be sent: what
//                                     .githooks/pre-push runs, so that a release tag cannot leave this machine unchecked.
//
// The order is the point. The tag used to be pushed with `main` in one command, so the docs named an image that did not exist yet
// and CI's answer came after the tag could no longer be taken back: four version numbers were spent on it in three days. Now:
//
//   1. node scripts/cut.mjs bump X.Y.Z, write the prose, commit        (on a branch, merged to main when it is done)
//   2. git push origin main
//   3. wait for CI on that commit, then node scripts/cut.mjs check
//   4. git tag -a vX.Y.Z -m "Geeboard X.Y.Z" && git push origin vX.Y.Z
//   5. node scripts/cut.mjs after vX.Y.Z, then publish the draft
//   6. node scripts/cut.mjs community vX.Y.Z --merge
//
// docs/development.md, "Releasing", is this with the reasons.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { IMAGES, IMAGE_OWNER, SLUG, STABLE, bump, consistency, releaseJson, sections, versions } from "./release-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMUNITY = "DanieleMarino70/geeboard-community-games";
const SITE = "https://danielemarino70.github.io/Geeboard";

let failed = 0;
const say = (line = "") => console.log(line);
const ok = (line) => say(`  ok    ${line}`);
const warn = (line) => say(`  warn  ${line}`);
const no = (line) => {
  failed++;
  say(`  FAIL  ${line}`);
};

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...options }).trim();
}
/** The output of a command, or null where it fails: a missing tag, a missing `gh`, no network. */
function tryRun(command, args, options) {
  try {
    return run(command, args, options);
  } catch {
    return null;
  }
}
const haveGh = () => tryRun("gh", ["--version"]) !== null;

function problemsOf() {
  return consistency(root).map((p) => `${p.file}: ${p.message}`);
}

function versionOf(argument) {
  const v = String(argument ?? "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)) {
    say(`"${argument ?? ""}" is not a version (0.9.0, v0.9.0, or 1.0.0-rc.1)`);
    process.exit(2);
  }
  return v;
}

/** The release tags that are on the remote, highest first. Local tags that were never pushed (v0.6.0, v0.7.0) are not releases. */
function remoteTags() {
  const out = tryRun("git", ["ls-remote", "--tags", "origin", "refs/tags/v*"]);
  if (out === null) return null;
  const names = out
    .split("\n")
    .map((line) => /refs\/tags\/(v[^\s^]+)$/.exec(line)?.[1])
    .filter(Boolean);
  const key = (tag) => tag.slice(1).split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : -1));
  const compare = (a, b) => {
    const [x, y] = [key(a), key(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
    return 0;
  };
  return [...new Set(names)].sort(compare);
}

// ── bump ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function bumpCommand(argument) {
  const version = versionOf(argument);
  const changed = bump(root, version);
  say(`Geeboard ${version}: ${changed.length} files rewritten`);
  for (const file of changed) say(`  ${file}`);
  say();
  const problems = problemsOf();
  if (problems.length === 0) {
    ok("the tree says one version everywhere");
    say("\nNext: commit it, and when it is on main, `node scripts/cut.mjs check`.");
    return;
  }
  say("What is left is for a person to write:");
  for (const line of problems) no(line);
}

// ── check ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/* `pushing` is the tag a pre-push hook is about to send (scripts/cut.mjs check --pushing v0.9.0): the tag is then expected to be here, annotated,
   on the commit that is origin/main, and not on origin. Without it, the same questions are asked before the tag is made. */
function checkCommand(pushing = null) {
  const v = versions(root).web;
  const tag = pushing ?? `v${v}`;
  say(pushing ? `Before ${tag} is pushed\n` : `Before ${tag} is tagged\n`);
  if (pushing && pushing !== `v${v}`) no(`the tag is ${pushing} and web/package.json says ${v}: a tag is the version`);

  const first = sections(root).sections[0];
  if (first?.name === "Unreleased") no("CHANGELOG.md still collects this release under Unreleased: run `node scripts/cut.mjs bump " + (first.tail || v) + "`");
  const problems = problemsOf();
  if (problems.length === 0) ok("the versions, the pages, the changelog and the contract agree");
  for (const line of problems) no(line);

  const dirty = tryRun("git", ["status", "--porcelain"]);
  if (dirty === null) no("this is not a git checkout");
  else if (dirty) no(`the working tree is not clean (${dirty.split("\n").length} paths): the tag would not be what was tested`);
  else ok("the working tree is clean");

  tryRun("git", ["fetch", "origin", "main", "--quiet"]);
  const head = tryRun("git", ["rev-parse", "HEAD"]);
  const main = tryRun("git", ["rev-parse", "origin/main"]);
  if (!head || !main) no("cannot read HEAD and origin/main");
  else if (head !== main) no(`HEAD is not origin/main (${head.slice(0, 7)} against ${main.slice(0, 7)}): push main first, wait for CI, and tag that commit`);
  else ok(`HEAD is origin/main, ${head.slice(0, 7)}`);

  const here = tryRun("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
  if (pushing) {
    if (here === null) no(`${tag} is not in this clone`);
    else if (tryRun("git", ["cat-file", "-t", `refs/tags/${tag}`]) !== "tag") no(`${tag} is a lightweight tag: git tag -d ${tag} && git tag -a ${tag} -m "Geeboard ${v}" (an annotated tag is what push.followTags sends, and the only kind that says who made it)`);
    else if (head && tryRun("git", ["rev-list", "-n", "1", tag]) !== head) no(`${tag} is not on HEAD, which is the commit that was checked`);
    else ok(`${tag} is an annotated tag on HEAD`);
  } else if (here !== null) no(`${tag} exists in this clone: a tag is never reused`);
  else ok(`${tag} is not in this clone`);
  const tags = remoteTags();
  if (tags === null) warn("could not ask origin which tags it has");
  else if (tags.includes(tag)) no(`${tag} exists on origin: a published tag is never moved, and a burned number is not used again`);
  else ok(`${tag} is not on origin`);

  const previous = tags?.find((t) => !t.includes("-") && t !== tag && tryRun("git", ["rev-parse", "-q", "--verify", `refs/tags/${t}`]) !== null);
  if (previous) {
    const diff = tryRun("git", ["diff", "--name-status", previous, "HEAD", "--", "web/prisma/migrations"]) ?? "";
    const touched = diff.split("\n").filter((line) => line && !line.startsWith("A\t"));
    if (touched.length > 0) no(`a migration that shipped in ${previous} was changed: ${touched.join("; ")}. A migration that has shipped is never edited`);
    else ok(`since ${previous} the migrations have only been added to`);
  } else warn("no earlier release tag in this clone to compare the migrations with (git fetch --tags)");

  if (!haveGh()) warn("`gh` is not installed: CI's answer for this commit was not read. Read it yourself before the tag");
  else if (head) {
    const runs = tryRun("gh", ["run", "list", "--workflow", "CI", "--commit", head, "--json", "status,conclusion,event", "--limit", "20"]);
    const list = runs ? JSON.parse(runs) : [];
    if (list.some((r) => r.conclusion === "success")) ok("CI is green on this commit");
    else if (list.some((r) => r.status !== "completed")) no("CI has not finished on this commit: wait for it, and tag only a commit it passed");
    else no(list.length ? "CI did not pass on this commit" : "CI has no run for this commit: is it pushed?");
  }

  if (tryRun("git", ["ls-remote", "--heads", "origin", STABLE])) ok(`origin has a ${STABLE} branch`);
  else warn(`origin has no ${STABLE} branch, which the install instructions clone: git push origin <last release tag>^{commit}:refs/heads/${STABLE}`);

  if (existsSync(path.join(root, "docs-src", "node_modules"))) {
    for (const script of ["build.mjs", "check-links.mjs"]) {
      const r = spawnSync(process.execPath, [path.join("docs-src", script)], { cwd: root, encoding: "utf8" });
      if (r.status === 0) ok(`docs-src/${script}`);
      else no(`docs-src/${script} failed: ${(r.stdout + r.stderr).trim().split("\n").slice(-3).join(" | ")}`);
    }
  } else warn("docs-src has no node_modules (npm ci there): the docs build and link check were not run");

  communityNote(tag);
  say(failed ? `\n${failed} to put right before ${tag}.` : `\nNothing stands in the way. git tag -a ${tag} -m "Geeboard ${v}" && git push origin ${tag}`);
}

function communityNote(tag) {
  const pin = tryRun("gh", ["api", `repos/${COMMUNITY}/contents/.github/workflows/check.yml`, "--jq", ".content"]);
  const text = pin ? Buffer.from(pin, "base64").toString("utf8") : "";
  const ref = /GEEBOARD_REF:\s*(\S+)/.exec(text)?.[1];
  if (ref && ref !== tag) say(`  note  the community games repository checks against ${ref}; after this release: node scripts/cut.mjs community ${tag}`);
}

// ── community ─────────────────────────────────────────────────────────────

/* The community games repository checks its manifests against one Geeboard tag (`GEEBOARD_REF` in its check workflow), so that a change to this
   panel's rules cannot turn it red on its own. The pin moves when a release is out, in a pull request of its own, and doing it by hand was five
   commands and an edit to two lines in the right file. This does it, with the credentials of whoever runs it: a workflow here cannot write to another
   repository with its own token, and a token that could would be a secret to keep for the sake of one line.

     community v0.9.5             clones the repository, runs its checker against the tag, moves the pin, opens the pull request
     community v0.9.5 --merge     and waits for the pull request's own check, then squash-merges it
     community v0.9.5 --dry-run   everything but the push: says what would change, and leaves nothing behind

   The checker is run here only when this checkout is the tagged commit, which is the case right after a release; otherwise the pull request's own
   check (it fetches the tag) is the proof, and this says so. */
function communityCommand(tag, flags) {
  const merge = flags.includes("--merge");
  const dry = flags.includes("--dry-run");
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
    no("say the release tag, like v0.9.5");
    return;
  }
  if (!haveGh()) {
    no("gh is needed (https://cli.github.com) and signed in: gh auth login");
    return;
  }
  const onOrigin = tryRun("git", ["ls-remote", "origin", `refs/tags/${tag}`]);
  if (!onOrigin) {
    no(`${tag} is not on origin: the pin follows a release that is out`);
    return;
  }
  const draft = tryRun("gh", ["release", "view", tag, "--json", "isDraft", "--jq", ".isDraft"]);
  if (draft === "true") warn(`${tag} is still a draft: the tag exists and the pin can follow it, but publish the release too`);

  const dir = mkdtempSync(path.join(tmpdir(), "geeboard-community-"));
  try {
    run("gh", ["repo", "clone", COMMUNITY, dir, "--", "--quiet"]);
    const file = path.join(dir, ".github", "workflows", "check.yml");
    const before = readFileSync(file, "utf8");
    const current = /GEEBOARD_REF:\s*(\S+)/.exec(before)?.[1];
    if (!current) {
      no(`${COMMUNITY}: .github/workflows/check.yml has no GEEBOARD_REF line to move`);
      return;
    }
    if (current === tag) {
      ok(`the community games repository already follows ${tag}`);
      return;
    }
    const after = before
      .replace(/(GEEBOARD_REF:\s*)\S+/, (_, key) => `${key}${tag}`)
      .replace(/pass v\d+\.\d+\.\d+'s checker/, `pass ${tag}'s checker`);
    if (!after.includes(`GEEBOARD_REF: ${tag}`)) {
      no("the pin could not be rewritten: read .github/workflows/check.yml there");
      return;
    }

    const tagged = tryRun("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`]);
    const head = tryRun("git", ["rev-parse", "HEAD"]);
    if (tagged && tagged === head && existsSync(path.join(root, "web", "node_modules"))) {
      const r = spawnSync(process.execPath, ["scripts/check.mjs"], { cwd: dir, env: { ...process.env, GEEBOARD_DIR: root }, encoding: "utf8" });
      const summary = (r.stdout.match(/\d+ of \d+ manifests passed\./) ?? [""])[0];
      if (r.status === 0) ok(`its manifests pass ${tag}'s checker${summary ? `: ${summary}` : ""}`);
      else {
        no(`its manifests do not pass ${tag}'s checker, so the pin is not moved: ${(r.stdout + r.stderr).trim().split("\n").slice(-4).join(" | ")}`);
        return;
      }
    } else warn(`this checkout is not at ${tag}, so its checker was not run here: the pull request's own check runs it against the tag`);

    const was = before.split(/\r?\n/);
    for (const line of after.split(/\r?\n/).filter((l, i) => l !== was[i])) say(`        + ${line.trim()}`);
    if (dry) {
      say(`\nA dry run: nothing was pushed. Run it again without --dry-run to open the pull request.`);
      return;
    }

    const branch = `follow-geeboard-${tag.slice(1)}`;
    const body = `The pin moves to ${tag}, the latest release. Both manifests pass its checker (run before this commit, against the tag).`;
    writeFileSync(file, after);
    run("git", ["switch", "-q", "-c", branch], { cwd: dir });
    run("git", ["add", ".github/workflows/check.yml"], { cwd: dir });
    run("git", ["commit", "-q", "-m", `Follow Geeboard ${tag}`, "-m", body], { cwd: dir });
    run("git", ["push", "-q", "-u", "origin", branch], { cwd: dir });
    const url = run("gh", ["pr", "create", "--repo", COMMUNITY, "--head", branch, "--base", "main", "--title", `Follow Geeboard ${tag}`, "--body", body], { cwd: dir })
      .split("\n")
      .at(-1);
    ok(`the pull request is open: ${url}`);

    if (!merge) {
      say(`\nWhen its check is green:   gh pr merge ${url} --squash --delete-branch\n(or run this again with --merge, which waits for the check and does that)`);
      return;
    }
    /* The check is made a few seconds after the pull request is. Asked at once, gh says "no checks reported" and exits with an error, which is
       not a check that failed (the first run of this, on 0.9.6, merged nothing for it). So: wait, up to two minutes, until there is one to watch. */
    for (let tries = 0; tries < 24; tries++) {
      const seen = spawnSync("gh", ["pr", "checks", url, "--json", "name"], { cwd: dir, encoding: "utf8" });
      let checks = 0;
      try {
        checks = seen.status === 0 ? JSON.parse(seen.stdout || "[]").length : 0;
      } catch {
        checks = 0;
      }
      if (checks > 0) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    }
    const watched = spawnSync("gh", ["pr", "checks", url, "--watch"], { cwd: dir, stdio: "inherit" });
    if (watched.status !== 0) {
      no(`the pull request's check did not pass, so it was not merged: ${url}`);
      return;
    }
    run("gh", ["pr", "merge", url, "--squash", "--delete-branch"], { cwd: dir });
    ok(`merged: the community games repository follows ${tag}`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

// ── after ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const MANIFESTS = ["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"];

async function registry(image, reference) {
  const name = `${IMAGE_OWNER}/${image}`;
  const auth = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${name}:pull`);
  const { token } = await auth.json();
  const headers = { authorization: `Bearer ${token}`, accept: MANIFESTS.join(", ") };
  const res = await fetch(`https://ghcr.io/v2/${name}/manifests/${reference}`, { headers });
  if (!res.ok) return { status: res.status };
  let body = await res.json();
  const digest = res.headers.get("docker-content-digest");
  // An index points at one manifest per platform: the first has the config, and its labels are the build's.
  if (Array.isArray(body.manifests)) {
    const one = await fetch(`https://ghcr.io/v2/${name}/manifests/${body.manifests[0].digest}`, { headers });
    body = await one.json();
  }
  const blob = await fetch(`https://ghcr.io/v2/${name}/blobs/${body.config.digest}`, { headers });
  const config = await blob.json();
  return { status: 200, digest, revision: config.config?.Labels?.["org.opencontainers.image.revision"], version: config.config?.Labels?.["org.opencontainers.image.version"] };
}

async function afterCommand(argument) {
  const version = versionOf(argument);
  const tag = `v${version}`;
  const pre = version.includes("-");
  say(`After ${tag}\n`);
  if (!haveGh()) {
    no("`gh` is needed to watch the Release workflow");
    return;
  }

  const runs = tryRun("gh", ["run", "list", "--workflow", "Release", "--branch", tag, "--json", "databaseId,status,conclusion", "--limit", "1"]);
  const latest = runs ? JSON.parse(runs)[0] : undefined;
  if (!latest) no(`no Release run for ${tag}: was the tag pushed?`);
  else {
    if (latest.status !== "completed") {
      say(`  ...   watching Release run ${latest.databaseId}`);
      spawnSync("gh", ["run", "watch", String(latest.databaseId), "--exit-status"], { cwd: root, stdio: "inherit" });
    }
    const done = JSON.parse(run("gh", ["run", "view", String(latest.databaseId), "--json", "conclusion"]));
    if (done.conclusion === "success") ok(`the Release run for ${tag} succeeded`);
    else no(`the Release run for ${tag} ended ${done.conclusion}: the number is spent, and the next release takes the next one`);
  }

  const sha = tryRun("git", ["rev-list", "-n", "1", tag]);
  for (const image of IMAGES) {
    const tags = pre ? [version] : [version, version.replace(/\.\d+$/, ""), "latest"];
    const seen = [];
    for (const reference of tags) {
      const found = await registry(image, reference).catch((error) => ({ status: String(error) }));
      if (found.status !== 200) {
        no(`${image}:${reference} is not on ghcr.io (${found.status})`);
        continue;
      }
      seen.push(found);
      if (reference === version && sha && found.revision !== sha) no(`${image}:${version} was built from ${String(found.revision).slice(0, 7)}, and ${tag} is ${sha.slice(0, 7)}`);
    }
    if (seen.length === tags.length && new Set(seen.map((s) => s.digest)).size === 1) ok(`${image}: ${tags.join(", ")} are one image, built from ${sha?.slice(0, 7)}`);
    else if (seen.length === tags.length && !pre) no(`${image}: ${tags.join(", ")} are not the same image`);
  }

  /* The signature is made by a workflow of its own (.github/workflows/sign.yml) after Release, so it may not be there yet, and a missing one is a thing to
     repair and not a burned number: said as a warning, with the command that makes it. Without cosign on this machine it is not looked at, and that is said. */
  if (!pre) {
    if (!tryRun("cosign", ["version"])) warn("cosign is not installed here, so the images' signatures were not checked (docs/security.md, \"Verifying an image\")");
    else {
      const identity = `https://github.com/${SLUG}/.github/workflows/sign.yml@refs/heads/main`;
      for (const image of IMAGES) {
        const name = `ghcr.io/${IMAGE_OWNER}/${image}:${version}`;
        const signed = tryRun("cosign", ["verify", name, "--certificate-identity", identity, "--certificate-oidc-issuer", "https://token.actions.githubusercontent.com"]);
        if (signed) ok(`${image}:${version} is signed by this repository's sign.yml`);
        else warn(`${image}:${version} has no signature yet; the Sign images workflow follows the release by a minute: gh run list --workflow sign.yml, or gh workflow run sign.yml -f tag=${tag}`);
      }
    }
  }

  const draft = tryRun("gh", ["release", "view", tag, "--json", "isDraft,body,isPrerelease"]);
  if (!draft) no(`no GitHub release for ${tag}`);
  else {
    const release = JSON.parse(draft);
    if (!release.body?.includes("### Images")) no("the release notes have no image list");
    else ok(`the release exists with its notes (${release.isDraft ? "a draft: read it and press the button" : "published"})`);
    if (!pre) await releaseFile(tag, version, release.isDraft);
  }

  const stable = tryRun("git", ["ls-remote", "origin", `refs/heads/${STABLE}`])?.split("\t")[0];
  if (pre) ok(`a pre-release does not move ${STABLE}`);
  else if (sha && stable === sha) ok(`${STABLE} is at ${tag}`);
  else no(`${STABLE} is at ${stable?.slice(0, 7) ?? "nothing"}, and ${tag} is ${sha?.slice(0, 7)}`);

  for (const page of ["upgrading/", "upgrading.html"]) {
    const res = await fetch(`${SITE}/${page}`).catch(() => null);
    if (res?.ok) {
      const html = await res.text();
      if (html.includes(`geeboard-panel:${version}`)) ok(`the docs site names ${version}`);
      else warn(`the docs site is up and does not name ${version} yet: the deploy follows the release by a minute`);
      break;
    }
  }
  communityNote(tag);
  say(failed ? `\n${failed} to look at.` : `\nPublish the draft: gh release edit ${tag} --draft=false   (and apply .github/rulesets/release-tags.json after the last tag)`);
}

/* The file panels read to learn a newer release exists: attached to the release, and parseable. And once the draft is published, answered at the
   address they ask (GitHub's "latest" is the newest PUBLISHED release, so before that it is still the one before). */
async function releaseFile(tag, version, isDraft) {
  const body = tryRun("gh", ["release", "download", tag, "--pattern", "release.json", "--output", "-"]);
  if (!body) {
    no(`${tag} has no release.json asset, so no panel can learn of it: gh release upload ${tag} <(node scripts/cut.mjs release-json) --clobber, from a checkout of the tag`);
    return;
  }
  let file;
  try {
    file = JSON.parse(body);
  } catch {
    no("release.json is attached and is not JSON");
    return;
  }
  if (file.schema !== 1 || file.version !== version) no(`release.json says ${file.version} (schema ${file.schema}), and the release is ${version}`);
  else ok(`release.json is attached: ${[file.recommended ? "recommended" : null, file.securityFloor ? `security floor ${file.securityFloor}` : null, file.agentFloor ? `agent floor ${file.agentFloor}` : null].filter(Boolean).join(", ") || "no floors, not recommended"}`);
  if (isDraft) {
    say("        a draft is not what panels are told yet: https://github.com/" + SLUG + "/releases/latest/download/release.json answers once it is published");
    return;
  }
  const live = await fetch(`https://github.com/${SLUG}/releases/latest/download/release.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (live?.version === version) ok("the address panels read answers with this release");
  else warn(`the address panels read answers ${live?.version ?? "nothing"}, not ${version}; GitHub may need a minute`);
}

/* What the Release workflow runs on a tag, and anybody can run: the tree is true, and nothing more — no git, no network. */
function verifyCommand() {
  const problems = problemsOf();
  if (problems.length === 0) ok(`the tree says ${versions(root).web} everywhere`);
  for (const line of problems) no(line);
}

const [verb, argument] = process.argv.slice(2);
if (verb === "bump") bumpCommand(argument);
else if (verb === "verify") verifyCommand();
else if (verb === "check") checkCommand(argument === "--pushing" ? `v${versionOf(process.argv[4])}` : null);
else if (verb === "after") await afterCommand(argument);
else if (verb === "community") communityCommand(argument, process.argv.slice(4));
else if (verb === "release-json") {
  try {
    process.stdout.write(`${JSON.stringify(releaseJson(root), null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  process.exit(0);
}
else {
  say("node scripts/cut.mjs bump <version> | verify | check | after <tag> | community <tag>   (see the top of this file)");
  process.exit(verb ? 2 : 0);
}
process.exit(failed === 0 ? 0 : 1);
