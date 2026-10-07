import "server-only";
import { bare } from "@/domain/text";
import type { GameManifest, Prisma, User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { DEFAULT_REGISTRIES, normaliseRegistries, registryProblem } from "@/domain/games/image-ref";
import { canonicalJson, hashOf, validateManifest, type ManifestProblem, type ManifestResult } from "@/domain/games/manifest";
import { consolePatternsOf, guardPatterns, whenBroken } from "@/domain/games/matcher";
import { setCommunityGames } from "@/domain/games/registry";
import type { GameDefinition } from "@/domain/games/types";
import { verifyFreshCodeOp } from "./account-ops";
import { attempt } from "./attempts";
import { syncCatalog } from "./catalog-sync";
import { db } from "./db";
import { uniqueViolation } from "./db-errors";
import { logger } from "./log";
import type { OpResult } from "./server-ops";

/* A game's expression that overran its limit three times is no longer run, until a new revision brings a different set: the game's page says
   so, and now the log does, once, instead of a game that quietly stops counting players. */
whenBroken((pattern) => logger.warn("a community game's expression was too slow on three tries and is not run again until its game is revised", { pattern: pattern.length > 80 ? `${pattern.slice(0, 80)}…` : pattern }));

/* Games that somebody wrote, and the consent that lets them run.

   A manifest is a game definition in JSON (domain/games/manifest.ts). What is
   here is the other half: where one is kept, who may say yes, and how an
   approved one comes to be a game the rest of the panel can find.

     propose   an owner or admin pastes one. It is validated against the
               workspace's list of registries; one that passes becomes a
               PENDING revision. A pending revision runs nothing, is in no
               wizard and is on no node.
     approve   an owner, with a fresh code from their authenticator, says it
               may run. Bound to the manifest's hash: the page that showed
               what would run is the one that said yes to it.
     reject    a pending revision is turned down, by an owner or admin.
     retire    an approved game leaves the wizard. Its servers are not touched.

   And the loader: the approved manifests are read back from the database,
   **checked again** — hashed, and put through the same validator — and only
   then handed to the registry. A row that was edited by hand does not load. */

export type CommunityResult = OpResult & { problems?: ManifestProblem[]; revisionId?: string };

function refuse(title: string, body: string, problems?: ManifestProblem[]): CommunityResult {
  return { ok: false, title, body, ...(problems ? { problems } : {}) };
}

async function record(actor: User, action: string, target: string, tone: "INFO" | "WARNING" | "SUCCESS", changes?: Record<string, { from: string; to: string }>) {
  await db.activityEvent.create({ data: { actor: actor.name, action, target, tone, userId: actor.id, changes } });
}

/* ── The policy ───────────────────────────────────────────────── */

export async function communityRegistries(): Promise<string[]> {
  const row = await db.communityPolicy.findUnique({ where: { id: "policy" } });
  return row ? normaliseRegistries(row.registries) : [...DEFAULT_REGISTRIES];
}

/** The owner's list of where an image may come from. Widening it approves nothing: it decides what may be proposed. */
export async function setRegistriesOp(actor: User, raw: string[]): Promise<CommunityResult> {
  if (!can(actor, "community.approve")) return refuse("Not permitted", "Only an owner can change which registries an image may come from.");
  const list = normaliseRegistries(raw.map(String));
  if (list.length === 0) return refuse("Check the list", "Keep at least one registry, or no game can be proposed.");
  if (list.length > 10) return refuse("Check the list", "Ten registries is the most.");
  for (const host of list) {
    const problem = registryProblem(host);
    if (problem) return refuse("Check the list", `${host}: ${problem}`);
  }
  const before = await communityRegistries();
  if (before.join() === list.join()) return { ok: true, tone: "success", title: "Nothing to change", body: "The list is as it was." };
  await db.communityPolicy.upsert({ where: { id: "policy" }, create: { id: "policy", registries: list, updatedById: actor.id }, update: { registries: list, updatedById: actor.id } });
  await record(actor, "community.registries.changed", "registries", "WARNING", { Registries: { from: before.join(", "), to: list.join(", ") } });
  return { ok: true, tone: "success", title: "Registries saved", body: `Images may come from ${list.join(", ")}. A game that was already approved is not affected; this decides what may be proposed.` };
}

/* ── Proposing ────────────────────────────────────────────────── */

const MAX_PENDING = 20;

export async function submitManifestOp(actor: User, text: string): Promise<CommunityResult> {
  if (!can(actor, "community.propose")) return refuse("Not permitted", "Only owners and admins can propose a game.");
  // Each manifest costs a timed run of every expression in it; a person pasting a hundred a minute is not reading them.
  if (!attempt(`community-submit:${actor.id}`, 20, 10 * 60_000)) return refuse("Too many attempts", "Wait ten minutes and try again.");

  const result = validateManifest(String(text ?? ""), { registries: await communityRegistries() });
  if (!result.ok) {
    await record(actor, "community.manifest.refused", "a manifest", "WARNING", {
      Reason: { from: "—", to: `${result.problems.length} problem${result.problems.length === 1 ? "" : "s"}; the first at ${result.problems[0]?.path || "the manifest"}` },
      ...(result.hash ? { Hash: { from: "—", to: result.hash.slice(0, 12) } } : {}),
    });
    const first = result.problems[0]!;
    return refuse(
      "The manifest was refused",
      `${result.problems.length} problem${result.problems.length === 1 ? "" : "s"}. The first: ${first.path ? `${first.path} ` : "the manifest "}${bare(first.message)}.`,
      result.problems,
    );
  }

  if ((await db.gameManifest.count({ where: { state: "PENDING" } })) >= MAX_PENDING) {
    return refuse("Too many waiting", `${MAX_PENDING} manifests are waiting to be read. Reject some, or approve them, first.`);
  }
  const parsed = typeof text === "string" ? JSON.parse(text) : text;

  for (let tries = 0; tries < 3; tries++) {
    const same = await db.gameManifest.findFirst({ where: { gameId: result.definition.id, hash: result.hash, state: { in: ["PENDING", "APPROVED"] } } });
    if (same) {
      return refuse("Already here", same.state === "APPROVED" ? `${result.definition.name} revision ${same.revision} is this manifest, and it is approved.` : `${result.definition.name} revision ${same.revision} is this manifest, and it is waiting to be read.`);
    }
    const last = await db.gameManifest.findFirst({ where: { gameId: result.definition.id }, orderBy: { revision: "desc" }, select: { revision: true } });
    try {
      const row = await db.gameManifest.create({
        data: { gameId: result.definition.id, revision: (last?.revision ?? 0) + 1, manifest: parsed as never, hash: result.hash, name: result.definition.name, submittedById: actor.id },
      });
      await record(actor, "community.manifest.proposed", `${result.definition.name} r${row.revision}`, "INFO", {
        Game: { from: "—", to: result.definition.id },
        Hash: { from: "—", to: result.hash.slice(0, 12) },
        Images: { from: "—", to: `${result.images.length} version${result.images.length === 1 ? "" : "s"}, ${[...new Set(result.images.map((i) => i.ref.registry))].join(", ")}` },
      });
      return { ok: true, tone: "success", title: "Proposed", body: `${result.definition.name} is waiting to be read. Nothing of it runs, and it is in no wizard, until an owner approves it.`, revisionId: row.id };
    } catch (error) {
      // Two people proposing the same game at the same moment: the next revision number is the other one's.
      if (uniqueViolation(error) === null) throw error;
    }
  }
  return refuse("Try again", "Another proposal for this game was being saved at the same moment.");
}

/* ── Deciding ─────────────────────────────────────────────────── */

export async function rejectManifestOp(actor: User, revisionId: string, note = ""): Promise<CommunityResult> {
  if (!can(actor, "community.propose")) return refuse("Not permitted", "Only owners and admins can turn a manifest down.");
  const row = await db.gameManifest.findUnique({ where: { id: String(revisionId) } });
  if (!row) return refuse("No such revision", "That manifest was already removed.");
  if (row.state !== "PENDING") return refuse("Not waiting", `${row.name} revision ${row.revision} is ${row.state.toLowerCase()}; only one that is waiting can be turned down.`);
  const cleaned = String(note ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
  const done = await db.gameManifest.updateMany({ where: { id: row.id, state: "PENDING" }, data: { state: "REJECTED", reviewedById: actor.id, reviewedAt: new Date(), note: cleaned || null } });
  if (done.count !== 1) return refuse("Already decided", "Somebody decided this revision a moment ago.");
  await record(actor, "community.manifest.rejected", `${row.name} r${row.revision}`, "INFO", { Hash: { from: "—", to: row.hash.slice(0, 12) } });
  return { ok: true, tone: "success", title: "Turned down", body: `${row.name} revision ${row.revision} will not run.` };
}

function whyNot(result: ManifestResult): string {
  return result.ok ? "" : result.problems.slice(0, 3).map((p) => `${p.path || "the manifest"} ${p.message}`).join("; ");
}

export async function approveManifestOp(actor: User, revisionId: string, input: { hash: string; code: string }): Promise<CommunityResult> {
  if (!can(actor, "community.approve")) return refuse("Not permitted", "Only an owner can approve a game: it lets an image run on the nodes that have said they will have one.");
  const row = await db.gameManifest.findUnique({ where: { id: String(revisionId) } });
  if (!row) return refuse("No such revision", "That manifest was already removed.");
  if (row.state !== "PENDING") return refuse("Not waiting", `${row.name} revision ${row.revision} is ${row.state.toLowerCase()}; only one that is waiting can be approved.`);

  /* What was read must be what is approved. The page showed a hash; this is it, and it is the stored manifest's own. */
  if (input.hash !== row.hash) return refuse("That is not what you read", "The page was showing another revision. Open this one again before approving it.");
  if (hashOf(canonicalJson(row.manifest)) !== row.hash) {
    logger.error("a stored manifest does not match its hash", { game: row.gameId, revision: row.revision });
    return refuse("The stored manifest was changed", "What is in the database no longer hashes to what was proposed, so it cannot be approved. Propose it again.");
  }
  // The registries may have changed since it was proposed, and a game is only approved from one that is on the list now.
  const again = validateManifest(row.manifest, { registries: await communityRegistries() });
  if (!again.ok) return refuse("It no longer passes", `Checked again just now: ${whyNot(again)}.`, again.problems);

  // The code last: a refused page must not spend one.
  const fresh = await verifyFreshCodeOp(actor, String(input.code ?? ""), "approving a game");
  if (!fresh.ok) return fresh;

  const approved = await db.$transaction(async (tx) => {
    // One approval at a time for a game, so two revisions cannot both end up approved.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${row.gameId}))`;
    const flipped = await tx.gameManifest.updateMany({ where: { id: row.id, state: "PENDING", hash: row.hash }, data: { state: "APPROVED", reviewedById: actor.id, reviewedAt: new Date() } });
    if (flipped.count !== 1) return false;
    await tx.gameManifest.updateMany({ where: { gameId: row.gameId, state: "APPROVED", id: { not: row.id } }, data: { state: "SUPERSEDED" } });
    return true;
  });
  if (!approved) return refuse("Already decided", "Somebody decided this revision a moment ago.");

  await refreshCommunityGames({ force: true });
  await syncCatalog({ offline: true });
  await record(actor, "community.manifest.approved", `${row.name} r${row.revision}`, "WARNING", {
    Game: { from: "—", to: row.gameId },
    Hash: { from: "—", to: row.hash.slice(0, 12) },
    Images: { from: "—", to: again.images.map((i) => i.canonical).join(", ").slice(0, 400) },
  });
  return {
    ok: true,
    tone: "success",
    title: "Approved",
    body: `${again.definition.name} is in the wizard. It can be placed only on a node that has declared community-games; no other node will take it.`,
    revisionId: row.id,
  };
}

export async function retireGameOp(actor: User, gameId: string): Promise<CommunityResult> {
  if (!can(actor, "community.propose")) return refuse("Not permitted", "Only owners and admins can retire a game.");
  const row = await db.gameManifest.findFirst({ where: { gameId: String(gameId), state: "APPROVED" } });
  if (!row) return refuse("Not approved", "That game is not approved, so there is nothing to retire.");
  const done = await db.gameManifest.updateMany({ where: { id: row.id, state: "APPROVED" }, data: { state: "RETIRED", reviewedById: actor.id, reviewedAt: new Date() } });
  if (done.count !== 1) return refuse("Already decided", "Somebody changed this game a moment ago.");
  const servers = await db.server.count({ where: { gameId: row.gameId } });
  await refreshCommunityGames({ force: true });
  await syncCatalog({ offline: true });
  await record(actor, "community.game.retired", row.name, "WARNING", { Game: { from: row.gameId, to: "retired" }, Servers: { from: String(servers), to: "left as they are" } });
  return {
    ok: true,
    tone: "warning",
    title: "Retired",
    body: `${row.name} is out of the wizard.${servers > 0 ? ` Its ${servers} server${servers === 1 ? "" : "s"} go${servers === 1 ? "es" : ""} on running and can still be managed.` : ""}`,
  };
}

/* ── Loading ──────────────────────────────────────────────────── */

const validated = new Map<string, GameDefinition>();
// For a definition that is being served because the checks changed: why, by the same key as `validated`.
const staleReason = new Map<string, string>();
let signature = "";

export interface LoadReport {
  active: string[];
  retired: string[];
  /** Rows that did not load, and why: never a secret, and read by whoever looks at the log. */
  skipped: Array<{ game: string; revision: number; reason: string }>;
  /** Games that no longer pass the current checks and are served as they were approved, because servers are made from them. */
  stale: Array<{ game: string; revision: number; reason: string }>;
  changed: boolean;
}

/* What was said of each game that is being served from the definition it was approved with, because the checks have changed since. Rebuilt
   at every load, and read by the pages that say so. */
let flagged = new Map<string, string>();

/** Why a game is served as it was approved and not as the current checks read it, or null: its page says so, and so does its servers'. */
export function communityGameNotice(gameId: string): string | null {
  return flagged.get(gameId) ?? null;
}

/* The definition a manifest last validated into, when it is still one: the same game, with the parts the rest of the panel reads. A stored
   value is data from a database and is not trusted past that. */
function keptDefinition(row: GameManifest & { definition?: unknown }): GameDefinition | null {
  const value = row.definition;
  if (!value || typeof value !== "object") return null;
  const definition = value as unknown as GameDefinition;
  const shaped = definition.id === row.gameId && Array.isArray(definition.versions) && Array.isArray(definition.ports) && Array.isArray(definition.templates);
  return shaped ? definition : null;
}

/* Reads the approved manifests, checks each again, and gives the registry what passed.

   Checked again because the database is not the thing that was approved: the
   hash is recomputed from the stored manifest and compared with the one stored
   beside it, and the manifest goes through the validator as it did on the way
   in (without the registry list, which is about what may be proposed — and
   without the timed run, which is for a person to read; the guard on every use
   covers it). Cached by hash, so a poll that changed nothing does no work. */
export async function refreshCommunityGames(options: { force?: boolean } = {}): Promise<LoadReport> {
  const rows = await db.gameManifest.findMany({ where: { state: { in: ["APPROVED", "RETIRED"] } }, orderBy: [{ gameId: "asc" }, { revision: "asc" }] });
  const next = rows.map((r) => `${r.id}:${r.hash}:${r.state}`).join("|");
  if (!options.force && next === signature) return { active: [], retired: [], skipped: [], stale: [], changed: false };

  const skipped: LoadReport["skipped"] = [];
  const stale: LoadReport["stale"] = [];
  // What validated, to be kept beside its manifest (see GameManifest.definition).
  const toKeep: Array<{ id: string; definition: GameDefinition }> = [];
  const definitionOf = (row: GameManifest & { definition?: unknown }): { definition: GameDefinition; stale: string | null } | null => {
    const cached = validated.get(`${row.id}:${row.hash}`);
    if (cached) return { definition: cached, stale: staleReason.get(`${row.id}:${row.hash}`) ?? null };
    if (hashOf(canonicalJson(row.manifest)) !== row.hash) {
      skipped.push({ game: row.gameId, revision: row.revision, reason: "the stored manifest does not match its hash" });
      return null;
    }
    const result = validateManifest(row.manifest, { registries: "any", probe: false });
    if (!result.ok) {
      /* The hash says this is what an owner approved, so the checks are what changed. A game that servers are made from is kept as it was
         validated when it last passed, and said so; a game with no server leaves, as before. */
      const kept = keptDefinition(row);
      const reason = `it no longer passes the checks: ${whyNot(result)}`;
      if (kept) {
        validated.set(`${row.id}:${row.hash}`, kept);
        staleReason.set(`${row.id}:${row.hash}`, reason);
        return { definition: kept, stale: reason };
      }
      skipped.push({ game: row.gameId, revision: row.revision, reason });
      return null;
    }
    if (result.definition.id !== row.gameId) {
      skipped.push({ game: row.gameId, revision: row.revision, reason: "its id is not the one it was stored under" });
      return null;
    }
    validated.set(`${row.id}:${row.hash}`, result.definition);
    staleReason.delete(`${row.id}:${row.hash}`);
    if (JSON.stringify(row.definition ?? null) !== JSON.stringify(result.definition)) toKeep.push({ id: row.id, definition: result.definition });
    return { definition: result.definition, stale: null };
  };

  const active: GameDefinition[] = [];
  const retiredLatest = new Map<string, GameDefinition>();
  const notices = new Map<string, string>();
  const withStale: Array<{ row: GameManifest; definition: GameDefinition; reason: string }> = [];
  for (const row of rows) {
    const loaded = definitionOf(row);
    if (!loaded) continue;
    if (loaded.stale) {
      withStale.push({ row, definition: loaded.definition, reason: loaded.stale });
      continue;
    }
    if (row.state === "APPROVED") active.push(loaded.definition);
    else retiredLatest.set(row.gameId, loaded.definition);
  }
  if (withStale.length > 0) {
    const used = new Set((await db.server.findMany({ where: { gameId: { in: withStale.map((s) => s.row.gameId) } }, select: { gameId: true } })).map((s) => s.gameId));
    for (const { row, definition, reason } of withStale) {
      if (!used.has(row.gameId)) {
        skipped.push({ game: row.gameId, revision: row.revision, reason });
        continue;
      }
      // Served for the servers that exist, never offered for a new one, and said so.
      retiredLatest.set(row.gameId, definition);
      stale.push({ game: row.gameId, revision: row.revision, reason });
      notices.set(row.gameId, `This game no longer passes the checks this release makes (${reason.replace(/^it no longer passes the checks: /, "")}). It is served as it was approved, so its servers go on being stopped, saved and watched by it, and it is not offered for new servers until a revision that passes is approved.`);
    }
  }
  flagged = notices;
  // Kept beside the manifest where the column exists: a panel that has not migrated yet, or has an older client, simply does not.
  if (toKeep.length > 0) {
    try {
      for (const k of toKeep) await db.gameManifest.update({ where: { id: k.id }, data: { definition: k.definition as unknown as Prisma.InputJsonValue } });
    } catch (error) {
      logger.warn("a community game's validated definition could not be kept beside its manifest", { detail: error instanceof Error ? error.message : String(error) });
    }
  }
  setCommunityGames({ active, retired: [...retiredLatest.values()] });
  // Every expression of every approved game is matched under a time limit from here on (domain/games/matcher.ts).
  guardPatterns([...active, ...retiredLatest.values()].flatMap(consolePatternsOf));
  signature = next;
  for (const s of skipped) logger.error("a community game was not loaded", { game: s.game, revision: s.revision, reason: s.reason });
  for (const s of stale) logger.warn("a community game no longer passes the checks, and is served as it was approved because servers are made from it", { game: s.game, revision: s.revision, reason: s.reason });
  return { active: active.map((g) => g.id), retired: [...retiredLatest.keys()], skipped, stale, changed: true };
}

/** For a test, to start from nothing. */
export function forgetCommunityGames(): void {
  validated.clear();
  staleReason.clear();
  flagged = new Map();
  signature = "";
  setCommunityGames({ active: [], retired: [] });
  guardPatterns([]);
}

/* ── What the pages show ──────────────────────────────────────── */

export interface RevisionView {
  id: string;
  gameId: string;
  name: string;
  revision: number;
  state: "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED" | "RETIRED";
  hash: string;
  submittedBy: string | null;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  note: string | null;
}

export interface CommunityOverview {
  revisions: RevisionView[];
  registries: string[];
  defaultRegistries: string[];
}

async function namesOf(ids: Array<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const people = wanted.length > 0 ? await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } }) : [];
  return new Map(people.map((p) => [p.id, p.name]));
}

function viewOf(row: GameManifest, names: Map<string, string>): RevisionView {
  return {
    id: row.id,
    gameId: row.gameId,
    name: row.name,
    revision: row.revision,
    state: row.state,
    hash: row.hash,
    submittedBy: row.submittedById ? (names.get(row.submittedById) ?? null) : null,
    submittedAt: row.submittedAt.toISOString(),
    reviewedBy: row.reviewedById ? (names.get(row.reviewedById) ?? null) : null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    note: row.note,
  };
}

export async function communityOverview(): Promise<CommunityOverview> {
  const rows = await db.gameManifest.findMany({ orderBy: [{ submittedAt: "desc" }], take: 100 });
  const names = await namesOf(rows.flatMap((r) => [r.submittedById, r.reviewedById]));
  return { revisions: rows.map((r) => viewOf(r, names)), registries: await communityRegistries(), defaultRegistries: [...DEFAULT_REGISTRIES] };
}

export interface RevisionDetail {
  revision: RevisionView;
  /** The manifest as it was given, formatted to be read. */
  text: string;
  /** Checked again just now, against the registries as they are: what approving would be approving. */
  check: { ok: true; definition: GameDefinition; images: Array<{ version: string; canonical: string; registry: string }> } | { ok: false; problems: ManifestProblem[] };
  /** Whether what is stored still hashes to what was proposed. */
  intact: boolean;
  servers: number;
}

/** The revision of each community game that is approved now, by game id. What the API names a game's running text by. */
export async function approvedRevisions(): Promise<Map<string, { number: number; hash: string }>> {
  const rows = await db.gameManifest.findMany({ where: { state: "APPROVED" }, select: { gameId: true, revision: true, hash: true } });
  return new Map(rows.map((r) => [r.gameId, { number: r.revision, hash: r.hash }]));
}

export async function revisionDetail(id: string): Promise<RevisionDetail | null> {
  const row = await db.gameManifest.findUnique({ where: { id } });
  if (!row) return null;
  const names = await namesOf([row.submittedById, row.reviewedById]);
  const intact = hashOf(canonicalJson(row.manifest)) === row.hash;
  const result = validateManifest(row.manifest, { registries: await communityRegistries() });
  return {
    revision: viewOf(row, names),
    text: JSON.stringify(row.manifest, null, 2),
    intact,
    check: result.ok
      ? { ok: true, definition: result.definition, images: result.images.map((i) => ({ version: i.version, canonical: i.canonical, registry: i.ref.registry })) }
      : { ok: false, problems: result.problems },
    servers: await db.server.count({ where: { gameId: row.gameId } }),
  };
}
