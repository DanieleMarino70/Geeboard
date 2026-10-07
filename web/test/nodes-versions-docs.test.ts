import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkAgentVersion } from "../src/domain/nodes/agent-version.ts";

/* docs/nodes.md has a table of which agent works with which panel. It is a table of a function, so it is computed from the function: a
   panel at 0.4.1, 0.8.1 and 0.9.0 against agents that say 0.3.2 and 0.4.0 (which send no contract) and 0.4.1, 0.8.1 and 0.9.0 (which say
   contract 1), and the cell's first word has to be what the rule answers. A release that changes the rule, or a contract that goes up, fails
   here until the page says so. */

const PAGE = readFileSync(path.join(import.meta.dirname, "..", "..", "docs", "nodes.md"), "utf8").split("\r\n").join("\n");

const AGENTS: Array<{ version: string; contract: number | null }> = [
  { version: "0.3.2", contract: null },
  { version: "0.4.0", contract: null },
  { version: "0.4.1", contract: 1 },
  { version: "0.8.1", contract: 1 },
  { version: "0.9.0", contract: 1 },
];

test("the table of which agent works with which panel is what the rule says", () => {
  const header = PAGE.split("\n").findIndex((line) => line.startsWith("| Panel \\ agent |"));
  assert.ok(header >= 0, "docs/nodes.md has no 'Panel \\ agent' table");
  const rows = PAGE.split("\n").slice(header + 2, header + 5);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const cells = row.split("|").slice(1, -1).map((c) => c.trim());
    const panel = /\*\*(\d+\.\d+\.\d+)\*\*/.exec(cells[0]!)?.[1];
    assert.ok(panel, `no panel version in ${cells[0]}`);
    assert.equal(cells.length, AGENTS.length + 1, row);
    AGENTS.forEach((agent, i) => {
      const verdict = checkAgentVersion(panel!, agent.version, agent.contract).verdict;
      const written = cells[i + 1]!.split(" ")[0];
      assert.equal(written, verdict === "compatible" ? "yes" : "no", `panel ${panel} with agent ${agent.version}: the code says ${verdict}`);
    });
  }
});
