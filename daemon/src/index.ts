import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { WebSocketServer } from "ws";
import { anyTokenMatches, bearerFrom, isAuthorized } from "./auth.ts";
import { RotationError, acceptedTokens, beginRotation, commitRotation } from "./rotate.ts";
import {
  BackupError,
  createArchive,
  listArchives,
  removeArchive,
  restoreArchive,
  verifyArchive,
} from "./backups.ts";
import { capabilities, load, platformReporter, resources } from "./capabilities.ts";
import { loadConfig, type Config } from "./config.ts";
import { DockerEngine } from "./docker.ts";
import { logger, requestIdOf } from "./log.ts";
import { ExchangeError, parseExchange } from "./exchange.ts";
import {
  NotFoundError,
  PathError,
  directorySize,
  ensureRoot,
  list as listFiles,
  makeDirectory,
  move,
  openForRead,
  read as readFileAt,
  writeFromStream,
  remove,
  rootFor,
  write as writeFileAt,
} from "./files.ts";
import { installedMods } from "./mods.ts";
import { panelClient } from "./panel.ts";
import { NotManagedError, SpecError, parseCreate } from "./provision.ts";
import { downloadArchive, uploadArchive } from "./transfer.ts";

/* The node agent. One of these runs on every machine that hosts game
   servers; the panel is the only thing that talks to it. */

const config: Config = loadConfig();
const engine = new DockerEngine({
  managedLabel: config.managedLabel,
  dataRoot: config.dataRoot,
  containerPrefix: config.containerPrefix,
  pullTimeoutMs: config.pullTimeoutMs,
});
/* One reporter for every route that says what this node is, so /version
   and the heartbeat cannot disagree about it. */
const platform = platformReporter(() => engine.info());

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    // The panel is the only client; nothing here is browser-facing.
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  open?: boolean;
}

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler, open = false) {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
      keys.push(key);
      return "([^/]+)";
    })}$`,
  );
  routes.push({ method, pattern, keys, handler, open });
}

/* Liveness only — deliberately unauthenticated so an orchestrator can
   probe it, and deliberately free of any detail about what is running. */
route(
  "GET",
  "/health",
  async (_req, res) => {
    try {
      await engine.ping();
      send(res, 200, { ok: true, node: config.nodeName });
    } catch {
      send(res, 503, { ok: false, error: "docker unreachable" });
    }
  },
  true,
);

/* What this node is. The panel reads it to fill in a node's platform,
   capabilities and size — the same facts registration sends, so a node
   attached by hand is not a second-class one. */
route("GET", "/version", async (_req, res) => {
  send(res, 200, {
    node: config.nodeName,
    agent: config.version,
    docker: await engine.version(),
    ...(await platform()),
    capabilities: await capabilities(config.capabilities, config.dataRoot, platform.engineMemory()),
    resources: await resources(config.dataRoot, platform.engineMemory()),
    load: await load(config.dataRoot),
  });
});

route("GET", "/servers", async (_req, res) => {
  send(res, 200, { servers: await engine.list() });
});

route("GET", "/servers/:id", async (_req, res, params) => {
  send(res, 200, await engine.status(params.id!));
});

/* ── Creating and destroying ──────────────────────────────────────
   The one pair of routes that changes what exists on the node, rather
   than driving something that already does. provision.ts refuses a bad
   request before Docker ever sees it. */

route("POST", "/servers", async (req, res) => {
  const spec = parseCreate(await readJson(req));
  send(res, 201, await engine.create(spec));
});

route("DELETE", "/servers/:id", async (req, res, params) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  // Keeping a server's world after its container is gone has to be the
  // deliberate choice, so removing the data is opt-in.
  const withData = url.searchParams.get("data") === "true";
  send(res, 200, await engine.destroy(params.id!, withData));
});

route("POST", "/servers/:id/start", async (_req, res, params) => {
  send(res, 200, await engine.start(params.id!));
});

route("POST", "/servers/:id/stop", async (req, res, params) => {
  const body = await readJson(req);
  const grace = typeof body.graceSeconds === "number" ? body.graceSeconds : 30;
  send(res, 200, await engine.stop(params.id!, grace));
});

route("POST", "/servers/:id/restart", async (req, res, params) => {
  const body = await readJson(req);
  const grace = typeof body.graceSeconds === "number" ? body.graceSeconds : 30;
  send(res, 200, await engine.restart(params.id!, grace));
});

route("GET", "/servers/:id/stats", async (_req, res, params) => {
  send(res, 200, await engine.sample(params.id!));
});

/* One TCP probe against a port this server publishes. The panel decides
   which ports are worth probing; see docs/servers.md on health. */
route("GET", "/servers/:id/probe", async (req, res, params) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const port = Number(url.searchParams.get("port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    send(res, 400, { error: "port must be a number between 1 and 65535" });
    return;
  }
  send(res, 200, await engine.probePort(params.id!, port));
});

/* Changing this agent's token, in two steps — see rotate.ts. The new
   token arrives over the channel the old one authenticates; nothing here
   answers with a token, ever. */
route("POST", "/token", async (req, res) => {
  beginRotation(config, (await readJson(req)).token);
  send(res, 200, { rotated: true, pending: true });
});

route("POST", "/token/commit", async (req, res) => {
  send(res, 200, { committed: commitRotation(config, bearerFrom(req)) });
});

/* One exchange with a port this server publishes: the bytes the panel
   sends, and whatever answered. The panel knows what the bytes mean; this
   knows only that they may go nowhere else. See exchange.ts. */
route("POST", "/servers/:id/probe/exchange", async (req, res, params) => {
  send(res, 200, await engine.exchange(params.id!, parseExchange(await readJson(req))));
});

route("GET", "/servers/:id/logs", async (req, res, params) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const tail = Math.min(2000, Number(url.searchParams.get("tail") ?? 200) || 200);
  // Seconds since the epoch; anything else is ignored rather than guessed at.
  const sinceRaw = Number(url.searchParams.get("since"));
  const since = url.searchParams.has("since") && Number.isFinite(sinceRaw) && sinceRaw >= 0 ? Math.floor(sinceRaw) : undefined;
  send(res, 200, { lines: await engine.logs(params.id!, tail, since) });
});

/* How much a server's directory holds. By server id, like the file API:
   the directory outlives any one workload. */
route("GET", "/servers/:id/usage", async (_req, res, params) => {
  await withRoot(res, params.id!, async (root) => {
    send(res, 200, await directorySize(root));
  });
});

/* What this server has downloaded from the Workshop, and what is in it.

   The panel writes the Workshop ids into the game's settings and the
   game fetches them here; only this machine can say what those downloads
   turned out to contain, and the name a mod is loaded by is inside its
   files, not in anything Steam returns. `mount` and `at` come from the
   game's definition and are resolved inside this server's own cache
   mount — see mods.ts, where the containment is the same as a file's. */
route("GET", "/servers/:id/mods", async (req, res, params) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const mount = url.searchParams.get("mount") ?? "";
  const at = url.searchParams.get("at") ?? "/";
  if (!mount) {
    send(res, 400, { error: "mount is required" });
    return;
  }

  try {
    send(res, 200, { items: await installedMods(config.dataRoot, params.id!, mount, at) });
  } catch (error) {
    if (!refusal(res, error)) throw error;
  }
});

/* ── Files ────────────────────────────────────────────────────────
   Each server owns a directory under the data root. Every path in a
   request is resolved inside it and refused if it escapes — see
   files.ts, which is where the containment lives. */

function pathParam(req: IncomingMessage): string {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams.get("path") ?? "/";
}

/** Maps a refusal onto the status it deserves. */
function refusal(res: ServerResponse, error: unknown): boolean {
  if (error instanceof PathError || error instanceof SpecError || error instanceof ExchangeError) {
    send(res, 400, { error: error.message });
    return true;
  }
  if (error instanceof RotationError) {
    send(res, 409, { error: error.message });
    return true;
  }
  if (error instanceof NotManagedError) {
    send(res, 403, { error: error.message });
    return true;
  }
  if (error instanceof NotFoundError) {
    send(res, 404, { error: error.message });
    return true;
  }
  if (error instanceof BackupError) {
    send(res, 422, { error: error.message });
    return true;
  }
  return false;
}

async function withRoot(
  res: ServerResponse,
  serverId: string,
  run: (root: string) => Promise<void>,
): Promise<void> {
  let root: string;
  try {
    root = rootFor(config.dataRoot, serverId);
  } catch (error) {
    if (!refusal(res, error)) throw error;
    return;
  }

  try {
    await ensureRoot(root);
    await run(root);
  } catch (error) {
    if (!refusal(res, error)) throw error;
  }
}

route("GET", "/servers/:id/files", async (req, res, params) => {
  await withRoot(res, params.id!, async (root) => {
    send(res, 200, { path: pathParam(req), entries: await listFiles(root, pathParam(req)) });
  });
});

route("GET", "/servers/:id/files/content", async (req, res, params) => {
  await withRoot(res, params.id!, async (root) => {
    send(res, 200, await readFileAt(root, pathParam(req)));
  });
});

/* The same two, for bytes: streamed, so a plugin jar is never held in
   memory here, and capped — see files.ts. The body of the PUT is the
   file itself, not JSON. */
route("GET", "/servers/:id/files/raw", async (req, res, params) => {
  await withRoot(res, params.id!, async (root) => {
    const file = await openForRead(root, pathParam(req));
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(file.sizeBytes) });
    await pipeline(file.stream, res);
  });
});

route("PUT", "/servers/:id/files/raw", async (req, res, params) => {
  await withRoot(res, params.id!, async (root) => {
    send(res, 200, await writeFromStream(root, pathParam(req), req));
  });
});

route("PUT", "/servers/:id/files/content", async (req, res, params) => {
  const body = await readJson(req);
  if (typeof body.content !== "string") {
    send(res, 400, { error: "content must be a string" });
    return;
  }
  await withRoot(res, params.id!, async (root) => {
    send(res, 200, await writeFileAt(root, pathParam(req), body.content as string));
  });
});

route("POST", "/servers/:id/files/directory", async (req, res, params) => {
  await withRoot(res, params.id!, async (root) => {
    await makeDirectory(root, pathParam(req));
    send(res, 201, { created: pathParam(req) });
  });
});

route("POST", "/servers/:id/files/move", async (req, res, params) => {
  const body = await readJson(req);
  if (typeof body.from !== "string" || typeof body.to !== "string") {
    send(res, 400, { error: "from and to are required" });
    return;
  }
  await withRoot(res, params.id!, async (root) => {
    await move(root, body.from as string, body.to as string);
    send(res, 200, { from: body.from, to: body.to });
  });
});

route("DELETE", "/servers/:id/files", async (req, res, params) => {
  await withRoot(res, params.id!, async (root) => {
    await remove(root, pathParam(req));
    send(res, 200, { deleted: pathParam(req) });
  });
});

/* ── Backups ──────────────────────────────────────────────────────
   Archiving a server's world, which is the other half of the file API:
   that one is text and kilobytes, this one is gigabytes and streamed.
   Nothing here is ever handed to a browser. */

route("POST", "/servers/:id/backups", async (req, res, params) => {
  const body = await readJson(req);
  const name = typeof body.name === "string" ? body.name : `backup-${Date.now()}`;
  send(res, 201, await createArchive(config.dataRoot, params.id!, name));
});

route("GET", "/servers/:id/backups", async (_req, res, params) => {
  send(res, 200, { backups: await listArchives(config.dataRoot, params.id!) });
});

route("GET", "/servers/:id/backups/:artifact/verify", async (_req, res, params) => {
  send(res, 200, await verifyArchive(config.dataRoot, params.id!, params.artifact!));
});

route("DELETE", "/servers/:id/backups/:artifact", async (_req, res, params) => {
  await removeArchive(config.dataRoot, params.id!, params.artifact!);
  send(res, 200, { deleted: params.artifact });
});

/* Restoring replaces the server's directory wholesale. The panel is
   responsible for stopping the server first — unpacking a world under a
   running process is how a save file becomes two halves of different
   saves. */
route("POST", "/servers/:id/backups/:artifact/restore", async (req, res, params) => {
  const body = await readJson(req);
  const checksum = typeof body.checksum === "string" ? body.checksum : undefined;
  send(res, 200, await restoreArchive(config.dataRoot, params.id!, params.artifact!, checksum));
});

/* Off-site copies. The panel signs a URL that allows one PUT or one GET
   of one object for a few minutes and hands it here; the node streams
   the bytes and never sees a credential. */
route("POST", "/servers/:id/backups/:artifact/upload", async (req, res, params) => {
  const body = await readJson(req);
  if (typeof body.url !== "string") {
    send(res, 400, { error: "url is required" });
    return;
  }
  send(res, 200, await uploadArchive(config.dataRoot, params.id!, params.artifact!, body.url));
});

route("POST", "/servers/:id/backups/:artifact/download", async (req, res, params) => {
  const body = await readJson(req);
  if (typeof body.url !== "string") {
    send(res, 400, { error: "url is required" });
    return;
  }
  const checksum = typeof body.checksum === "string" ? body.checksum : undefined;
  send(res, 200, await downloadArchive(config.dataRoot, params.id!, params.artifact!, body.url, checksum));
});

route("POST", "/servers/:id/command", async (req, res, params) => {
  const body = await readJson(req);
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) {
    send(res, 400, { error: "command is required" });
    return;
  }
  if (command.includes("\n")) {
    send(res, 400, { error: "command must be a single line" });
    return;
  }
  await engine.sendCommand(params.id!, command);
  send(res, 202, { sent: command });
});

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const match = routes.find(
    (r) => r.method === req.method && r.pattern.test(url.pathname),
  );

  /* The panel's id for whatever it is doing, put on every line this
     request writes — see log.ts. `/health` is left out: an orchestrator
     polls it every few seconds and its lines would bury everything else. */
  const requestId = requestIdOf(req.headers);
  const started = Date.now();
  const quiet = url.pathname === "/health";
  if (!quiet) {
    res.once("finish", () => {
      const fields = { requestId, method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started };
      // A refusal is worth a line at the ordinary level; the rest is for a debug hour.
      if (res.statusCode >= 400) logger.warn("request refused", fields);
      else logger.debug("request", fields);
    });
  }

  if (!match) {
    send(res, 404, { error: "not found" });
    return;
  }

  if (!match.open && !isAuthorized(req, acceptedTokens(config))) {
    send(res, 401, { error: "unauthorized" });
    return;
  }

  const captured = match.pattern.exec(url.pathname)!;
  const params: Record<string, string> = {};
  match.keys.forEach((key, i) => {
    params[key] = decodeURIComponent(captured[i + 1] ?? "");
  });

  match.handler(req, res, params).catch((error: unknown) => {
    // A refused request is not a fault; it deserves its own status.
    if (refusal(res, error)) return;

    const message = error instanceof Error ? error.message : "unknown error";
    // Docker's 404 for a missing container should not read as a daemon fault.
    const status = /no such container/i.test(message) ? 404 : 500;
    if (status === 500) logger.error("request failed", { requestId, method: req.method, path: url.pathname, detail: message });
    // A name clash is the caller's problem too, and a common one.
    send(res, /already in use/i.test(message) ? 409 : status, { error: message });
  });
});

/* Console streaming. The panel opens ws://node/servers/<id>/console and
   receives one JSON message per output line. */
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const match = /^\/servers\/([^/]+)\/console$/.exec(url.pathname);

  // A browser cannot set headers on a WebSocket handshake, so the token
  // may also arrive as a query parameter. The panel proxies this
  // connection, so the token never reaches a browser either way.
  const queryToken = url.searchParams.get("token");
  // Compared in constant time like the header; it used to be a plain ===.
  const authorized =
    isAuthorized(req, acceptedTokens(config)) ||
    (queryToken !== null && anyTokenMatches(queryToken, acceptedTokens(config)));

  if (!match || !authorized) {
    socket.write(`HTTP/1.1 ${match ? 401 : 404} \r\n\r\n`);
    socket.destroy();
    return;
  }

  const id = decodeURIComponent(match[1]!);
  wss.handleUpgrade(req, socket, head, (ws) => {
    engine
      .follow(id, (line, stderr) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ at: new Date().toISOString(), line, stderr }));
        }
      })
      .then((stop) => {
        ws.on("close", stop);
        ws.on("error", stop);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown error";
        ws.send(JSON.stringify({ error: message }));
        ws.close();
      });
  });
});

server.listen(config.port, config.host, () => {
  logger.info("agent listening", {
    node: config.nodeName,
    address: `${config.host}:${config.port}`,
    sampleMs: config.sampleIntervalMs,
    label: config.managedLabel,
    version: config.version,
  });
});

/* Introducing itself to the panel, if it has been told where one is.

   Deliberately after listen(): registration hands the panel an address
   it will start calling, so the agent had better already be answering
   on it. Deliberately not awaited, either — a panel that is down must
   delay nothing here, because the containers on this machine do not
   need the panel to keep running. */
const panel = panelClient(config, platform);
let stopHeartbeat: (() => void) | null = null;

if (panel) {
  void panel.register().then(() => {
    stopHeartbeat = panel.startHeartbeat();
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info("shutting down", { signal });
    stopHeartbeat?.();
    wss.close();
    server.close(() => process.exit(0));
  });
}
