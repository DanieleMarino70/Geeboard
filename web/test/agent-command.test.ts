import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { NODE_NAME, checkAddress, joinCommand, type JoinCommandInput } from "../src/lib/agent-command.ts";

/* The command the Add a node dialog hands somebody to paste.

   It was bash only with placeholders, then seven variables including an
   agent token shown once. What is left is where the panel is and a
   single-use token; the agent does the rest on the machine. */

const input = (over: Partial<JoinCommandInput> = {}): JoinCommandInput => ({
  panelUrl: "http://localhost:3000/nodes",
  registrationToken: "gbn_0123456789abcdef",
  capabilities: [],
  advertiseUrl: "",
  ...over,
});

test("node names follow the rule registration enforces", () => {
  assert.ok(NODE_NAME.test("win-node-01"));
  assert.ok(!NODE_NAME.test("Win-Node"));
  assert.ok(!NODE_NAME.test("-leading"));
  assert.ok(!NODE_NAME.test("a"));
  assert.ok(!NODE_NAME.test("x".repeat(40)));
});

test("bash installs, then joins with the panel's address and the token", () => {
  const command = joinCommand(input(), "bash");
  assert.equal(
    command,
    [
      "# In Geeboard's daemon/ directory, with Docker running",
      "npm install",
      "npm run join -- 'http://localhost:3000' 'gbn_0123456789abcdef'",
    ].join("\n"),
  );
  assert.doesNotMatch(command, /GEEBOARD_|DAEMON_TOKEN|<|example\.com/, "no variables, no placeholders");
});

test("PowerShell does the same through npm.cmd", () => {
  const command = joinCommand(input(), "powershell");
  assert.match(command, /^npm\.cmd install$/m);
  assert.match(command, /^npm\.cmd run join -- 'http:\/\/localhost:3000' 'gbn_0123456789abcdef'$/m);
  assert.doesNotMatch(command, /^npm (install|run)/m, "npm.ps1 is refused by a fresh execution policy");
});

test("declared capabilities and a chosen address become options, and nothing else does", () => {
  const command = joinCommand(
    input({ capabilities: ["steamcmd", "java"], advertiseUrl: "http://203.0.113.9:9090/" }),
    "bash",
  );
  assert.match(command, / --advertise 'http:\/\/203\.0\.113\.9:9090' --capabilities 'java,steamcmd'$/);
  assert.doesNotMatch(joinCommand(input(), "bash"), /--advertise|--capabilities/);
});

test("an address must be http or https, with no path", () => {
  assert.equal(checkAddress("http://10.0.0.5:8080"), null);
  assert.equal(checkAddress("https://node.example.net/"), null);
  assert.ok(checkAddress("10.0.0.5:8080"));
  assert.ok(checkAddress("ftp://10.0.0.5"));
  assert.ok(checkAddress("http://10.0.0.5:8080/agent"));
});

/* The quoting, and the arguments' route through npm, proved in the shells
   themselves rather than by reading the string: `npm run join` is swapped
   for a script that prints the arguments it received. A value with quotes
   in it — ASCII and typographic — has to arrive exactly as it went in, and
   the options have to get past npm rather than being taken as its own. */
const tricky = input({
  registrationToken: "gbn_it's’“quoted”$HOME`x`",
  capabilities: ["steamcmd"],
  advertiseUrl: "http://10.0.0.5:9090",
});
const expected = [
  "http://localhost:3000",
  tricky.registrationToken,
  "--advertise",
  "http://10.0.0.5:9090",
  "--capabilities",
  "steamcmd",
];
const PRINT = `node -e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" --`;

function available(command: string, args: string[]): boolean {
  const probe = spawnSync(command, args, { encoding: "utf8" });
  return probe.status === 0;
}

test("bash hands join every argument unchanged", { skip: !available("bash", ["-c", "true"]) }, () => {
  const script = joinCommand(tricky, "bash")
    .replace(/^npm install$/m, "true")
    .replace(/^npm run join --/m, PRINT);
  const run = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), expected);
});

test(
  "PowerShell hands join every argument unchanged, through npm.cmd",
  { skip: !available("powershell", ["-NoProfile", "-Command", "exit 0"]) || process.platform !== "win32" },
  () => {
    /* A real npm script, so the `--` is shown reaching npm and the options
       getting past it: PowerShell and npm each have their own idea of
       what `--` means. */
    const dir = process.env.TEMP ?? ".";
    const pkg = `${dir}\\geeboard-join-args-${process.pid}`;
    spawnSync("powershell", [
      "-NoProfile",
      "-Command",
      `New-Item -ItemType Directory -Force '${pkg}' | Out-Null; ` +
        `Set-Content -Encoding ascii '${pkg}\\package.json' '{"name":"x","private":true,"scripts":{"join":"node print.js"}}'; ` +
        `Set-Content -Encoding ascii '${pkg}\\print.js' 'process.stdout.write(JSON.stringify(process.argv.slice(2)))'`,
    ]);
    const script =
      `Set-Location '${pkg}'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; ` +
      joinCommand(tricky, "powershell").replace(/^npm\.cmd install$/m, "").replace(/^npm\.cmd run join/m, "npm.cmd run --silent join");
    // Passed encoded, so the test's own argument quoting cannot help or hide anything.
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const run = spawnSync("powershell", ["-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
    spawnSync("powershell", ["-NoProfile", "-Command", `Remove-Item -Recurse -Force '${pkg}'`]);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout.trim()), expected);
  },
);
