import { checkEnvironment } from "@/lib/env-check";

/* What the panel needs before it takes a request — see lib/env-check.ts.

   A production panel with a missing, short or example secret does not
   start: it says what is wrong and exits, rather than coming up and
   failing at the first sign-in — or worse, not failing, and signing
   sessions with a secret printed in a public repository. In development
   the same problems are printed and the server carries on, because a
   half-configured checkout should still show its pages. */
const { problems, warnings } = checkEnvironment(process.env);
for (const warning of warnings) console.warn(`geeboard: ${warning}`);

if (problems.length > 0) {
  for (const problem of problems) console.error(`geeboard: ${problem}`);
  if (process.env.NODE_ENV === "production") {
    console.error("geeboard: refusing to start. `npm run setup:env` writes a .env with generated secrets.");
    process.exit(1);
  }
}
