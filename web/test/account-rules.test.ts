import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PASSWORD_MIN,
  initialsOf,
  looksLikeTotp,
  mustEnrol,
  normaliseRecoveryCode,
  passwordProblem,
  requiresTwoFactor,
} from "../src/domain/access/account.ts";

/* The account rules the sign-in page, the account page, the Members
   page and the API front door all share. */

test("two-factor is required of owners and admins, offered to the rest", () => {
  assert.equal(requiresTwoFactor("OWNER"), true);
  assert.equal(requiresTwoFactor("ADMIN"), true);
  assert.equal(requiresTwoFactor("MODERATOR"), false);
  assert.equal(requiresTwoFactor("MEMBER"), false);

  assert.equal(mustEnrol({ role: "OWNER", twoFactor: false }), true, "signed in, sent to enrol");
  assert.equal(mustEnrol({ role: "OWNER", twoFactor: true }), false);
  assert.equal(mustEnrol({ role: "MEMBER", twoFactor: false }), false);
});

test("a password is judged on length alone", () => {
  assert.match(passwordProblem("short")!, new RegExp(`${PASSWORD_MIN}`));
  assert.equal(passwordProblem("a".repeat(PASSWORD_MIN)), null);
  assert.equal(passwordProblem("correct horse battery staple"), null, "no composition rules");
  assert.match(passwordProblem("a".repeat(201))!, /at most/);
});

test("a recovery code is read however it was copied; a six-digit code is a code", () => {
  assert.equal(normaliseRecoveryCode(" ABCDE-fghjk "), "abcdefghjk");
  assert.equal(normaliseRecoveryCode("abcde fghjk"), "abcdefghjk");
  assert.equal(looksLikeTotp(" 123456 "), true);
  assert.equal(looksLikeTotp("12345"), false);
  assert.equal(looksLikeTotp("abcde-fghjk"), false);
});

test("initials come from the first two words, or the first two letters", () => {
  assert.equal(initialsOf("Mara Kessler"), "MK");
  assert.equal(initialsOf("  devi   vasquez  "), "DV");
  assert.equal(initialsOf("Cher"), "CH");
  assert.equal(initialsOf("Jean-Luc Picard Sr."), "JP");
});
