import { PlatformError, asPlatformError } from "../errors";
import type { IGameRuntime, ProvisionPlan, RuntimeRef, RuntimeState } from "../runtime/types";
import { applyPatch, type ConfigFilePatch } from "./config";
import type { GameDefinition, InstallStrategy } from "./types";

/* Bringing a game server into existence.

   Provisioning is one step of this, not the whole of it. A server that
   exists but has never had its configuration written is a server running
   somebody else's defaults, and for a game configured by file — Terraria,
   Zomboid — that is every setting the operator chose.

   So the sequence is: prepare, provision **stopped**, write the config,
   then start. Starting last is the whole point. A game reads its config
   once at boot; writing it into a running server changes nothing until
   the next restart, and doing that on the first boot would mean every
   new server ignored its own template. */

export type InstallStep = "prepare" | "provision" | "configure" | "start";

export interface InstallProgress {
  step: InstallStep;
  /** Written for a person watching a server being created. */
  message: string;
  /** 0–100 across the whole install, for a progress bar. */
  percent: number;
}

export type ProgressReporter = (progress: InstallProgress) => void | Promise<void>;

export interface InstallContext {
  game: GameDefinition;
  runtime: IGameRuntime;
  plan: ProvisionPlan;
  /** What has to be on disk before the first start. */
  files: ConfigFilePatch[];
  report: ProgressReporter;
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
   the image carries the server, and fetching it is the runtime's job and
   already bounded by the node agent's pull timeout. */
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

  try {
    await ctx.report({ step: "prepare", message: `Preparing ${ctx.game.name}`, percent: 5 });
    await installer.prepare(ctx);

    await ctx.report({
      step: "provision",
      message: "Fetching server files",
      percent: 20,
    });
    /* Provisioned stopped, whatever the caller asked for. The start
       happens below, after the configuration is in place. */
    const provisioned = await ctx.runtime.provision({ ...ctx.plan, start: false });
    ref = { serverId: ctx.plan.serverId, runtimeId: provisioned.id };

    const filesWritten = await writeConfigFiles(ctx, ref);

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
         to reach both. */
      await ctx.runtime
        .destroy({ serverId: ctx.plan.serverId, runtimeId: ref.runtimeId }, true)
        .catch(() => {});
    }
    throw asInstallFailure(error);
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
function asInstallFailure(error: unknown): PlatformError {
  const platform = asPlatformError(error);
  if (platform.code === "SERVER_INSTALLATION_FAILED") return platform;

  return new PlatformError("SERVER_INSTALLATION_FAILED", platform.message, {
    details: { ...platform.details, cause: platform.code },
    cause: platform.cause ?? platform,
  });
}
