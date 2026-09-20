/* What the panel needs from its environment before it should start, and
   what is wrong with what it was given. Pure: the same answer for the
   server at boot, for `npm run setup`, and for a test.

   The secrets used to be checked where they were first used — a session
   signed, a node token encrypted — so a panel with none started happily
   and fell over at the first sign-in. And `.env.example` shipped with
   `generate-with-openssl-rand-base64-32` in both, which is thirty-six
   characters: long enough to pass, and printed in a public repository.
   A panel following its own README was signing sessions with a secret
   everybody has. */

export const SECRET_MIN = 32;

/* Strings that are instructions rather than secrets. Anything that reads
   like the example file, a tutorial, or a keyboard. */
const PLACEHOLDER = /(generate|change[-_ ]?me|example|placeholder|your[-_ ]?secret|openssl|xxxx|secret[-_ ]?key[-_ ]?here)/i;

export function secretProblem(name: string, value: string | undefined): string | null {
  if (!value) return `${name} is not set.`;
  if (value.length < SECRET_MIN) return `${name} is ${value.length} characters; it needs at least ${SECRET_MIN}.`;
  if (PLACEHOLDER.test(value)) return `${name} is the placeholder from an example file, not a secret. Generate one: npm run setup:env.`;
  // Thirty-two of one character is long and is not a secret.
  if (new Set(value).size < 10) return `${name} has too few different characters to be random. Generate one: npm run setup:env.`;
  return null;
}

export interface EnvironmentReport {
  problems: string[];
  /** Worth saying, not worth refusing to start over. */
  warnings: string[];
}

export function checkEnvironment(env: Record<string, string | undefined>): EnvironmentReport {
  const production = env.NODE_ENV === "production";
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set.");
  else if (production && /\/\/geeboard:geeboard@/.test(env.DATABASE_URL)) {
    problems.push("DATABASE_URL uses the development password `geeboard`. Give the production database its own.");
  }

  const session = secretProblem("SESSION_SECRET", env.SESSION_SECRET);
  if (session) problems.push(session);

  /* In development SECRETS_KEY may be left out and SESSION_SECRET stands
     in. In production they are two secrets: one signs cookies and one
     encrypts every node token, and rotating the first must not make the
     second undecryptable. */
  if (env.SECRETS_KEY || production) {
    const key = secretProblem("SECRETS_KEY", env.SECRETS_KEY);
    if (key) problems.push(key);
    else if (env.SECRETS_KEY === env.SESSION_SECRET) {
      problems.push("SECRETS_KEY is the same as SESSION_SECRET. They are separate so that one can be rotated without the other.");
    }
  }

  if (production) {
    if (!env.PANEL_URL) warnings.push("PANEL_URL is not set, so the Add a node command will offer whatever address a browser used.");
    else if (!/^https:\/\//.test(env.PANEL_URL)) {
      warnings.push("PANEL_URL is not https. Session cookies are Secure in production and will not be sent over plain http.");
    }
  }
  return { problems, warnings };
}
