import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
process.loadEnvFile(path.join(process.cwd(), ".env"));

/* Files, through the real agent over HTTP. files.test.ts already proves
   the containment logic; this proves the wiring around it — that the
   panel's actions reach the right directory, and that a traversal
   attempt is still refused once it has crossed the network. */

const { db } = await import("../src/lib/db");
const { encryptSecret } = await import("../src/lib/secrets");
const { seed } = await import("../prisma/seed");

const TOKEN = "files-token-that-is-long-enough-here!";
const PORT = 8600 + Math.floor(Math.random() * 90);

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} ${detail}`);
  }
};

let agent: ChildProcess | undefined;
let dataRoot: string;
let outside: string;

async function waitFor(fn: () => Promise<boolean>, label: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await fn()) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

try {
  await seed();

  const base = await mkdtemp(path.join(tmpdir(), "geeboard-verify-files-"));
  dataRoot = path.join(base, "servers");
  outside = path.join(base, "outside");
  await mkdir(dataRoot, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, "panel.env"), "SESSION_SECRET=do-not-read-me\n");

  const aurora = (await db.server.findUnique({ where: { slug: "aurora" } }))!;
  const serverRoot = path.join(dataRoot, aurora.id);
  await mkdir(path.join(serverRoot, "plugins"), { recursive: true });
  await writeFile(path.join(serverRoot, "server.properties"), "level-name=aurora\nmax-players=40\n");
  await writeFile(path.join(serverRoot, "plugins", "config.yml"), "storage: h2\n");

  agent = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: {
      ...process.env,
      GEEBOARD_DAEMON_TOKEN: TOKEN,
      GEEBOARD_DAEMON_PORT: String(PORT),
      GEEBOARD_NODE_NAME: "fra-node-02",
      GEEBOARD_DATA_ROOT: dataRoot,
    },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/health`)).ok, "agent");

  await db.node.update({
    where: { name: "fra-node-02" },
    data: { daemonUrl: `http://127.0.0.1:${PORT}`, daemonToken: encryptSecret(TOKEN) },
  });

  /* The server actions call requireUser(), which needs a request
     context, so the agent client is exercised directly — the same code
     path from the client down, minus the auth wrapper the panel adds. */
  const { agentFor } = await import("../src/lib/daemon-client");
  const node = (await db.node.findUnique({ where: { name: "fra-node-02" } }))!;
  const client = agentFor(node)!;

  console.log("\n== listing ==");
  const root = await client.listFiles(aurora.id, "/");
  const names = root.entries.map((e) => e.name);
  check("lists the server's files", names.includes("server.properties"), names.join(","));
  check("directories come first", root.entries[0]?.kind === "directory", root.entries[0]?.name);
  check("reports a real size", (root.entries.find((e) => e.name === "server.properties")?.sizeBytes ?? 0) > 0);
  check("reports a mode string", /^[rwx-]{9}$/.test(root.entries.find((e) => e.name === "server.properties")!.mode));

  const sub = await client.listFiles(aurora.id, "plugins");
  check("lists a subdirectory", sub.entries.some((e) => e.name === "config.yml"));

  console.log("\n== reading and writing ==");
  const file = await client.readFile(aurora.id, "server.properties");
  check("reads a file", file.content.includes("level-name=aurora"));
  check("is not truncated", file.truncated === false);

  await client.writeFile(aurora.id, "server.properties", "level-name=aurora\nmax-players=60\n");
  const onDisk = await readFile(path.join(serverRoot, "server.properties"), "utf8");
  check("a write lands on disk", onDisk.includes("max-players=60"), onDisk.trim());

  await client.writeFile(aurora.id, "config/deep/new.yml", "created: true\n");
  check(
    "writing creates missing parents",
    (await readFile(path.join(serverRoot, "config", "deep", "new.yml"), "utf8")).includes("created"),
  );

  console.log("\n== directories, move and delete ==");
  await client.makeDirectory(aurora.id, "logs/archive");
  const logs = await client.listFiles(aurora.id, "logs");
  check("creates a directory", logs.entries.some((e) => e.name === "archive"));

  await client.moveFile(aurora.id, "config/deep/new.yml", "config/renamed.yml");
  const renamed = await client.readFile(aurora.id, "config/renamed.yml");
  check("moves a file", renamed.content.includes("created: true"));

  await client.deleteFile(aurora.id, "config/renamed.yml");
  let gone = false;
  try {
    await client.readFile(aurora.id, "config/renamed.yml");
  } catch {
    gone = true;
  }
  check("deletes a file", gone);

  console.log("\n== traversal over the wire ==");
  const attempts = [
    "../../outside/panel.env",
    "../outside/panel.env",
    "plugins/../../../outside/panel.env",
    "/../outside/panel.env",
    "..%2f..%2foutside%2fpanel.env",
  ];
  let refused = 0;
  for (const attempt of attempts) {
    try {
      const res = await client.readFile(aurora.id, attempt);
      // A refusal can also arrive as a not-found, which is equally safe.
      if (!res.content.includes("do-not-read-me")) refused++;
    } catch {
      refused++;
    }
  }
  check(`every traversal attempt refused (${refused}/${attempts.length})`, refused === attempts.length);

  let writeRefused = false;
  try {
    await client.writeFile(aurora.id, "../outside/owned.txt", "owned");
  } catch {
    writeRefused = true;
  }
  check("a traversing write is refused", writeRefused);
  check(
    "the file outside the root is untouched",
    (await readFile(path.join(outside, "panel.env"), "utf8")).includes("do-not-read-me"),
  );

  console.log("\n== one server cannot read another ==");
  const creative = (await db.server.findUnique({ where: { slug: "creative" } }))!;
  const other = await client.listFiles(creative.id, "/");
  check("a different server gets its own empty directory", other.entries.length === 0, String(other.entries.length));
  check(
    "and cannot see the first server's files",
    !other.entries.some((e) => e.name === "server.properties"),
  );

  console.log("\n== the root itself is protected ==");
  let rootDelete = false;
  try {
    await client.deleteFile(aurora.id, "/");
  } catch {
    rootDelete = true;
  }
  check("deleting the server root is refused", rootDelete);
  check(
    "the server's files are still there",
    (await client.listFiles(aurora.id, "/")).entries.length > 0,
  );

  console.log("\n== unauthenticated access ==");
  const bare = await fetch(`http://127.0.0.1:${PORT}/servers/${aurora.id}/files?path=/`);
  check("the files API needs a token", bare.status === 401, String(bare.status));
} finally {
  agent?.kill();
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
