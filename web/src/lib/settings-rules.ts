/* What a server's platform settings may be. Pure, so the settings form
   checks a value as it is typed with the same rules the save applies.

   These are the settings the platform itself acts on: the name, the
   address shown to players, the resource limits the workload is given,
   and the crash policy. What a game reads — its MOTD, its whitelist —
   is in the game's own settings below them, generated from its
   definition. The form used to carry an MOTD, Java startup flags, an
   autosave switch and a whitelist switch here too: they were saved and
   never reached any game. */

export type RestartPolicyId = "NEVER" | "ON_FAILURE" | "ALWAYS";

export interface SettingsInput {
  name: string;
  host: string;
  memoryLimit: number;
  cpuLimit: number;
  restartPolicy: RestartPolicyId;
  maxRestarts: number;
}

export type SettingsErrors = Partial<Record<keyof SettingsInput, string>>;

/* What is allowed and worth saying anyway. Shown beside the field, in the
   wizard and on the settings form, and never blocking a save. */
export type SettingsWarnings = Partial<Record<keyof SettingsInput, string>>;

export interface SettingsLimits {
  /** The game's own bounds, from its definition. */
  memoryGb: [number, number];
  cpuLimit: [number, number];
  /** The most memory this server can have on its node, given the others there. */
  memoryAvailableGb: number | null;
  /* What the game says it needs. Advice, not a bound: an operator may go
     under it deliberately — see PLATFORM_FLOOR. Null for a game the
     catalogue has nothing to say about. */
  recommended?: { memoryGb: number; cpuLimit: number } | null;
}

/* Below this a container is not a server at all, whatever the game is:
   no game runs in half a gigabyte, and a CPU ceiling under half a core
   cannot start one.

   Above it and under the game's own minimum is the operator's to decide.
   A game's `memoryGbMin` is what its publisher and this catalogue think
   it wants, measured on somebody else's hardware with somebody else's
   player count — and it used to be the floor of the slider, so a person
   who wanted a four-gigabyte Zomboid for three friends could not have
   one, and a person who wanted to see what would happen could not find
   out. Now they can, and the panel says what it thinks first. */
export const PLATFORM_FLOOR = { memoryGb: 1, cpuLimit: 50 } as const;

export const DEFAULT_LIMITS: SettingsLimits = {
  memoryGb: [1, 64],
  cpuLimit: [50, 800],
  memoryAvailableGb: null,
  recommended: null,
};

export const SETTINGS_LABELS: Record<keyof SettingsInput, string> = {
  name: "Server name",
  host: "Address",
  memoryLimit: "Memory limit",
  cpuLimit: "CPU limit",
  restartPolicy: "Restart policy",
  maxRestarts: "Restart attempts",
};

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/i;

export function validateSettings(input: SettingsInput, limits: SettingsLimits = DEFAULT_LIMITS): SettingsErrors {
  const errors: SettingsErrors = {};
  const name = input.name.trim();
  if (name.length < 2) errors.name = "At least two characters.";
  else if (name.length > 60) errors.name = "Keep it to 60 characters.";

  if (!HOSTNAME.test(input.host.trim())) {
    errors.host = "A hostname, like play.example.com — no scheme, port or path.";
  }

  /* The lower bound is the platform's, not the game's: under the game's
     own minimum is a warning, below, and not an error. The upper bound
     stays the game's — a ceiling above what a game can use is not a
     decision anybody benefits from making. */
  const memMax = limits.memoryGb[1];
  if (
    !Number.isInteger(input.memoryLimit) ||
    input.memoryLimit < PLATFORM_FLOOR.memoryGb ||
    input.memoryLimit > memMax
  ) {
    errors.memoryLimit = `A whole number of GB from ${PLATFORM_FLOOR.memoryGb} to ${memMax} for this game.`;
  } else if (limits.memoryAvailableGb !== null && input.memoryLimit > limits.memoryAvailableGb) {
    errors.memoryLimit = `Its node has ${limits.memoryAvailableGb} GB left for this server once the others are counted.`;
  }

  const cpuMax = limits.cpuLimit[1];
  if (
    !Number.isInteger(input.cpuLimit) ||
    input.cpuLimit < PLATFORM_FLOOR.cpuLimit ||
    input.cpuLimit > cpuMax
  ) {
    errors.cpuLimit = `From ${PLATFORM_FLOOR.cpuLimit}% to ${cpuMax}% of one core for this game.`;
  }

  if (!["NEVER", "ON_FAILURE", "ALWAYS"].includes(input.restartPolicy)) {
    errors.restartPolicy = "Choose what happens when it stops.";
  }
  /* A ceiling of zero would be a policy that restarts nothing while
     claiming to, and an unbounded one is how a broken server spends the
     night starting and dying. */
  if (!Number.isInteger(input.maxRestarts) || input.maxRestarts < 1 || input.maxRestarts > 10) {
    errors.maxRestarts = "From 1 to 10 attempts.";
  }
  return errors;
}

/* What the game asked for and did not get.

   Separate from validateSettings on purpose: one says what may not be
   saved, the other what the operator should know before saving it. A
   value under a game's own minimum is the second kind — the server will
   be created, started and run, and it may well fall over under load,
   which is a thing to be told rather than prevented from trying. */
export function settingsWarnings(
  input: Pick<SettingsInput, "memoryLimit" | "cpuLimit">,
  limits: SettingsLimits = DEFAULT_LIMITS,
): SettingsWarnings {
  const warnings: SettingsWarnings = {};
  const wants = limits.recommended;
  if (!wants) return warnings;

  if (input.memoryLimit < wants.memoryGb) {
    warnings.memoryLimit =
      `This game asks for ${wants.memoryGb} GB. With ${input.memoryLimit} it may fail to start, ` +
      "or run until the world grows and then stop.";
  }
  if (input.cpuLimit < wants.cpuLimit) {
    warnings.cpuLimit =
      `This game asks for ${wants.cpuLimit}% of a core. With ${input.cpuLimit}% it will run, ` +
      "slowly, and fall behind when players are on.";
  }
  return warnings;
}
