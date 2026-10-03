import "server-only";
import type { User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import type { ConfigValues } from "@/domain/games/config";
import { scopeToLine } from "@/domain/games/config";
import { findGame, versionOfServer } from "@/domain/games/registry";
import { leftBehind, nameProblem, settingsToApply, settingsToClone, settingsToKeep, startVersion, summaryOf } from "@/domain/templates/rules";
import { createBackupOp, restoreBackupOp } from "./backup-ops";
import { defaultVersion } from "./catalog";
import { db } from "./db";
import { uniqueViolation } from "./db-errors";
import type { OpResult } from "./server-ops";
import { offsiteTarget } from "./storage-ops";

/* Saved templates, and cloning a server that exists.

   A template is what somebody chose to keep of a server: its settings (minus
   a password and a file in its own folder — see domain/templates/rules.ts), its
   limits and its version. It is a way to start, not a backup. Saving one does
   not touch the server, and deleting one does not touch any server made from
   it: what a server was made with is in its own row.

   A clone is the same start, taken from one server in particular, with the
   option of its world. The world travels the way a world already travels
   between servers, through the workspace's bucket — a backup of the source and
   a restore into the new one — and not by the panel moving folders between
   machines: that is `move`, which already exists. With no bucket there is no
   world to copy, and the clone is the settings alone. */

function refuse(title: string, body: string): OpResult {
  return { ok: false, title, body };
}

const mayManage = (actor: User) => can(actor, "template.manage");

async function record(actor: User, action: string, target: string, tone: "INFO" | "WARNING", changes?: Record<string, { from: string; to: string }>, serverId?: string) {
  await db.activityEvent.create({ data: { actor: actor.name, action, target, tone, userId: actor.id, serverId, changes } });
}

/* ── Saving and deleting ──────────────────────────────────────── */

export async function saveTemplateOp(actor: User, slug: string, rawName: string): Promise<OpResult> {
  if (!mayManage(actor)) return refuse("Not permitted", "Only owners and admins can save a template.");
  const name = String(rawName ?? "").trim();
  const problem = nameProblem(name);
  if (problem) return refuse("Check the form", problem);

  const server = await db.server.findUnique({ where: { slug }, include: { gameVersionRef: { select: { slug: true } } } });
  if (!server) return refuse("Cannot save", "That server no longer exists.");
  const game = server.gameId ? findGame(server.gameId) : undefined;
  if (!game) return refuse("Cannot save", `${server.name} was made before the game catalog existed, so there is no definition to say which of its settings are which.`);

  const version = versionOfServer(game, { versionSlug: server.gameVersionRef?.slug, versionLabel: server.version });
  const scoped = scopeToLine(game, version?.line);
  const config = settingsToKeep(scoped, (server.config as Record<string, unknown> | null) ?? {});

  try {
    await db.serverTemplate.create({
      data: {
        name,
        gameId: game.id,
        config: config as never,
        memoryGb: server.memoryLimit,
        cpuLimit: server.cpuLimit,
        diskGb: server.diskQuota,
        versionLabel: server.version,
        versionSlug: server.gameVersionRef?.slug ?? version?.id ?? null,
        sourceName: server.name,
        createdById: actor.id,
      },
    });
  } catch (error) {
    if (uniqueViolation(error) !== null) return refuse("Name in use", `There is already a ${game.name} template called ${name}.`);
    throw error;
  }
  const left = leftBehind(scoped);
  await record(actor, "template.saved", name, "INFO", {
    Game: { from: "—", to: game.name },
    From: { from: "—", to: server.name },
    Settings: { from: "—", to: `${Object.keys(config).length} kept${left.length > 0 ? `, ${left.length} left behind` : ""}` },
  }, server.id);
  return {
    ok: true,
    tone: "success",
    title: "Template saved",
    body: `${name} keeps ${server.name}'s settings, limits and version${left.length > 0 ? `, but not ${left.join(" or ")}: ${left.length === 1 ? "it belongs" : "they belong"} to that server` : ""}. Find it under Templates.`,
  };
}

export async function deleteTemplateOp(actor: User, id: string): Promise<OpResult> {
  if (!mayManage(actor)) return refuse("Not permitted", "Only owners and admins can delete a template.");
  const template = await db.serverTemplate.findUnique({ where: { id } });
  if (!template) return refuse("No such template", "That template was already deleted.");
  await db.serverTemplate.delete({ where: { id } });
  await record(actor, "template.deleted", template.name, "WARNING");
  return { ok: true, tone: "warning", title: "Template deleted", body: `${template.name} is gone. Servers made from it are not touched: what they were made with is in their own settings.` };
}

/* ── What the pages are shown ─────────────────────────────────── */

export interface TemplateView {
  id: string;
  name: string;
  gameId: string;
  gameName: string;
  summary: string;
  sourceName: string | null;
  versionLabel: string | null;
  createdBy: string | null;
  createdAt: string;
  /** The game is no longer in the catalog, so the template cannot be used. */
  retired: boolean;
}

export async function templatesView(): Promise<TemplateView[]> {
  const rows = await db.serverTemplate.findMany({ orderBy: [{ gameId: "asc" }, { name: "asc" }] });
  const people = await db.user.findMany({ where: { id: { in: rows.map((r) => r.createdById).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  return rows.map((r) => {
    const game = findGame(r.gameId);
    return {
      id: r.id,
      name: r.name,
      gameId: r.gameId,
      gameName: game?.name ?? r.gameId,
      summary: summaryOf(r),
      sourceName: r.sourceName,
      versionLabel: r.versionLabel,
      createdBy: people.find((p) => p.id === r.createdById)?.name ?? null,
      createdAt: r.createdAt.toISOString(),
      retired: !game,
    };
  });
}

/* ── Starting the wizard from one ─────────────────────────────── */

/** What the create wizard opens with when it is told to start from a template or from a server. Plain data. */
export interface WizardStart {
  origin: { kind: "template" | "clone"; id: string; name: string };
  gameId: string;
  versionId: string;
  /** What changed about the version, to be said: a template saved on one the game has since retired. */
  versionNote: string | null;
  config: ConfigValues;
  memoryGb: number;
  cpuLimit: number;
  diskGb: number;
  /** A suggested name; empty to let the wizard leave it to the person. */
  name: string;
  /** For a clone: whether the world can be copied, and what to say when it cannot. */
  clone: { canCopyWorld: boolean; note: string } | null;
}

export async function templateStart(actor: User, id: string): Promise<WizardStart | null> {
  if (!mayManage(actor)) return null;
  const row = await db.serverTemplate.findUnique({ where: { id } });
  const game = row ? findGame(row.gameId) : undefined;
  if (!row || !game) return null;

  const fallback = defaultVersion(game);
  const version = startVersion(game, { versionSlug: row.versionSlug, versionLabel: row.versionLabel }, fallback);
  const line = game.versions.find((v) => v.id === version.id)?.line;
  const scoped = scopeToLine(game, line);
  return {
    origin: { kind: "template", id: row.id, name: row.name },
    gameId: game.id,
    versionId: version.id,
    versionNote: version.changed ? `${row.name} was saved on ${version.was ?? "a version"} that ${game.name} no longer offers, so it starts on ${fallback.label}.` : null,
    config: settingsToApply(scoped, row.config),
    memoryGb: row.memoryGb,
    cpuLimit: row.cpuLimit,
    diskGb: row.diskGb,
    name: "",
    clone: null,
  };
}

export async function cloneStart(actor: User, slug: string): Promise<WizardStart | null> {
  if (!mayManage(actor)) return null;
  const server = await db.server.findUnique({ where: { slug }, include: { gameVersionRef: { select: { slug: true } } } });
  const game = server?.gameId ? findGame(server.gameId) : undefined;
  if (!server || !game) return null;

  const fallback = defaultVersion(game);
  const version = versionOfServer(game, { versionSlug: server.gameVersionRef?.slug, versionLabel: server.version });
  const scoped = scopeToLine(game, version?.line);
  const offsite = (await offsiteTarget()) !== null;
  return {
    origin: { kind: "clone", id: server.slug, name: server.name },
    gameId: game.id,
    versionId: version?.id ?? fallback.id,
    versionNote: version ? null : `${server.name} is on ${server.version}, which ${game.name} no longer lists, so the copy starts on ${fallback.label}.`,
    config: settingsToClone(scoped, (server.config as Record<string, unknown> | null) ?? {}),
    memoryGb: server.memoryLimit,
    cpuLimit: server.cpuLimit,
    diskGb: server.diskQuota,
    name: `${server.name} copy`,
    clone: {
      canCopyWorld: offsite,
      note: offsite
        ? `The world is copied through the off-site bucket: a backup of ${server.name} is taken and put into the new server. It can take a while, and ${server.name} keeps running.`
        : "There is no off-site bucket, and the world travels through one. The copy gets this server's settings and a new world. Set a bucket up on the Backups page to copy the world too.",
    },
  };
}

/* ── The world ────────────────────────────────────────────────── */

/**
 * Puts a copy of one server's world into another of the same game: a backup of
 * the source into the bucket, then a restore of it into the target. Not atomic,
 * and it says so: the target exists already, with a world of its own, and a
 * failure here leaves it as it was — a working server with a new world — and
 * names what went wrong. Nothing is deleted.
 */
export async function cloneWorldOp(actor: User, sourceSlug: string, targetSlug: string): Promise<OpResult> {
  if (!mayManage(actor)) return refuse("Not permitted", "Only owners and admins can copy a world.");
  if (sourceSlug === targetSlug) return refuse("Cannot copy", "A server's world cannot be copied onto itself.");
  const [source, target] = await Promise.all([db.server.findUnique({ where: { slug: sourceSlug } }), db.server.findUnique({ where: { slug: targetSlug } })]);
  if (!source) return refuse("Cannot copy the world", "The server it was to be copied from no longer exists.");
  if (!target) return refuse("Cannot copy the world", "The new server no longer exists.");
  if (!source.gameId || source.gameId !== target.gameId) {
    return refuse("A different game", `${source.name} and ${target.name} do not run the same game, and a world of one is not a world of the other.`);
  }
  if ((await offsiteTarget()) === null) {
    return refuse("No off-site storage", `A world travels through the bucket, and none is set. ${target.name} keeps its new world. Set one up on the Backups page.`);
  }

  const taken = await createBackupOp(actor, sourceSlug, { store: "S3", prefix: "clone" });
  if (!taken.ok || !taken.backupId) {
    await record(actor, "server.cloned", target.name, "WARNING", { From: { from: "—", to: source.name }, World: { from: "—", to: "not copied" } }, target.id);
    return refuse("The world was not copied", `${target.name} was created with a new world. Taking a backup of ${source.name} failed: ${taken.body}`);
  }
  const restored = await restoreBackupOp(actor, taken.backupId, { into: targetSlug });
  if (!restored.ok) {
    await record(actor, "server.cloned", target.name, "WARNING", { From: { from: "—", to: source.name }, World: { from: "—", to: "not copied" } }, target.id);
    return refuse("The world was not copied", `${target.name} keeps the new world it was created with. The backup of ${source.name} is in the bucket, and putting it in failed: ${restored.body}`);
  }
  await record(actor, "server.cloned", target.name, "INFO", { From: { from: "—", to: source.name }, World: { from: "—", to: "copied" } }, target.id);
  return { ok: true, tone: "success", title: "World copied", body: `${target.name} now has ${source.name}'s world, from a backup taken just now. ${source.name} was not stopped.` };
}
