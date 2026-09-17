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

export interface SettingsLimits {
  /** The game's own bounds, from its definition. */
  memoryGb: [number, number];
  cpuLimit: [number, number];
  /** The most memory this server can have on its node, given the others there. */
  memoryAvailableGb: number | null;
}

export const DEFAULT_LIMITS: SettingsLimits = { memoryGb: [1, 64], cpuLimit: [50, 800], memoryAvailableGb: null };

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

  const [memMin, memMax] = limits.memoryGb;
  if (!Number.isInteger(input.memoryLimit) || input.memoryLimit < memMin || input.memoryLimit > memMax) {
    errors.memoryLimit = `A whole number of GB from ${memMin} to ${memMax} for this game.`;
  } else if (limits.memoryAvailableGb !== null && input.memoryLimit > limits.memoryAvailableGb) {
    errors.memoryLimit = `Its node has ${limits.memoryAvailableGb} GB left for this server once the others are counted.`;
  }

  const [cpuMin, cpuMax] = limits.cpuLimit;
  if (!Number.isInteger(input.cpuLimit) || input.cpuLimit < cpuMin || input.cpuLimit > cpuMax) {
    errors.cpuLimit = `From ${cpuMin}% to ${cpuMax}% of one core for this game.`;
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
