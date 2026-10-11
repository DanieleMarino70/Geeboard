import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkAgentVersion } from "../src/domain/nodes/agent-version.ts";

/* docs/nodes.md has a table of which agent works with which panel. Its 0.11 row is a table of a function, so it is computed from the
   function: agents that say 0.3.2 and 0.4.0 (which send no contract) and 0.4.1, 0.8.1 and 0.10.1 (which say contract 1), and the cell's
   first word has to be what the rule answers. The row above it is the release line's, kept as history, and is not this rule's to check.
   A release that changes the rule, or a contract that goes up, fails here until the page says so. */

const PAGE = readFileSync(path.join(import.meta.dirname, "..", "..", "docs", "nodes.md"), "utf8").split("\r\n").join("\n");

const AGENTS: Array<{ version: string; contract: number | null }> = [
  { version: "0.3.2", contract: null },
  { version: "0.4.0", contract: null },
  { version: "0.4.1", contract: 1 },
  { version: "0.8.1", contract: 1 },
  { version: "0.10.1", contract: 1 },
];

test("the table of which agent works with which panel is what the rule says", () => {
  const lines = PAGE.split("\n");
  const header = lines.findIndex((line) => line.startsWith("| Panel \\ agent |"));
  assert.ok(header >= 0, "docs/nodes.md has no 'Panel \\ agent' table");
  const columns = lines[header]!.split("|").slice(2, -1).map((c) => c.trim());
  assert.deepEqual(
    columns.map((c) => c.split(" ")[0]),
    AGENTS.map((a) => a.version),
    "the columns are the agents this test computes",
  );
  const row = lines.slice(header + 2).find((line) => line.startsWith("| **0.11"));
  assert.ok(row, "the table has no 0.11 row");
  const cells = row.split("|").slice(1, -1).map((c) => c.trim());
  assert.equal(cells.length, AGENTS.length + 1, row);
  AGENTS.forEach((agent, i) => {
    const verdict = checkAgentVersion(agent.contract).verdict;
    const written = cells[i + 1]!.split(" ")[0];
    assert.equal(written, verdict === "compatible" ? "yes" : "no", `agent ${agent.version}: the code says ${verdict}`);
  });
});
