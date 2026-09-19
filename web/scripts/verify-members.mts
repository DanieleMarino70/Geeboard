import path from "node:path";
import process from "node:process";
process.loadEnvFile(path.join(process.cwd(), ".env"));

const { db } = await import("../src/lib/db");
const ops = await import("../src/lib/server-ops");

// Start from the known fixture so these run in any order, repeatedly.
const { seed } = await import("../prisma/seed");
await seed();

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${detail}`); }
};

const u = async (email: string) => (await db.user.findUnique({ where: { email } }))!;
let mara = await u("mara@ashfold.gg");   // OWNER
let devi = await u("devi@ashfold.gg");   // ADMIN
const tomas = await u("tomas@ashfold.gg"); // MODERATOR

console.log("\n== who may change roles ==");
let r = await ops.changeMemberRoleOp(tomas, devi.id, "MEMBER");
check("moderator cannot change roles", !r.ok && r.title === "Not permitted", JSON.stringify(r));
r = await ops.changeMemberRoleOp(mara, mara.id, "ADMIN");
check("owner cannot change own role", !r.ok && r.title.includes("own role"));
r = await ops.changeMemberRoleOp(mara, devi.id, "ADMIN");
check("no-op role change refused", !r.ok && r.title === "No change");

console.log("\n== admins cannot mint or strip owners ==");
r = await ops.changeMemberRoleOp(devi, tomas.id, "OWNER");
check("admin cannot grant OWNER", !r.ok && r.body.includes("Only an owner"), JSON.stringify(r));
r = await ops.changeMemberRoleOp(devi, mara.id, "MEMBER");
check("admin cannot demote an owner", !r.ok && r.body.includes("Only an owner"));

console.log("\n== last-owner protection ==");
r = await ops.changeMemberRoleOp(mara, mara.id, "MEMBER");
check("owner cannot self-demote", !r.ok);
// Promote Devi so there are two owners, then demotion becomes allowed.
r = await ops.changeMemberRoleOp(mara, devi.id, "OWNER");
check("owner can promote to OWNER", r.ok, JSON.stringify(r));
devi = await u("devi@ashfold.gg");
check("promotion persisted", devi.role === "OWNER", devi.role);
r = await ops.changeMemberRoleOp(devi, mara.id, "ADMIN");
check("second owner can demote the first", r.ok, JSON.stringify(r));
mara = await u("mara@ashfold.gg");
check("demotion persisted", mara.role === "ADMIN", mara.role);
r = await ops.changeMemberRoleOp(devi, devi.id, "ADMIN");
check("last owner cannot self-demote either", !r.ok);

console.log("\n== role change is audited with a diff ==");
const ev = (await db.activityEvent.findFirst({
  where: { action: "member.role.changed" }, orderBy: { createdAt: "desc" },
}))!;
const ch = ev.changes as Record<string, { from: string; to: string }>;
check("event written", !!ev);
check("records from → to", ch?.Role?.from === "OWNER" && ch?.Role?.to === "ADMIN", JSON.stringify(ch));

console.log("\n== removing members ==");
r = await ops.removeMemberOp(tomas, mara.id);
check("moderator cannot remove", !r.ok && r.title === "Not permitted");
r = await ops.removeMemberOp(devi, devi.id);
check("cannot remove yourself", !r.ok && r.title.includes("yourself"));
r = await ops.removeMemberOp(devi, tomas.id);
check("member owning servers is protected", !r.ok && r.title === "Servers still owned", JSON.stringify(r));

// Give Tomas's server away, then removal should work.
await db.server.updateMany({ where: { ownerId: tomas.id }, data: { ownerId: devi.id } });
r = await ops.removeMemberOp(devi, tomas.id);
check("removal succeeds once servers are transferred", r.ok, JSON.stringify(r));
check("account is gone", (await db.user.findUnique({ where: { id: tomas.id } })) === null);
check("removal is audited",
  (await db.activityEvent.count({ where: { action: "member.removed" } })) === 1);

console.log("\n== node drain ==");
const moderatorless = await u("mara@ashfold.gg"); // now ADMIN
r = await ops.setNodeDrainOp(moderatorless, "fra-node-02", true);
check("admin can drain", r.ok, JSON.stringify(r));
check("node state persisted",
  (await db.node.findUnique({ where: { name: "fra-node-02" } }))!.state === "DRAINING");
r = await ops.setNodeDrainOp(moderatorless, "fra-node-02", true);
check("draining twice refused", !r.ok && r.title === "Already draining");
r = await ops.setNodeDrainOp(moderatorless, "fra-node-02", false);
check("resume works", r.ok);
check("back to healthy",
  (await db.node.findUnique({ where: { name: "fra-node-02" } }))!.state === "HEALTHY");
r = await ops.setNodeDrainOp(moderatorless, "does-not-exist", true);
check("unknown node refused", !r.ok);

/* ── Accounts from the panel ─────────────────────────────────────── */
const accounts = await import("../src/lib/account-ops");
const { totp, base32Decode } = await import("../src/domain/access/totp");
const tokenOf = (link: string) => link.slice(link.lastIndexOf("/") + 1);
// The panel's address, which an operation is told rather than reads.
const BASE = "http://localhost:3000";
const owner = await u("devi@ashfold.gg"); // OWNER after the promotion above
const admin = await u("mara@ashfold.gg"); // ADMIN now

console.log("\n== creating an account ==");
let made = await accounts.createMemberOp(admin, { name: "Nils Berg", email: "Nils@Example.com", role: "OWNER" }, BASE);
check("admin cannot make an owner", !made.ok && made.body.includes("Only an owner"), JSON.stringify(made));
made = await accounts.createMemberOp(admin, { name: "Nils Berg", email: "not-an-email", role: "MEMBER" }, BASE);
check("an email has to be one", !made.ok, JSON.stringify(made));
made = await accounts.createMemberOp(admin, { name: "Nils Berg", email: "Nils@Example.com", role: "MEMBER" }, BASE);
check("member created with a setup link", made.ok && "link" in made && made.link!.includes("/setup/gbt_"), JSON.stringify(made));
const nils = await u("nils@example.com");
check("email is stored lower-case, initials derived", nils !== null && nils.initials === "NB");
check("no password chosen yet", nils.passwordSetAt === null);
check("creation is audited", (await db.activityEvent.count({ where: { action: "member.created" } })) === 1);
made = await accounts.createMemberOp(admin, { name: "Nils Again", email: "nils@example.com", role: "MEMBER" }, BASE);
check("a second account on the same email is refused", !made.ok && made.title === "Already a member");

const setupLink = (made = await accounts.createMemberOp(admin, { name: "Ola Berg", email: "ola@example.com", role: "MEMBER" }, BASE)).ok && "link" in made ? made.link! : "";
const setupToken = tokenOf(setupLink);
const preview = await accounts.previewLink(setupToken);
check("a link previews the account it is for without spending it", preview?.email === "ola@example.com" && preview.purpose === "SETUP");
check("a wrong link previews nothing", (await accounts.previewLink("gbt_nope")) === null);
let done = await accounts.completeSetupOp(setupToken, "short");
check("a short password is refused and the link survives", !done.ok && (await accounts.previewLink(setupToken)) !== null);
done = await accounts.completeSetupOp(setupToken, "correct horse battery staple");
check("the password is set through the link", done.ok, JSON.stringify(done));
check("the link is spent", (await accounts.previewLink(setupToken)) === null);
done = await accounts.completeSetupOp(setupToken, "another password here");
check("a spent link is refused", !done.ok && done.title.includes("no longer works"));
/* Not lib/auth: that module reads request headers and cookies, which a
   script has none of. The check is the same bcrypt comparison. */
const bcrypt = (await import("bcryptjs")).default;
const verifyCredentials = async (email: string, password: string) => {
  const user = await db.user.findUnique({ where: { email } });
  return user && (await bcrypt.compare(password, user.passwordHash)) ? user : null;
};
check("the new password signs in", (await verifyCredentials("ola@example.com", "correct horse battery staple")) !== null);
check("password-set is audited", (await db.activityEvent.count({ where: { action: "account.password.set" } })) === 1);

console.log("\n== password reset ==");
const ola = await u("ola@example.com");
await db.session.create({ data: { userId: ola.id, expiresAt: new Date(Date.now() + 3600_000) } });
let reset = await accounts.issueResetLinkOp(admin, admin.id, BASE);
check("your own password is not reset from here", !reset.ok && reset.title === "Change it instead");
reset = await accounts.issueResetLinkOp(admin, owner.id, BASE);
check("admin cannot reset an owner", !reset.ok && reset.body.includes("Only an owner"));
reset = await accounts.issueResetLinkOp(admin, ola.id, BASE);
check("reset link issued", reset.ok && "link" in reset, JSON.stringify(reset));
check("every session of the account ended", (await db.session.count({ where: { userId: ola.id } })) === 0);
check("reset is audited", (await db.activityEvent.count({ where: { action: "member.password.reset" } })) === 1);
const firstReset = reset.ok && "link" in reset ? reset.link! : "";
reset = await accounts.issueResetLinkOp(admin, ola.id, BASE);
check("a newer link replaces the older one", (await accounts.previewLink(tokenOf(firstReset))) === null && reset.ok);

console.log("\n== changing a password ==");
let changed = await accounts.changePasswordOp(ola, "wrong", "a brand new password", null);
check("wrong current password refused", !changed.ok);
changed = await accounts.changePasswordOp(await u("ola@example.com"), "correct horse battery staple", "a brand new password", null);
check("password changed", changed.ok, JSON.stringify(changed));
check("the new one signs in, the old one does not",
  (await verifyCredentials("ola@example.com", "a brand new password")) !== null &&
  (await verifyCredentials("ola@example.com", "correct horse battery staple")) === null);

console.log("\n== two-factor ==");
let fresh = await u("ola@example.com");
const begun = await accounts.beginTwoFactorOp(fresh);
check("enrolment hands out a secret and a URI", begun.ok && "secret" in begun && begun.uri!.startsWith("otpauth://totp/"), JSON.stringify(begun));
const secret = begun.ok && "secret" in begun ? base32Decode(begun.secret!) : new Uint8Array();
fresh = await u("ola@example.com");
let confirmed = await accounts.confirmTwoFactorOp(fresh, "000000");
check("a wrong code does not enable it", !confirmed.ok && !(await u("ola@example.com")).twoFactor);
/* Codes are spent by step and accepted one step either side of now, so
   the flow walks forward: enrol with the previous step's code, sign in
   with this step's, turn off with the next. */
const enrolCode = totp(secret, Date.now() - 30_000);
confirmed = await accounts.confirmTwoFactorOp(fresh, enrolCode);
check("the right code enables it and returns ten recovery codes", confirmed.ok && "codes" in confirmed && confirmed.codes!.length === 10, JSON.stringify(confirmed));
check("recovery codes are stored hashed, none used", (await db.recoveryCode.count({ where: { userId: ola.id, usedAt: null } })) === 10);
const codes = confirmed.ok && "codes" in confirmed ? confirmed.codes! : [];
check("the code that enrolled cannot sign in again", !(await accounts.verifySecondFactorOp(ola.id, enrolCode)).ok);
let second = await accounts.verifySecondFactorOp(ola.id, totp(secret, Date.now()));
check("the next code signs in", second.ok && second.via === "totp", JSON.stringify(second));
second = await accounts.verifySecondFactorOp(ola.id, codes[0]!.toUpperCase());
check("a recovery code signs in, however it was typed", second.ok && second.via === "recovery" && second.remaining === 9, JSON.stringify(second));
second = await accounts.verifySecondFactorOp(ola.id, codes[0]!);
check("a recovery code works once", !second.ok);
check("recovery use is audited", (await db.activityEvent.count({ where: { action: "account.recovery.used" } })) === 1);
check("owner without two-factor must enrol", (await import("../src/domain/access/account")).mustEnrol(await u("devi@ashfold.gg")));
const disabled = await accounts.disableTwoFactorOp(await u("ola@example.com"), "a brand new password", totp(secret, Date.now() + 30_000));
check("a member may turn it off", disabled.ok && !(await u("ola@example.com")).twoFactor, JSON.stringify(disabled));

console.log("\n== a reset removes two-factor ==");
const enrolAgain = await accounts.beginTwoFactorOp(await u("ola@example.com"));
const secret2 = enrolAgain.ok && "secret" in enrolAgain ? base32Decode(enrolAgain.secret!) : new Uint8Array();
await accounts.confirmTwoFactorOp(await u("ola@example.com"), totp(secret2, Date.now()));
check("enrolled again", (await u("ola@example.com")).twoFactor);
reset = await accounts.issueResetLinkOp(owner, ola.id, BASE);
done = await accounts.completeSetupOp(tokenOf(reset.ok && "link" in reset ? reset.link! : ""), "yet another long password");
fresh = await u("ola@example.com");
check("after the reset link is used, two-factor is off and the codes are gone",
  done.ok && !fresh.twoFactor && fresh.totpSecret === null && (await db.recoveryCode.count({ where: { userId: ola.id } })) === 0, JSON.stringify(done));

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
