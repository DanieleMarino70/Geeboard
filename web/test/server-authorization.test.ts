import assert from "node:assert/strict";
import { test } from "node:test";
import { SERVER_OPERATION_PERMISSION, type ServerOperation } from "../src/domain/access/operations";
import { allowanceFor, can } from "../src/domain/access/permissions";

/* Who may do what to one server, written out. The matrix in permissions.ts
   and the table in operations.ts are what the code runs; this is the
   statement they are held to, in words a person can read and disagree with.
   An operation that asks for less than it should — or the table changing
   under it — fails here, not in a member's hands. */

type Who = "owner" | "admin" | "moderator" | "member";
const ME = "user-me";
const SOMEBODY_ELSE = "user-other";
const ROLES: Record<Who, "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER"> = {
  owner: "OWNER",
  admin: "ADMIN",
  moderator: "MODERATOR",
  member: "MEMBER",
};

const ALL: ServerOperation[] = ["start", "stop", "restart", "toggleTask", "runTask", "saveSettings", "delete", "consoleCommand"];

/* What each role may do to a server it owns, and to one it does not. An
   owner or an admin acts on anything. A moderator runs, configures and types
   into their own servers and cannot delete even those: deleting is making
   and unmaking, which is the owners' and admins'. A member starts, stops and
   restarts the servers they were given, and that is all. */
const EXPECTED: Record<Who, { own: ServerOperation[]; others: ServerOperation[] }> = {
  owner: { own: ALL, others: ALL },
  admin: { own: ALL, others: ALL },
  moderator: { own: ALL.filter((op) => op !== "delete"), others: [] },
  member: { own: ["start", "stop", "restart"], others: [] },
};

test("every operation on a server asks for the permission the written policy implies", () => {
  for (const who of Object.keys(ROLES) as Who[]) {
    for (const [scope, ownerId] of [["own", ME], ["others", SOMEBODY_ELSE]] as const) {
      const actor = { id: ME, role: ROLES[who] };
      for (const operation of ALL) {
        const allowed = can(actor, SERVER_OPERATION_PERMISSION[operation], ownerId);
        const wanted = EXPECTED[who][scope].includes(operation);
        assert.equal(
          allowed,
          wanted,
          `${who} ${operation} on a server ${scope === "own" ? "they own" : "somebody else owns"}: ${allowed ? "allowed" : "refused"}, written policy says ${wanted ? "allowed" : "refused"}`,
        );
      }
    }
  }
});

test("the table names every operation the written policy lists, and nothing else", () => {
  assert.deepEqual(Object.keys(SERVER_OPERATION_PERMISSION).sort(), [...ALL].sort());
});

test("the controls a page draws are the ones the operations would allow", () => {
  for (const who of Object.keys(ROLES) as Who[]) {
    const actor = { id: ME, role: ROLES[who] };
    const own = allowanceFor(actor, ME);
    assert.equal(own.start, EXPECTED[who].own.includes("start"), `${who} start`);
    assert.equal(own.stop, EXPECTED[who].own.includes("stop"), `${who} stop`);
    assert.equal(own.restart, EXPECTED[who].own.includes("restart"), `${who} restart`);
    const others = allowanceFor(actor, SOMEBODY_ELSE);
    assert.equal(others.start || others.stop || others.restart, EXPECTED[who].others.includes("start"), `${who} on somebody else's server`);
  }
  // A member sees no "Back up now": backing up is a permission of its own, and a member's is none.
  assert.equal(allowanceFor({ id: ME, role: "MEMBER" }, ME).backup, false);
  assert.equal(allowanceFor({ id: ME, role: "MODERATOR" }, ME).backup, true);
});
