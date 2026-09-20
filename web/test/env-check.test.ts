import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEnvironment, secretProblem } from "../src/lib/env-check.ts";

/* What the panel refuses to start with. */

const good = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://geeboard:Zr8kQ2vX9m@db:5432/geeboard",
  SESSION_SECRET: "k3Jx9QpL2mN8vB5cZ7wR1tY6uH4gF0dS+aE/oI=",
  SECRETS_KEY: "Wq7Lm2Xc9Vb4Nn6Kk1Jh8Gf3Dd5Ss0AaPpOoIiUuYy",
  PANEL_URL: "https://panel.example.com",
};

test("a sound production environment has nothing said about it", () => {
  assert.deepEqual(checkEnvironment(good), { problems: [], warnings: [] });
});

/* The example file's own values are thirty-six characters — long enough
   to have passed a length check, and printed in a public repository. */
test("the placeholder the example file used to ship is not a secret", () => {
  assert.match(secretProblem("SESSION_SECRET", "generate-with-openssl-rand-base64-32")!, /placeholder/);
  assert.match(secretProblem("SESSION_SECRET", "change-me-change-me-change-me-change-me")!, /placeholder/);
  assert.match(secretProblem("SESSION_SECRET", "a".repeat(40))!, /too few different characters/);
  assert.match(secretProblem("SESSION_SECRET", "short")!, /at least 32/);
  assert.match(secretProblem("SESSION_SECRET", undefined)!, /not set/);
  assert.equal(secretProblem("SESSION_SECRET", good.SESSION_SECRET), null);
});

test("production wants two different secrets and not the development database password", () => {
  assert.ok(checkEnvironment({ ...good, SECRETS_KEY: undefined }).problems.some((p) => /SECRETS_KEY is not set/.test(p)));
  assert.ok(checkEnvironment({ ...good, SECRETS_KEY: good.SESSION_SECRET }).problems.some((p) => /same as SESSION_SECRET/.test(p)));
  assert.ok(
    checkEnvironment({ ...good, DATABASE_URL: "postgresql://geeboard:geeboard@localhost:5432/geeboard" }).problems.some((p) => /development password/.test(p)),
  );
  assert.ok(checkEnvironment({ ...good, DATABASE_URL: undefined }).problems.some((p) => /DATABASE_URL is not set/.test(p)));
});

test("development may leave SECRETS_KEY out, and keeps the compose file's password", () => {
  const dev = { DATABASE_URL: "postgresql://geeboard:geeboard@localhost:5432/geeboard", SESSION_SECRET: good.SESSION_SECRET };
  assert.deepEqual(checkEnvironment(dev).problems, []);
});

test("a plain-http panel address is a warning, because the cookies are Secure", () => {
  assert.ok(checkEnvironment({ ...good, PANEL_URL: "http://panel.lan:3000" }).warnings.some((w) => /not https/.test(w)));
  assert.ok(checkEnvironment({ ...good, PANEL_URL: undefined }).warnings.some((w) => /PANEL_URL is not set/.test(w)));
});
