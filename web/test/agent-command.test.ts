import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  NODE_NAME,
  agentCommand,
  checkAddress,
  defaultAdvertiseUrl,
  generateAgentToken,
  type AgentCommandInput,
} from "../src/lib/agent-command.ts";

/* The command the Add a node dialog hands somebody to paste. It used to
   be bash only, with placeholder URLs and "<32+ chars you choose>" where
   the agent token goes — a command that could not work as shown. */

const input = (over: Partial<AgentCommandInput> = {}): AgentCommandInput => ({
  nodeName: "win-node-01",
  agentToken: "a".repeat(64),
  panelUrl: "http://localhost:3000/nodes",
  advertiseUrl: "http://127.0.0.1:8080",
  registrationToken: "gbn_0123456789abcdef",
  capabilities: ["java", "steamcmd"],
  ...over,
});

test("an agent token is 64 hex characters, and never the same twice", () => {
  const one = generateAgentToken();
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.notEqual(one, generateAgentToken());
});

test("node names follow the rule registration enforces", () => {
  assert.ok(NODE_NAME.test("win-node-01"));
  assert.ok(!NODE_NAME.test("Win-Node"));
  assert.ok(!NODE_NAME.test("-leading"));
  assert.ok(!NODE_NAME.test("a"));
  assert.ok(!NODE_NAME.test("x".repeat(40)));
});

test("bash sets every variable and starts the agent", () => {
  const command = agentCommand(input(), "bash");
  assert.match(command, /^GEEBOARD_NODE_NAME='win-node-01' \\$/m);
  assert.match(command, /^GEEBOARD_DAEMON_TOKEN='a{64}' \\$/m);
  // Origin only: the page the operator was on is not part of the address.
  assert.match(command, /^GEEBOARD_PANEL_URL='http:\/\/localhost:3000' \\$/m);
  assert.match(command, /^GEEBOARD_ADVERTISE_URL='http:\/\/127.0.0.1:8080' \\$/m);
  assert.match(command, /^GEEBOARD_REGISTRATION_TOKEN='gbn_0123456789abcdef' \\$/m);
  assert.match(command, /^GEEBOARD_CAPABILITIES='java,steamcmd' \\$/m);
  assert.match(command, /\nnpm start$/);
  assert.doesNotMatch(command, /<|example\.com/, "no placeholders");
});

test("PowerShell sets the same variables, a Windows data root, and avoids npm.ps1", () => {
  const command = agentCommand(input(), "powershell");
  assert.match(command, /^\$env:GEEBOARD_NODE_NAME = 'win-node-01'$/m);
  assert.match(command, /^\$env:GEEBOARD_DAEMON_TOKEN = 'a{64}'$/m);
  assert.match(command, /^\$env:GEEBOARD_REGISTRATION_TOKEN = 'gbn_0123456789abcdef'$/m);
  assert.match(command, /^\$env:GEEBOARD_DATA_ROOT = "\$env:ProgramData\\Geeboard\\servers"$/m);
  assert.match(command, /\nnpm\.cmd start$/);
});

test("the listening port follows an explicit port in the advertised address", () => {
  assert.match(agentCommand(input({ advertiseUrl: "http://10.0.0.5:9090" }), "bash"), /GEEBOARD_DAEMON_PORT='9090'/);
  assert.doesNotMatch(agentCommand(input(), "bash"), /GEEBOARD_DAEMON_PORT/);
  // No port is a proxy in front of the agent, which stays on its default.
  assert.doesNotMatch(agentCommand(input({ advertiseUrl: "https://node.example.net" }), "bash"), /GEEBOARD_DAEMON_PORT/);
});

test("no declared capabilities means no capabilities line", () => {
  assert.doesNotMatch(agentCommand(input({ capabilities: [] }), "bash"), /GEEBOARD_CAPABILITIES/);
});

test("only a loopback panel gets a default agent address", () => {
  assert.equal(defaultAdvertiseUrl("http://localhost:3000"), "http://127.0.0.1:8080");
  assert.equal(defaultAdvertiseUrl("http://127.0.0.1:3000"), "http://127.0.0.1:8080");
  // Anything else would be a guess about somebody's network.
  assert.equal(defaultAdvertiseUrl("https://panel.ashfold.gg"), "");
});

test("an address must be http or https, with no path", () => {
  assert.equal(checkAddress("http://10.0.0.5:8080"), null);
  assert.equal(checkAddress("https://node.example.net/"), null);
  assert.ok(checkAddress("10.0.0.5:8080"));
  assert.ok(checkAddress("ftp://10.0.0.5"));
  assert.ok(checkAddress("http://10.0.0.5:8080/agent"));
});

/* The quoting, proved in the shells themselves rather than by reading the
   string: the command runs with its last line swapped for one that prints
   what the agent would have been given. A value with quotes in it — ASCII
   and typographic — has to come out exactly as it went in. */
const tricky = input({ registrationToken: "gbn_it's’“quoted”$HOME`x`" });

function available(command: string, args: string[]): boolean {
  const probe = spawnSync(command, args, { encoding: "utf8" });
  return probe.status === 0;
}

test("bash hands the agent every value unchanged", { skip: !available("bash", ["-c", "true"]) }, () => {
  const script = agentCommand(tricky, "bash").replace(
    /npm start$/,
    `node -e "process.stdout.write(JSON.stringify({ t: process.env.GEEBOARD_REGISTRATION_TOKEN, n: process.env.GEEBOARD_NODE_NAME }))"`,
  );
  const run = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { t: tricky.registrationToken, n: "win-node-01" });
});

test(
  "PowerShell hands the agent every value unchanged",
  { skip: !available("powershell", ["-NoProfile", "-Command", "exit 0"]) },
  () => {
    const script = agentCommand(tricky, "powershell").replace(
      /npm\.cmd start$/,
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
        "@{ t = $env:GEEBOARD_REGISTRATION_TOKEN; n = $env:GEEBOARD_NODE_NAME; d = $env:GEEBOARD_DATA_ROOT } | ConvertTo-Json -Compress",
    );
    // Passed encoded, so the test's own argument quoting cannot help or hide anything.
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const run = spawnSync("powershell", ["-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout.trim()) as { t: string; n: string; d: string };
    assert.equal(out.t, tricky.registrationToken);
    assert.equal(out.n, "win-node-01");
    assert.match(out.d, /\\Geeboard\\servers$/);
    assert.doesNotMatch(out.d, /\$env/, "the data root is expanded, not literal");
  },
);
