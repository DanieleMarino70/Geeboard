import "server-only";
import { Prisma } from "@prisma/client";
import type { InstallProgress, InstallStep, ProgressReporter } from "@/domain/games/install";
import { downloadPercent } from "@/domain/runtime/download";
import type { RuntimeDownload } from "@/domain/runtime/types";
import { db } from "./db";

/* Where an install has got to, for whoever is waiting on it.

   The create wizard asks, and so do the update, rollback and rebuild
   buttons: each makes up a key, sends it with its call, and asks
   /api/install-progress about that key while the call is still running.
   The answer is on the server's row — the step, its sentence, and while
   downloading the layers and bytes the node counted — and in the activity
   log once per step, for afterwards. Not once per reading of a download,
   which would be a line every second and a half for as long as it took. */

export const PROGRESS_KEY = /^[A-Za-z0-9-]{16,64}$/;

export interface InstallProgressView {
  step: string;
  message: string;
  server: string;
  /** What the node counted, while downloading. */
  download: RuntimeDownload | null;
  /** 0–100 when the node's numbers support a bar, null when a bar would be a guess. */
  percent: number | null;
}

/* How a step is said in a sentence about where something failed. Empty
   for the download, whose failure already says it was one. */
export const STEP_WORDS: Record<InstallStep, string> = {
  prepare: "while preparing",
  download: "",
  provision: "while creating it on the node",
  configure: "while writing its settings",
  start: "while starting it",
};

export async function installProgressOf(key: string): Promise<InstallProgressView | null> {
  if (!PROGRESS_KEY.test(key)) return null;
  const server = await db.server.findUnique({
    where: { installKey: key },
    select: { name: true, installStep: true, installMessage: true, installDetail: true },
  });
  if (!server?.installStep) return null;
  const download = (server.installDetail as unknown as RuntimeDownload | null) ?? null;
  return {
    step: server.installStep,
    message: server.installMessage ?? "",
    server: server.name,
    download,
    percent: download ? downloadPercent(download) : null,
  };
}

/* Puts a key on a server so its progress can be asked about. Allowed to
   fail: a key somebody reused is a page with no progress to show, not an
   install that cannot run. */
export async function beginProgress(serverId: string, key: string | undefined, step: InstallStep, message: string) {
  if (!key || !PROGRESS_KEY.test(key)) return;
  await db.server
    .update({ where: { id: serverId }, data: { installKey: key, installStep: step, installMessage: message, installDetail: Prisma.DbNull } })
    .catch(() => {});
}

export async function endProgress(serverId: string) {
  await db.server
    .update({
      where: { id: serverId },
      data: { installKey: null, installStep: null, installMessage: null, installDetail: Prisma.DbNull },
    })
    .catch(() => {});
}

/* A reporter that records progress where somebody can see it.

   Best-effort by design: an install that worked must not be reported as
   failed because writing a progress row did not. */
export function installReporter(serverId: string): ProgressReporter {
  let lastStep: InstallStep | null = null;
  return async (progress: InstallProgress) => {
    await db.server
      .update({
        where: { id: serverId },
        data: {
          installStep: progress.step,
          installMessage: progress.message,
          installDetail: progress.download ? (progress.download as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      })
      .catch(() => {});
    if (progress.step === lastStep) return;
    lastStep = progress.step;
    await db.activityEvent
      .create({
        data: { actor: "Installer", action: `server.install.${progress.step}`, target: progress.message, tone: "INFO", serverId },
      })
      .catch(() => {});
  };
}
