import { PlatformError, asPlatformError } from "../errors";
import { downloadSentence } from "../runtime/download";
import type { IGameRuntime, ProvisionPlan, RuntimeDownload, RuntimeRef, RuntimeState } from "../runtime/types";
import { applyPatch, type ConfigFilePatch } from "./config";
import type { GameDefinition, InstallStrategy } from "./types";

/* Bringing a game server into existence.

   Provisioning is one step of this, not the whole of it. A server that
   exists but has never had its configuration written is a server running
   somebody else's defaults, and for a game configured by file — Terraria,
   Zomboid — that is every setting the operator chose.

   So the sequence is: prepare, download, provision **stopped**, write the
   config, then start. Starting last is the whole point. A game reads its
   config once at boot; writing it into a running server changes nothing
   until the next restart, and doing that on the first boot would mean
   every new server ignored its own template.

   Downloading is a step of its own because it is the one whose length
   is somebody else's network — minutes, for a ten-gigabyte build on a
   node that has not run it before — and the node now says how far it has
   got, so the person waiting can be told. */

export type InstallStep = "prepare" | "download" | "provision" | "configure" | "start";

export interface InstallProgress {
  step: InstallStep;
  /** Written for a person watching a server being created. */
  message: string;
  /** 0–100 across the whole install, for a progress bar. */
  percent: number;
  /** While downloading: what the node counted, for a bar of its own. */
  download?: RuntimeDownload;
}

export type ProgressReporter = (progress: InstallProgress) => void | Promise<void>;

export interface InstallContext {
  game: GameDefinition;
  runtime: IGameRuntime;
  plan: ProvisionPlan;
  /** What has to be on disk before the first start. */
  files: ConfigFilePatch[];
  report: ProgressReporter;
  /* The server's directory already holds a world — an update, a rollback,
     a settings rebuild — so a failure must take away only the workload
     it made. Absent or false means a new server, whose directory was made
     by this install and goes with it. */
  existingData?: boolean;
  /* False leaves the configured workload stopped: a rebuild of a server
     that was stopped. Starting it only to stop it again cost a Terraria
     rebuild thirty seconds — the server ignores the signal, so the stop
     waits out its grace and kills it, mid-boot. Absent means start. */
  start?: boolean;
}

export interface InstallResult {
  ref: RuntimeRef;
  /** What the runtime reported once the server was started. */
  state: RuntimeState;
  startedAt: string | null;
  /** How many config files were written. */
  filesWritten: number;
}

/* ── Installers ───────────────────────────────────────────────────
   One per install strategy. They differ only in `prepare` — the work
   that has to happen before a workload exists — because everything
   after that point is the same sequence for every game. */

export interface IGameInstaller {
  readonly kind: InstallStrategy["kind"];
  /** Runs before provisioning. May be nothing. */
  prepare(ctx: InstallContext): Promise<void>;
}

/* The maintained-build strategy. There is genuinely nothing to prepare:
   the image carries the server, and fetching it is the download step —
   the runtime's job, watched rather than timed. */
const imageInstaller: IGameInstaller = {
  kind: "image",
  async prepare() {},
};

/* SteamCMD. Also nothing to prepare today, and that is worth saying
   rather than leaving to be inferred: every Steam game shipped so far
   runs an image that performs the SteamCMD fetch itself on first boot.
   The strategy is still declared on the definition because placement has
   to know the node needs SteamCMD — an image doing the fetching does not
   change what the machine must be able to do.

   When a node-side installer exists, this is where the app id, the
   branch and the anonymous login get used. */
const steamCmdInstaller: IGameInstaller = {
  kind: "steamcmd",
  async prepare() {},
};

/* Fetching an archive and unpacking it is node-side work with no node
   API behind it yet. Refusing loudly beats a server that provisions and
   then has no game in it. */
const downloadInstaller: IGameInstaller = {
  kind: "download",
  async prepare(ctx) {
    throw new PlatformError(
      "SERVER_INSTALLATION_FAILED",
      `Geeboard cannot yet install ${ctx.game.name} from a direct download.`,
      { details: { step: "prepare", gameId: ctx.game.id } },
    );
  },
};

const INSTALLERS: Record<InstallStrategy["kind"], IGameInstaller> = {
  image: imageInstaller,
  steamcmd: steamCmdInstaller,
  download: downloadInstaller,
};

export function installerFor(strategy: InstallStrategy): IGameInstaller {
  return INSTALLERS[strategy.kind];
}

/* ── The sequence ─────────────────────────────────────────────────── */

/* Runs an install to completion, or throws having left nothing behind.

   Every failure after provisioning destroys what was made. A server that
   exists in the runtime but not in the panel is invisible, holds a port,
   and cannot be cleaned up from the panel — which is the worst outcome
   available, and worse than the failure that caused it. */
export async function installServer(ctx: InstallContext): Promise<InstallResult> {
  const installer = installerFor(ctx.game.install);
  let ref: RuntimeRef | null = null;
  // Where a failure happened, kept here rather than read back from what was reported.
  let at: InstallStep = "prepare";

  try {
    await ctx.report({ step: "prepare", message: `Preparing ${ctx.game.name}`, percent: 5 });
    await installer.prepare(ctx);

    /* Nothing exists on the node yet, so a download that fails leaves
       nothing to undo: `ref` is still null below. The step is the node's
       to report: a build it already has goes straight on to creating the
       server, and an update — which downloaded before its backup — does
       not show a second download after it. */
    at = "download";
    await ctx.runtime.fetchSource(ctx.plan.source, (download) =>
      ctx.report({ step: "download", message: downloadSentence(download), percent: 10, download }),
    );

    at = "provision";
    await ctx.report({
      step: "provision",
      message: "Creating the server",
      percent: 20,
    });
    /* Provisioned stopped, whatever the caller asked for. The start
       happens below, after the configuration is in place. */
    const provisioned = await ctx.runtime.provision({ ...ctx.plan, start: false });
    ref = { serverId: ctx.plan.serverId, runtimeId: provisioned.id };

    at = "configure";
    const filesWritten = await writeConfigFiles(ctx, ref);

    if (ctx.start === false) {
      return { ref, state: provisioned.state, startedAt: null, filesWritten };
    }

    at = "start";
    await ctx.report({ step: "start", message: "Starting the server", percent: 90 });
    const started = await ctx.runtime.start(ref);

    return {
      ref,
      state: started.state,
      startedAt: started.startedAt,
      filesWritten,
    };
  } catch (error) {
    if (ref) {
      /* By server id, not by workload: a provision that failed partway
         may have left a directory with no workload, and the destroy has
         to reach both.

         The data only for a new server. This used to remove the
         directory on every failure, and the installer is also what an
         update, a rollback and a settings rebuild run around an existing
         world — so a server whose new workload would not start (a host
         port taken, a config file too large to edit) lost its world, and
         with it the locked pre-update backup the rollback depended on. */
      await ctx.runtime
        .destroy({ serverId: ctx.plan.serverId, runtimeId: ref.runtimeId }, !ctx.existingData)
        .catch(() => {});
    }
    throw asInstallFailure(error, at);
  }
}

/* Writes each config file the game needs, merging rather than replacing.

   Reading first matters. A fresh server has no config file and the read
   fails, which is the ordinary case and produces an empty document to
   merge into. A server being reconfigured has one the game has already
   written to, and replacing it would discard the world seed it picked
   and any setting an admin changed in-game. */
export async function writeConfigFiles(ctx: InstallContext, ref: RuntimeRef): Promise<number> {
  if (ctx.files.length === 0) return 0;

  let written = 0;
  for (const [index, patch] of ctx.files.entries()) {
    await ctx.report({
      step: "configure",
      message: `Writing ${patch.path}`,
      percent: 40 + Math.round(((index + 1) / ctx.files.length) * 45),
    });

    let existing = "";
    try {
      const file = await ctx.runtime.files.read(ref, patch.path);
      /* A file too large to read is a file we must not rewrite from an
         empty document — that would delete it. */
      if (file.truncated) {
        throw new PlatformError(
          "SERVER_INSTALLATION_FAILED",
          `${patch.path} is too large for Geeboard to edit safely.`,
          { details: { step: "configure", file: patch.path } },
        );
      }
      existing = file.content;
    } catch (error) {
      // Not there yet is the normal case on a new server.
      const platform = asPlatformError(error);
      if (platform.code !== "NOT_FOUND") throw platform;
    }

    await ctx.runtime.files.write(ref, patch.path, applyPatch(patch, existing));
    written++;
  }
  return written;
}

/* Anything that goes wrong here is an installation failure, and says
   which step it failed at — which is the one detail that makes the
   difference between a message an operator can act on and one they
   cannot. */
/* Every install failure names its step: the one the error names itself,
   or else the one the install had reached. A create that fails leaves a
   line in the audit log saying where, and a line with no step was the
   usual case — only a failed download carried one. */
function asInstallFailure(error: unknown, at: InstallStep): PlatformError {
  const platform = asPlatformError(error);
  if (platform.code === "SERVER_INSTALLATION_FAILED" && platform.details?.step) return platform;

  return new PlatformError("SERVER_INSTALLATION_FAILED", platform.message, {
    details: {
      step: at,
      ...platform.details,
      ...(platform.code === "SERVER_INSTALLATION_FAILED" ? {} : { cause: platform.code }),
    },
    cause: platform.cause ?? platform,
  });
}
