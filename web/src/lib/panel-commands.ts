/* The commands the panel tells a person to type, in the form for the place it runs.

   A Docker installation — the supported one, made by deploy/linux/install-panel.sh — has no checkout of the
   panel's source, no npm and no `admin:recover` script: what it has is a verb on the image, run through
   Compose from the folder the installer ran from. A development checkout has the scripts. The image says which
   it is (docker-entrypoint.sh exports GEEBOARD_IN_IMAGE for every verb, `panel` included), and every sentence
   that names one of these commands asks here, so there is one place that knows.

   Seven messages used to say `npm run admin:recover` to everybody. The one a person reads when they have lost
   the way in told most of them to run something they did not have. */

const IMAGE_VERB = "docker compose -f deploy/panel/docker-compose.yml run --rm panel";

export function runsInImage(env: Record<string, string | undefined> = process.env): boolean {
  return env.GEEBOARD_IN_IMAGE === "1";
}

export interface CommandOptions {
  /** Which owner, when there is more than one. */
  email?: string;
  /** For tests and for callers that already know; read from the environment otherwise. */
  inImage?: boolean;
}

/** A new temporary password for an owner, made on the machine the panel runs on. */
export function recoveryCommand(options: CommandOptions = {}): string {
  const image = options.inImage ?? runsInImage();
  const email = options.email ? ` --email ${options.email}` : "";
  return image ? `${IMAGE_VERB} recover${email}` : `npm run admin:recover${email ? ` --${email}` : ""}`;
}

/** The first owner of an installation that has none. */
export function setupCommand(options: Pick<CommandOptions, "inImage"> = {}): string {
  return (options.inImage ?? runsInImage()) ? `${IMAGE_VERB} setup` : "npm run setup";
}

export interface LockedOutHelp {
  where: string;
  /** What to type there: the first owner's setup, or a new password for an owner. */
  command: string;
  noOwnerYet: boolean;
}

/* What the sign-in page tells somebody who cannot get in. An installation that has nobody yet says how to make the
   first owner, and one that has people says how the owner gets a new password. Both are commands on the machine the
   panel runs on, so a stranger learns nothing from them that the documentation does not say, and a person who has just
   installed and lost the one-day temporary password has somewhere to go that is not "ask an admin", who is the
   person asking. `people` counts accounts that are people: the scheduler's own is not one. */
export function lockedOutHelp(people: number, options: Pick<CommandOptions, "inImage"> = {}): LockedOutHelp {
  return {
    where: whereToRun(options),
    command: people === 0 ? setupCommand(options) : recoveryCommand(options),
    noOwnerYet: people === 0,
  };
}

/* Where the command is typed, said once and the same everywhere: it is not the browser's machine, and for the
   image it is the folder the installer ran from, because the compose file is named relative to it. */
export function whereToRun(options: Pick<CommandOptions, "inImage"> = {}): string {
  return (options.inImage ?? runsInImage())
    ? "On the machine the panel runs on, in the folder you installed it from,"
    : "On the machine the panel runs on, from the web folder of the checkout,";
}
