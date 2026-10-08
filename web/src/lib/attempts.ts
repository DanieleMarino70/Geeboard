import "server-only";
import { createAttemptCounter } from "@/domain/access/attempt-counter";

/* Attempt limiting for the places a password or a code is guessed:
   sign-in, the second factor, a setup link.

   Per process, like the API's rate limit, and honest about it — see
   docs/security.md "Known gaps". Behind one panel instance, which is
   how Geeboard runs today, it bounds a guessing script to a handful of
   tries a minute; behind several it bounds each instance. A code with a
   million possibilities and a thirty-second life needs exactly this
   kind of ceiling to mean anything. The counter, and the ceiling on how
   many keys it holds, are in domain/access/attempt-counter.ts. */

const counter = createAttemptCounter();

/** True when one more attempt under `key` is allowed; counts it either way. */
export const attempt = counter.attempt;

/* Whether `key` has already used its `limit`, without counting this look. For a route that has to say no before it
   does any work: the count is added afterwards, for the tries that failed. */
export const exhausted = counter.exhausted;

/** Forgets a key: a success ends the count against it. */
export const clearAttempts = counter.clear;
