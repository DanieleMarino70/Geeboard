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

test("a code typed the way the authenticator shows it is the code, and costs no attempt as a recovery code", () => {
  assert.equal(looksLikeTotp("123 456"), true, "two groups of three, as the apps display it");
  assert.equal(looksLikeTotp("123\u00a0456"), true, "a no-break space, as a phone keyboard may put there");
  assert.equal(looksLikeTotp(" 1 2 3 4 5 6 "), true);
  assert.equal(looksLikeTotp("123 45"), false);
  assert.equal(looksLikeTotp("1234567"), false);
  assert.equal(looksLikeTotp("123-456"), false, "a hyphen is a recovery code's, not a code's");
  // A recovery code with a digit run in it is still a recovery code.
  assert.equal(looksLikeTotp("23456-78923"), false);
  assert.equal(normaliseRecoveryCode("ABCDE FGHJK"), "abcdefghjk");
});

test("initials come from the first two words, or the first two letters", () => {
  assert.equal(initialsOf("Mara Kessler"), "MK");
  assert.equal(initialsOf("  devi   vasquez  "), "DV");
  assert.equal(initialsOf("Cher"), "CH");
  assert.equal(initialsOf("Jean-Luc Picard Sr."), "JP");
});

test("a password longer than the hash reads is asked to be shorter, not silently cut", () => {
  assert.equal(passwordProblem("a".repeat(72)), null, "72 bytes is the most");
  assert.match(passwordProblem("a".repeat(73))!, /at most 72 bytes/);
  assert.equal(passwordProblem("é".repeat(36)), null, "two bytes each: 72");
  assert.match(passwordProblem("é".repeat(37))!, /at most 72 bytes/, "a letter that takes two bytes counts two");
  assert.match(passwordProblem("a".repeat(201))!, /at most/);
});
