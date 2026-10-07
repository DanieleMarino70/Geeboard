import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { agentFilePath, readAgentFile, writeAgentFile, type AgentFile } from "../src/agent-file.ts";
import { defaultDataRoot, loadConfig } from "../src/config.ts";
import { JoinUsageError, advertiseFrom, parseJoinArgs, planJoin } from "../src/join.ts";

/* Joining a machine: the arguments the dialog's command passes, the
   address the agent works out for itself, and the file that lets a plain
   `npm start` remember all of it. */

let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "geeboard-join-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const JOINED: AgentFile = {
  panelUrl: "http://10.0.0.2:3000",
  nodeName: "win-node-1",
  token: "f".repeat(64),
  advertiseUrl: "http://10.0.0.5:8080",
  port: 8080,
  dataRoot: "/srv/geeboard",
  capabilities: ["steamcmd"],
  joinedAt: "2026-09-17T10:00:00.000Z",
};

/* ── Arguments ────────────────────────────────────────────────────── */

test("the panel address and the token are all a join needs", () => {
  const args = parseJoinArgs(["http://localhost:3000/nodes", "gbn_abc123"]);
  assert.equal(args.panelUrl, "http://localhost:3000", "origin only — the page is not part of it");
  assert.equal(args.registrationToken, "gbn_abc123");
  assert.equal(args.advertiseUrl, null, "worked out on the machine");
  assert.equal(args.port, 8080);
  assert.deepEqual(args.capabilities, []);
});

test("options come either way, and the listening port follows an advertised one", () => {
  const args = parseJoinArgs([
    "http://panel:3000",
    "gbn_x",
    "--advertise",
    "http://203.0.113.9:9090/",
    "--capabilities=SteamCMD, java",
  ]);
  assert.equal(args.advertiseUrl, "http://203.0.113.9:9090");
  assert.equal(args.port, 9090);
  assert.deepEqual(args.capabilities, ["steamcmd", "java"]);

  // An address with no port is a proxy in front; the agent keeps its default.
  assert.equal(parseJoinArgs(["http://panel:3000", "gbn_x", "--advertise", "https://node.example.net"]).port, 8080);
  assert.equal(parseJoinArgs(["http://panel:3000", "gbn_x", "--port", "9100"]).port, 9100);
});

test("--no-start is for an install where a service starts the agent", () => {
  assert.equal(parseJoinArgs(["http://panel:3000", "gbn_x"]).noStart, false);
  assert.equal(parseJoinArgs(["http://panel:3000", "gbn_x", "--no-start"]).noStart, true);
  // A flag, not an option: it takes no value and swallows nothing after it.
  const args = parseJoinArgs(["http://panel:3000", "gbn_x", "--no-start", "--port", "9100"]);
  assert.equal(args.noStart, true);
  assert.equal(args.port, 9100);
});

test("a pair of quotes around a value is not part of it, whatever shell it was pasted into", () => {
  // Command Prompt keeps the single quotes the command was written with for PowerShell; a document or a chat makes them curly.
  for (const [open, close] of [["'", "'"], ['"', '"'], ["\u2018", "\u2019"], ["\u201c", "\u201d"]] as const) {
    const args = parseJoinArgs([
      `${open}https://panel.example.net:3000${close}`,
      `${open}gbn_abc123${close}`,
      "--advertise",
      `${open}http://203.0.113.9:9090${close}`,
      "--data-root",
      `${open}D:\\Games Data${close}`,
    ]);
    assert.equal(args.panelUrl, "https://panel.example.net:3000", open);
    assert.equal(args.registrationToken, "gbn_abc123", open);
    assert.equal(args.advertiseUrl, "http://203.0.113.9:9090", open);
    assert.equal(args.dataRoot, "D:\\Games Data", open);
  }
  // Only a pair, and only around the whole value: a quote inside it stays.
  assert.equal(parseJoinArgs(["http://panel:3000", "gb'n_x"]).registrationToken, "gb'n_x");
  assert.equal(parseJoinArgs(["http://panel:3000", "'gbn_x"]).registrationToken, "'gbn_x");
});

test("a join that cannot work is refused before it touches anything", () => {
  const refused = [
    [],
    ["http://panel:3000"],
    ["panel:3000", "gbn_x"],
    ["ftp://panel", "gbn_x"],
    ["http://panel:3000", "gbn_x", "extra"],
    ["http://panel:3000", "gbn_x", "--port", "0"],
    ["http://panel:3000", "gbn_x", "--port"],
    ["http://panel:3000", "gbn_x", "--token", "t"],
    ["http://panel:3000", "gbn_x", "--advertise", "10.0.0.5:8080"],
  ];
  for (const argv of refused) {
    assert.throws(() => parseJoinArgs(argv), JoinUsageError, JSON.stringify(argv));
  }
});

test("what the run says and what it leaves out are told apart", () => {
  const bare = parseJoinArgs(["http://panel:3000", "gbn_x"]);
  assert.equal(bare.portGiven, false);
  assert.equal(bare.capabilitiesGiven, false);
  assert.equal(bare.replace, false);
  assert.equal(bare.noTerminal, false);

  assert.equal(parseJoinArgs(["http://panel:3000", "gbn_x", "--port", "9100"]).portGiven, true);
  // A port in the advertised address names the port too.
  assert.equal(parseJoinArgs(["http://panel:3000", "gbn_x", "--advertise", "http://203.0.113.9:9090"]).portGiven, true);
  assert.equal(parseJoinArgs(["http://panel:3000", "gbn_x", "--advertise", "https://node.example.net"]).portGiven, false);

  const none = parseJoinArgs(["http://panel:3000", "gbn_x", "--capabilities", "none"]);
  assert.equal(none.capabilitiesGiven, true, "given, and empty: consent withdrawn");
  assert.deepEqual(none.capabilities, []);
  assert.equal(parseJoinArgs(["http://panel:3000", "gbn_x", "--replace", "--no-terminal"]).replace, true);
  assert.equal(parseJoinArgs(["http://panel:3000", "gbn_x", "--no-terminal"]).noTerminal, true);
  assert.throws(() => parseJoinArgs(["http://panel:3000", "gbn_x", "--terminal", "--no-terminal"]), JoinUsageError);
});

/* ── Joining again ────────────────────────────────────────────────── */

const BEFORE: AgentFile = {
  ...JOINED,
  nodeName: "win-node-1",
  port: 8181,
  dataRoot: "D:\\GameServers",
  capabilities: ["steamcmd", "community-games"],
  advertiseUrl: "http://203.0.113.9:8181",
  advertiseExplicit: true,
  terminal: true,
};
const NO_ENV = {} as NodeJS.ProcessEnv;
const command = (...rest: string[]) => parseJoinArgs(["https://panel.example.net", "gbn_new", ...rest]);

test("the panel's command, run again, changes nothing it does not carry", () => {
  // What the dialog writes: an address and a token, and nothing about a port or a data root.
  const plan = planJoin(command(), BEFORE, NO_ENV, "C:\\ProgramData\\Geeboard\\servers");
  assert.equal(plan.dataRoot, "D:\\GameServers", "the data root: the servers are there");
  assert.equal(plan.port, 8181, "the port the router forwards to");
  assert.deepEqual(plan.capabilities, ["steamcmd", "community-games"], "what this PC declared");
  assert.equal(plan.terminal, true, "a shell the operator allowed stays allowed");
  assert.equal(plan.advertiseUrl, "http://203.0.113.9:8181", "an address that was given by hand is a decision");
  assert.equal(plan.nodeName, "win-node-1", "sent, so that a token for another node is refused before it is spent");
  assert.deepEqual(plan.kept.map((line) => line.split(" ")[0]), ["data", "port", "capabilities", "node", "address"]);
});

test("the run's own words win, one setting at a time", () => {
  assert.equal(planJoin(command("--data-root", "E:\\Games"), BEFORE, NO_ENV, "x").dataRoot, "E:\\Games");
  assert.deepEqual(planJoin(command("--capabilities", "java"), BEFORE, NO_ENV, "x").capabilities, ["java"], "replaces, so consent can be withdrawn");
  assert.deepEqual(planJoin(command("--capabilities", "none"), BEFORE, NO_ENV, "x").capabilities, []);
  assert.equal(planJoin(command("--no-terminal"), BEFORE, NO_ENV, "x").terminal, false);
  assert.equal(planJoin(command("--terminal"), { ...BEFORE, terminal: false }, NO_ENV, "x").terminal, true);
  assert.equal(planJoin(command("--replace"), BEFORE, NO_ENV, "x").nodeName, null, "the token's own name");
  // The environment is a way of saying it too, and wins over the file.
  assert.equal(planJoin(command(), BEFORE, { GEEBOARD_DATA_ROOT: "F:\\Env" } as NodeJS.ProcessEnv, "x").dataRoot, "F:\\Env");
});

test("a new port does not keep an address that names the old one", () => {
  const plan = planJoin(command("--port", "9000"), BEFORE, NO_ENV, "x");
  assert.equal(plan.port, 9000);
  assert.equal(plan.advertiseUrl, null, "worked out again, for the new port");
  // An address with no port is a proxy in front of the agent, and stays whatever the port is.
  const proxied = { ...BEFORE, advertiseUrl: "https://node.example.net" };
  assert.equal(planJoin(command("--port", "9000"), proxied, NO_ENV, "x").advertiseUrl, "https://node.example.net");
  // And one that does not parse is not kept.
  assert.equal(planJoin(command(), { ...BEFORE, advertiseUrl: "not an address" }, NO_ENV, "x").advertiseUrl, null);
});

test("an address that was worked out is worked out again: a DHCP lease changes", () => {
  const plan = planJoin(command(), { ...BEFORE, advertiseExplicit: false }, NO_ENV, "x");
  assert.equal(plan.advertiseUrl, null);
  assert.ok(!plan.kept.some((line) => line.startsWith("address")));
});

test("the first join has nothing to keep, and the node is the token's", () => {
  const plan = planJoin(command(), null, NO_ENV, "C:\\ProgramData\\Geeboard\\servers");
  assert.deepEqual(plan, {
    dataRoot: "C:\\ProgramData\\Geeboard\\servers",
    port: 8080,
    capabilities: [],
    terminal: false,
    advertiseUrl: null,
    nodeName: null,
    kept: [],
  });
});

/* ── The address the panel will use ───────────────────────────────── */

test("the advertised address is the one the machine reaches the panel from", () => {
  assert.equal(advertiseFrom("127.0.0.1", 8080), "http://127.0.0.1:8080");
  assert.equal(advertiseFrom("192.168.1.20", 9090), "http://192.168.1.20:9090");
  // An IPv4 address seen through a dual-stack socket is still IPv4.
  assert.equal(advertiseFrom("::ffff:192.168.1.20", 8080), "http://192.168.1.20:8080");
  assert.equal(advertiseFrom("fd00::5", 8080), "http://[fd00::5]:8080");
});

/* ── The file ─────────────────────────────────────────────────────── */

test("the file lives in the account's own profile", () => {
  assert.equal(
    agentFilePath({ LOCALAPPDATA: "C:\\Users\\mara\\AppData\\Local" }, "win32", "C:\\Users\\mara", null),
    "C:\\Users\\mara\\AppData\\Local\\Geeboard\\agent.json",
  );
  assert.equal(agentFilePath({}, "linux", "/home/mara", 1000), "/home/mara/.config/geeboard/agent.json");
  assert.equal(agentFilePath({ XDG_CONFIG_HOME: "/cfg" }, "linux", "/home/mara", 1000), "/cfg/geeboard/agent.json");
  assert.equal(agentFilePath({}, "linux", "/root", 0), "/etc/geeboard/agent.json");
  assert.equal(agentFilePath({ GEEBOARD_AGENT_FILE: "/tmp/a.json" }, "linux", "/home/mara", 1000), "/tmp/a.json");
});

test("what join writes, start reads back", async () => {
  const file = path.join(dir, "nested", "agent.json");
  writeAgentFile(file, JOINED);
  assert.deepEqual(readAgentFile(file), JOINED);

  // The agent token is in it, so on Unix only its owner can read it.
  if (process.platform !== "win32") {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
  }
  assert.deepEqual(await readdir(path.dirname(file)), ["agent.json"], "no temporary file left beside it");
});

test("a file with a byte order mark reads like any other", async () => {
  // Windows PowerShell 5.1's Set-Content -Encoding utf8 writes one, and so does Notepad.
  const withMark = path.join(dir, "bom.json");
  await writeFile(withMark, "\uFEFF" + JSON.stringify(JOINED));
  assert.deepEqual(readAgentFile(withMark), JOINED);
});

test("no file means not joined; a broken one is refused whole", async () => {
  assert.equal(readAgentFile(path.join(dir, "missing.json")), null);

  const broken = path.join(dir, "broken.json");
  await writeFile(broken, "{ not json");
  assert.throws(() => readAgentFile(broken), /not valid JSON/);

  const partial = path.join(dir, "partial.json");
  await writeFile(partial, JSON.stringify({ ...JOINED, token: "" }));
  assert.throws(() => readAgentFile(partial), /incomplete/);
});

/* ── What start does with it ──────────────────────────────────────── */

test("start runs from the file alone", () => {
  const config = loadConfig({ GEEBOARD_AGENT_FILE: "joined.json" }, () => JOINED);
  assert.equal(config.nodeName, "win-node-1");
  assert.equal(config.token, JOINED.token);
  assert.equal(config.panelUrl, "http://10.0.0.2:3000");
  assert.equal(config.advertiseUrl, "http://10.0.0.5:8080");
  assert.equal(config.dataRoot, "/srv/geeboard");
  assert.deepEqual(config.capabilities, ["steamcmd"]);
  assert.equal(config.registrationToken, null, "joined once; never registers again by itself");
  assert.equal(config.agentFile, "joined.json");
});

test("a variable that is set wins over the file", () => {
  const config = loadConfig(
    { GEEBOARD_AGENT_FILE: "joined.json", GEEBOARD_DAEMON_PORT: "9999", GEEBOARD_CAPABILITIES: "java" },
    () => JOINED,
  );
  assert.equal(config.port, 9999);
  assert.deepEqual(config.capabilities, ["java"]);
  assert.equal(config.token, JOINED.token);
});

test("an environment that configures the agent completely never reads the file", () => {
  let read = false;
  const config = loadConfig({ GEEBOARD_DAEMON_TOKEN: "e".repeat(40), GEEBOARD_NODE_NAME: "env-node" }, () => {
    read = true;
    return JOINED;
  });
  assert.equal(read, false);
  assert.equal(config.nodeName, "env-node");
  assert.equal(config.panelUrl, null);
});

test("an agent that has not joined says how to", () => {
  assert.throws(() => loadConfig({}, () => null), /npm run join/);
});

test("the data root defaults to where a service keeps data on each platform", () => {
  assert.equal(defaultDataRoot({ ProgramData: "C:\\ProgramData" }, "win32"), "C:\\ProgramData\\Geeboard\\servers");
  assert.equal(defaultDataRoot({}, "linux"), "/var/lib/geeboard/servers");
});
