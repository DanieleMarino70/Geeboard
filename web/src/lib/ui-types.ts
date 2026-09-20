/* Shared presentation vocabulary, safe to import from client
   components (unlike queries.ts, which is server-only). */
export type Tone = "success" | "warning" | "danger" | "info" | "accent" | "muted";

/* What the shell shows of the signed-in person, and nothing else.

   The shell is a client component, so whatever it is handed is
   serialised into the payload the browser receives. Every page used to
   hand it the whole `User` row it had from requireUser — which made
   `passwordHash` and the encrypted `totpSecret` part of the HTML of
   every page in the panel. TypeScript allowed it, because a row with
   more fields is assignable to a type with fewer; only reading the bytes
   on the wire showed it.

   Here rather than in shell.tsx so that a test can import it without
   pulling in the server actions the shell uses; shell.tsx re-exports
   both. test/shell-user.test.ts fails if a page passes a row again. */
export interface ShellUser {
  name: string;
  initials: string;
  role: string;
}

export function shellUser(user: { name: string; initials: string; role: string }): ShellUser {
  return { name: user.name, initials: user.initials, role: user.role };
}
