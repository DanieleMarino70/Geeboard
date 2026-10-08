/* The accounts the panel creates for itself.

   The scheduler attributes a 03:00 restart to an account rather than to
   whoever wrote the task, because nobody pressed anything at 03:00. That
   account is a row in the users table like any other, which is why the
   Members page listed it as an admin with an editable role and a remove
   button — a workspace could demote its own scheduler. */

export const SCHEDULER_EMAIL = "scheduler@geeboard.local";

const SYSTEM_EMAILS: readonly string[] = [SCHEDULER_EMAIL];

export function isSystemAccount(user: { email: string }): boolean {
  return SYSTEM_EMAILS.includes(user.email);
}

/* The names the panel's own work is written under in the audit log. An account that carried one would make a person's action read as the panel's, and the
   log names people by the name on their account (the audit of 0.9.5), so these are not names an account can have. */
export const RESERVED_ACTOR_NAMES: readonly string[] = [
  "Scheduler",
  "Watchdog",
  "Recovery",
  "Setup",
  "Updates",
  "Installer",
  "Node agent",
  "Catalog",
  "Operator",
  "System",
  "Geeboard",
];

/** A name as it is compared for being the same: case, spaces and accents set aside, so that `Mara  Kessler` and `mara kessler` are one. */
export function nameKey(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isReservedName(name: string): boolean {
  const key = nameKey(name);
  return RESERVED_ACTOR_NAMES.some((reserved) => nameKey(reserved) === key);
}
