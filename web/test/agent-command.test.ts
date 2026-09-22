import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  NODE_NAME,
  checkAddress,
  isIpAddress,
  joinCommand,
  needsPanelAuthority,
  type JoinCommandInput,
} from "../src/lib/agent-command.ts";

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

test("bash installs the service, handing join the panel's address and the token", () => {
  const command = joinCommand(input(), "bash");
  assert.equal(
    command,
    [
      "# In a checkout of Geeboard, with Docker running",
      "sudo bash deploy/linux/install.sh 'http://localhost:3000' 'gbn_0123456789abcdef'",
    ].join("\n"),
  );
  assert.doesNotMatch(command, /GEEBOARD_|DAEMON_TOKEN|<|example\.com/, "no variables, no placeholders");
  /* `bash …` rather than `./…`: a checkout copied from Windows or unpacked
     from a zip has no execute bit on anything, and the installer is what
     repairs that — it cannot repair itself. */
  assert.match(command, /sudo bash deploy\//, "runs through bash, not the execute bit");
});

test("PowerShell is one command: the installer, with the panel and the token named", () => {
  const command = joinCommand(input(), "powershell");
  assert.equal(
    command,
    [
      "# In a checkout of Geeboard, with Docker Desktop running",
      "powershell -ExecutionPolicy Bypass -File .\\deploy\\windows\\install-node.ps1 " +
        "-Panel 'http://localhost:3000' -Token 'gbn_0123456789abcdef'",
    ].join("\n"),
  );
  /* A fresh Windows install refuses to run any .ps1, whatever is in it.
     That is the first wall a beginner meets and it is not Geeboard's. */
  assert.match(command, /-ExecutionPolicy Bypass/, "a fresh execution policy refuses every .ps1");
  assert.doesNotMatch(command, /^npm/m, "nothing to run by hand before it");
});

test("declared capabilities and a chosen address become options, and nothing else does", () => {
  const command = joinCommand(
    input({ capabilities: ["steamcmd", "java"], advertiseUrl: "http://203.0.113.9:9090/" }),
    "bash",
  );
  assert.match(command, / --advertise 'http:\/\/203\.0\.113\.9:9090' --capabilities 'java,steamcmd'$/);
  assert.doesNotMatch(joinCommand(input(), "bash"), /--advertise|--capabilities/);
});

/* The one thing that decides whether a node needs this panel's own
   certificate authority: an https certificate for an address rather than
   a name. Nobody is asked, and nothing guesses from the server the panel
   happens to be running on — it is read off the address the node is being
   given, which is the address it will use. */

test("a panel reached at an address carries its own authority", () => {
  const command = joinCommand(input({ panelUrl: "https://203.0.113.10" }), "bash");
  assert.equal(
    command,
    [
      "# In a checkout of Geeboard, with Docker running",
      "sudo bash deploy/linux/install.sh 'https://203.0.113.10' 'gbn_0123456789abcdef' --panel-ca auto",
    ].join("\n"),
  );
});

test("a panel reached by name does not", () => {
  const command = joinCommand(input({ panelUrl: "https://panel.example.com" }), "bash");
  assert.doesNotMatch(command, /--panel-ca/, "a public authority signed it; there is nothing to add");
  assert.match(command, /'https:\/\/panel\.example\.com' 'gbn_0123456789abcdef'$/);
});

test("an IPv6 panel is an address too, brackets and all", () => {
  assert.match(joinCommand(input({ panelUrl: "https://[2001:db8::1]:8443" }), "bash"), /--panel-ca auto$/);
  assert.ok(needsPanelAuthority("https://[::1]"));
});

test("plain http is not this case, whatever the host is", () => {
  // No certificate, so no authority to distrust. The seed's own panel is here.
  assert.ok(!needsPanelAuthority("http://203.0.113.10:3000"));
  assert.doesNotMatch(joinCommand(input({ panelUrl: "http://203.0.113.10:3000" }), "bash"), /--panel-ca/);
});

test("an address is four octets that are numbers, and nothing else", () => {
  assert.ok(isIpAddress("203.0.113.10"));
  assert.ok(isIpAddress("10.0.0.5"));
  assert.ok(isIpAddress("[2001:db8::1]"));
  assert.ok(!isIpAddress("256.0.0.1"), "not an octet");
  assert.ok(!isIpAddress("10.0.0"), "not four of them");
  assert.ok(!isIpAddress("10.0.0.5.6"), "nor five");
  assert.ok(!isIpAddress("panel.example.com"));
  assert.ok(!isIpAddress("localhost"), "a name, and one the installer works out for itself");
  assert.ok(!isIpAddress("203.0.113.10.example.com"), "a name that starts like an address");
  assert.ok(!needsPanelAuthority("not a url at all"));
});

test("the authority comes last, after the options join takes", () => {
  const command = joinCommand(
    input({
      panelUrl: "https://203.0.113.10",
      capabilities: ["steamcmd"],
      advertiseUrl: "http://10.0.0.5:8080",
    }),
    "bash",
  );
  assert.match(
    command,
    / --advertise 'http:\/\/10\.0\.0\.5:8080' --capabilities 'steamcmd' --panel-ca auto$/,
  );
});

/* Windows has no certificate authority option: the agent there runs from
   the checkout rather than a container, and that case has not been built.
   The command must not grow a flag its installer would refuse. */
test("the Windows command is unchanged by an address panel", () => {
  const command = joinCommand(input({ panelUrl: "https://203.0.113.10" }), "powershell");
  assert.doesNotMatch(command, /panel-ca|PanelCa/i);
});

test("an address must be http or https, with no path", () => {
  assert.equal(checkAddress("http://10.0.0.5:8080"), null);
  assert.equal(checkAddress("https://node.example.net/"), null);
  assert.ok(checkAddress("10.0.0.5:8080"));
  assert.ok(checkAddress("ftp://10.0.0.5"));
  assert.ok(checkAddress("http://10.0.0.5:8080/agent"));
});

/* The quoting proved in the shells themselves rather than by reading the
   string: the installer is swapped for a script that prints what it was
   given. A value with quotes in it — ASCII and typographic — has to arrive
   exactly as it went in. */
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
  // The install script passes everything after its name to join unchanged.
  const script = joinCommand(tricky, "bash").replace(/^sudo bash deploy\/linux\/install\.sh/m, PRINT);
  const run = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), expected);
});

test("bash hands the installer the authority option as two arguments", { skip: !available("bash", ["-c", "true"]) }, () => {
  /* `auto` is written unquoted, which a shell could in principle join to
     its flag or split elsewhere. Proved in bash rather than read: the
     installer takes --panel-ca and its value and passes everything else
     to join. */
  const script = joinCommand(
    { ...tricky, panelUrl: "https://203.0.113.10" },
    "bash",
  ).replace(/^sudo bash deploy\/linux\/install\.sh/m, PRINT);
  const run = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), [
    "https://203.0.113.10",
    tricky.registrationToken,
    "--advertise",
    "http://10.0.0.5:9090",
    "--capabilities",
    "steamcmd",
    "--panel-ca",
    "auto",
  ]);
});

test(
  "PowerShell hands the installer every value unchanged",
  { skip: !available("powershell", ["-NoProfile", "-Command", "exit 0"]) || process.platform !== "win32" },
  () => {
    /* A real script with the installer's own parameters, run by the
       generated command line: what is being proved is that PowerShell's
       parser hands each value over as it was written, typographic quotes
       and all. Those are what a URL pasted from a document carries, and
       PowerShell treats them as string delimiters. */
    const dir = process.env.TEMP ?? ".";
    const stand = `${dir}\\geeboard-install-node-${process.pid}.ps1`;
    spawnSync("powershell", [
      "-NoProfile",
      "-Command",
      `Set-Content -Encoding utf8 '${stand}' @'
param([string]$Panel, [string]$Token, [string]$Advertise, [string]$Capabilities)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::Out.Write((ConvertTo-Json -Compress @($Panel, $Token, "--advertise", $Advertise, "--capabilities", $Capabilities)))
'@`,
    ]);
    const script =
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
      joinCommand(tricky, "powershell")
        .replace(/^#.*$/m, "")
        .replace(/^powershell -ExecutionPolicy Bypass -File \.\\deploy\\windows\\install-node\.ps1/m, `& '${stand}'`);
    // Passed encoded, so the test's own argument quoting cannot help or hide anything.
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const run = spawnSync("powershell", ["-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
    spawnSync("powershell", ["-NoProfile", "-Command", `Remove-Item -Force '${stand}'`]);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout.trim()), expected);
  },
);
