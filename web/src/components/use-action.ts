"use client";

import { unstable_rethrow } from "next/navigation";
import { useCallback, useTransition } from "react";
import { useToast } from "./toast";

/* What to say when an action never came back.

   A button that calls a server action runs it inside a transition, and when the call itself fails (the connection was cut, the panel was
   restarted under it, the session ended between the click and the answer) the promise rejects. React hands that to the nearest error
   boundary, so the page was replaced with "This page could not be shown", or, where a component had a catch of its own, nothing happened
   at all. Thirty of the thirty-four components that call an action had no catch.

   The sentence does not say the action failed, because it may not have: the request can have arrived and the answer been lost. It says
   what is known, and where to look. */
export const LOST_CONTACT = {
  tone: "danger",
  title: "The panel did not answer",
  body: "Nothing on this page was changed, and it is not known whether the panel did what you asked. Check your connection and the Activity page before you try again.",
} as const;

/** A call that is not an answer: the network, the server's own failure. Next's redirects and not-found are not, and go on to be what they are. */
export function lostContact(error: unknown) {
  unstable_rethrow(error);
  return LOST_CONTACT;
}

/* A form action (the kind `useActionState` takes) that cannot end the page: when the call never came back, the form is given the
   state it already knows how to show for a refusal, with the sentence for it. Not for the redirects an action ends in. */
export function guarded<S>(
  action: (previous: S, data: FormData) => Promise<S>,
  failed: (previous: S, data: FormData) => S,
): (previous: S, data: FormData) => Promise<S> {
  return async (previous, data) => {
    try {
      return await action(previous, data);
    } catch (error) {
      unstable_rethrow(error);
      return failed(previous, data);
    }
  };
}

/* Used where `useTransition` was, with the same two values and the same way of being called: the second is called with what to run, and
   a failure to reach the panel is a message that stays until it is dismissed (see the toast) instead of an error page. */
export function useAction(): [boolean, (action: () => void | Promise<void>) => void] {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const run = useCallback(
    (action: () => void | Promise<void>) => {
      start(async () => {
        try {
          await action();
        } catch (error) {
          push(lostContact(error));
        }
      });
    },
    [push],
  );
  return [pending, run];
}
