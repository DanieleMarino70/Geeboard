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
