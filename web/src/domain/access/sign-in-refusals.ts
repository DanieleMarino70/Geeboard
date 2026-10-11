/* A sign-in the panel turned away, as a line in the audit log (0.11.0; before it a refusal was a sentence on the form and nothing else, so
   an owner could not see that somebody was working through passwords, or using up an account's code tries — docs/limitations.md).

   The line is `account.signin.refused`, written under the actor `Sign-in` (a name no account can take, lib/system-user.ts) and not under
   the account that was tried: whoever typed the password is not known to be that person, and the API's `actorId` says who did a thing.
   Its target is the address that was typed, its reason is in `changes`, and the client's address is the row's `ip`. Never the password,
   nor the code.

   What bounds it. Each refusal is written after the attempt limits have counted it (thirty a quarter hour per source, ten per address
   per source, five codes per account in five minutes: app/actions/auth.ts, lib/account-ops.ts), and a form that is not an address and a
   password is turned away before any counter and recorded nowhere. Past a limit, the "too many attempts" that every further request
   gets is written once per source and window, not once per request. And over all of them, the panel writes at most
   REFUSAL_LINES_PER_WINDOW in a quarter hour, then one line that says it has stopped, until the quarter is out: an attacker with a
   thousand addresses fills no more than that. */

import { createAttemptCounter } from "./attempt-counter";

export const SIGN_IN_REFUSED = "account.signin.refused";
export const SIGN_IN_ACTOR = "Sign-in";

export const SIGN_IN_REFUSALS = {
  "unknown-address": "No account has that address",
  "wrong-password": "Wrong password",
  "temporary-password-expired": "Temporary password expired",
  "too-many-attempts": "Too many attempts",
  "wrong-code": "Wrong two-factor code",
  "code-reused": "Two-factor code already used",
  "too-many-codes": "Too many two-factor codes",
  "too-many-refusals": "Too many refusals to record",
} as const;
export type SignInRefusal = keyof typeof SIGN_IN_REFUSALS;

export const REFUSAL_WINDOW_MS = 15 * 60_000;
export const REFUSAL_LINES_PER_WINDOW = 300;

export type RefusalDecision = "write" | "stopped" | "skip";

/* Whether a refusal is written: "write", or "stopped" for the one line that says the ceiling was reached, or "skip". `once` is a key
   (fixed in size, a hash and a source) whose refusal is written at most once a window: the "too many attempts" every request past a
   limit gets. Its own counter, and the ceiling a count and not a key, so that the keys a stranger makes for the sign-in limits cannot
   push either out. Per process, like those limits. */
export function createRefusalLedger(options: { limit?: number; windowMs?: number; now?: () => number } = {}) {
  const limit = options.limit ?? REFUSAL_LINES_PER_WINDOW;
  const windowMs = options.windowMs ?? REFUSAL_WINDOW_MS;
  const clock = options.now ?? Date.now;
  const onceKeys = createAttemptCounter({ now: clock });
  let windowEnds = 0;
  let written = 0;
  let stopped = false;
  return {
    decide(once?: string): RefusalDecision {
      const now = clock();
      if (now >= windowEnds) {
        windowEnds = now + windowMs;
        written = 0;
        stopped = false;
      }
      if (once !== undefined && !onceKeys.attempt(once, 1, windowMs)) return "skip";
      if (written < limit) {
        written++;
        return "write";
      }
      if (stopped) return "skip";
      stopped = true;
      return "stopped";
    },
    /** When lines are written again after "stopped". */
    resumesAt: () => new Date(windowEnds),
  };
}

/** The address as it is kept: lower case, trimmed, and no longer than an address can be. */
export function triedAddress(email: string): string {
  return email.trim().toLowerCase().slice(0, 254);
}

/** The audit line's readable name, where it has one; the Audit page shows the action itself otherwise. */
export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  [SIGN_IN_REFUSED]: "Sign-in refused",
};
