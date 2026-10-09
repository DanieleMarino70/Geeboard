import "server-only";
import type { PanelUpdateRequest, User } from "@prisma/client";
import { compareVersions } from "@/domain/updates/release";
import { verifyFreshCodeOp } from "./account-ops";
import { db } from "./db";
import { readUpdateStatus } from "./panel-update-ops";
import type { OpResult } from "./server-ops";
import { PANEL_VERSION } from "./version";

/* The Updates page's button.

   The panel cannot upgrade itself: it runs in a container, and an upgrade stops that container, takes a dump of the database,
   migrates it and starts a new image. So the button does not upgrade anything. It writes a request, and the machine's updater
   (deploy/linux/self-update.sh, a systemd timer the installer sets) reads it once a minute and runs the installer for that
   release, as an owner would by hand, and writes back how it went.

   What the button may ask for is narrow on purpose: the newest release the panel has read, only when it is newer than what runs,
   only by an owner, with a fresh code from the authenticator, and only when the machine's updater has been seen lately. The
   updater holds it again on its side: a tag of the checkout's own origin, newer than what runs. */

/** How long since the updater last looked before the page says this machine has none running. */
const UPDATER_ALIVE_MS = 5 * 60_000;
/** A request the updater claimed and has not finished by then is reported as stuck rather than still running. */
const STUCK_MS = 60 * 60_000;

export interface SelfUpdateView {
  /** Whether this machine's updater has looked for a request lately; when it last did. */
  updater: { alive: boolean; seenAt: Date | null };
  /** The release the button would ask for, or null with the reason it would not. */
  offer: { version: string } | null;
  why: string | null;
  /** The last request, whatever became of it. */
  last: (Pick<PanelUpdateRequest, "id" | "version" | "fromVersion" | "requestedBy" | "requestedAt" | "startedAt" | "finishedAt" | "log"> & {
    state: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "REFUSED" | "STUCK";
  }) | null;
}

export async function selfUpdateView(): Promise<SelfUpdateView> {
  const status = await readUpdateStatus();
  let seenAt: Date | null = null;
  let last: PanelUpdateRequest | null = null;
  try {
    seenAt = (await db.updateCheck.findUnique({ where: { id: "panel" }, select: { updaterSeenAt: true } }))?.updaterSeenAt ?? null;
    last = await db.panelUpdateRequest.findFirst({ orderBy: { requestedAt: "desc" } });
  } catch {
    return { updater: { alive: false, seenAt: null }, offer: null, why: "This database has not been migrated to the release that has the button.", last: null };
  }
  const alive = seenAt !== null && Date.now() - seenAt.getTime() < UPDATER_ALIVE_MS;
  const open = last && (last.state === "PENDING" || last.state === "RUNNING");
  const stuck = last && last.state === "RUNNING" && last.startedAt && Date.now() - last.startedAt.getTime() > STUCK_MS;

  const newest = status.release?.version ?? null;
  let why: string | null = null;
  if (!newest) why = "The panel has not read a release file yet.";
  else if ((compareVersions(newest, PANEL_VERSION) ?? 0) <= 0) why = "This panel runs the newest release.";
  else if (open && !stuck) why = `An upgrade to ${last!.version} is already ${last!.state === "PENDING" ? "waiting for the machine" : "running"}.`;
  else if (!alive)
    why = seenAt
      ? "This machine's updater has not looked for a request in the last five minutes: its timer is stopped, or the machine is busy."
      : "This machine has no updater yet. It comes with the installer of the release that has this button: run the installer once by hand, and from then on this button works.";

  return {
    updater: { alive, seenAt },
    offer: why ? null : { version: newest! },
    why,
    last: last ? { ...last, state: (stuck ? "STUCK" : last.state) as NonNullable<SelfUpdateView["last"]>["state"] } : null,
  };
}

export async function requestPanelUpdateOp(user: User, version: string, code: string): Promise<OpResult> {
  if (user.role !== "OWNER") return { ok: false, title: "Owners only", body: "Upgrading the panel is an owner's decision." };
  const view = await selfUpdateView();
  if (!view.offer) return { ok: false, title: "Not now", body: view.why ?? "There is nothing to upgrade to." };
  if (view.offer.version !== version) {
    return { ok: false, title: "The newest release changed", body: `The newest release is ${view.offer.version} now. Reload the page and ask again.` };
  }
  const fresh = await verifyFreshCodeOp(user, String(code ?? "").trim(), "upgrading the panel");
  if (!fresh.ok) return fresh;

  await db.panelUpdateRequest.create({
    data: { version, fromVersion: PANEL_VERSION, requestedById: user.id, requestedBy: user.name },
  });
  await db.activityEvent.create({
    data: {
      actor: user.name,
      userId: user.id,
      action: "panel.upgrade.requested",
      target: `Geeboard ${version}`,
      tone: "WARNING",
      changes: { Version: { from: PANEL_VERSION, to: version } },
    },
  });
  return {
    ok: true,
    tone: "warning",
    title: `Upgrading to ${version}`,
    body: "The machine picks it up within a minute. The panel stops for a few minutes while the installer takes a dump, migrates and starts the new release; this page comes back by itself.",
  };
}
