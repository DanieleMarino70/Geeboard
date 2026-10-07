import assert from "node:assert/strict";
import { test } from "node:test";
import { PlatformError, SECRETS_KEY_SENTENCE, SecretsKeyError, asPlatformError } from "../src/domain/errors.ts";
import { describeSealed } from "../src/domain/sealed.ts";

/* A key that does not open what was stored is said in words, with what to do, and not as OpenSSL's "Unsupported state or unable to
   authenticate data". */

test("a key that does not open a secret is a SecretsKeyError with the sentence of the cause", () => {
  const error = new SecretsKeyError(new Error("Unsupported state or unable to authenticate data"));
  assert.equal(error.message, "SECRETS_KEY is not the key these secrets were sealed with");
  assert.equal(error.message, SECRETS_KEY_SENTENCE);
  assert.ok(error instanceof Error);
  assert.match(String((error.cause as Error).message), /Unsupported state/, "the cause is kept for the log");
});

test("at a boundary it becomes a platform error that says what to do, not 'Something went wrong'", () => {
  const platform = asPlatformError(new SecretsKeyError());
  assert.ok(platform instanceof PlatformError);
  assert.equal(platform.code, "SECRETS_UNREADABLE");
  assert.equal(platform.status, 500);
  assert.match(platform.message, /SECRETS_KEY is not the key these secrets were sealed with/);
  assert.match(platform.message, /deploy\/panel\/\.env/);
  assert.match(platform.message, /rekey/);
  assert.doesNotMatch(platform.message, /Something went wrong/);
  // Anything else is still the generic sentence, with the cause kept.
  assert.equal(asPlatformError(new Error("boom")).code, "INTERNAL");
});

test("the boot check says one line, with how many and where, or nothing", () => {
  assert.equal(describeSealed({ opened: 12, unreadable: [] }), null);
  assert.equal(describeSealed({ opened: 0, unreadable: [{ what: "node tokens", count: 1 }] }), "1 stored secret does not open with SECRETS_KEY (node tokens: 1)");
  assert.equal(
    describeSealed({ opened: 3, unreadable: [{ what: "node tokens", count: 2 }, { what: "two-factor secrets", count: 4 }] }),
    "6 stored secrets do not open with SECRETS_KEY (node tokens: 2, two-factor secrets: 4)",
  );
});
