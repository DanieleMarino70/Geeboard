import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import process from "node:process";
import { WebSocketServer } from "ws";
import { isAuthorized } from "./auth.ts";
import { loadConfig, type Config } from "./config.ts";
import { DockerEngine } from "./docker.ts";
import {
  NotFoundError,
  PathError,
  ensureRoot,
  list as listFiles,
  makeDirectory,
  move,
  read as readFileAt,
  remove,
  rootFor,
  write as writeFileAt,
} from "./files.ts";

/* The node agent. One of these runs on every machine that hosts game
   servers; the panel is the only thing that talks to it. */

const config: Config = loadConfig();
const engine = new DockerEngine(config.managedLabel);

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

route("GET", "/version", async (_req, res) => {
  send(res, 200, { node: config.nodeName, docker: await engine.version() });
});

route("GET", "/servers", async (_req, res) => {
  send(res, 200, { servers: await engine.list() });
});

route("GET", "/servers/:id", async (_req, res, params) => {
  send(res, 200, await engine.status(params.id!));
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

route("GET", "/servers/:id/logs", async (req, res, params) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const tail = Math.min(2000, Number(url.searchParams.get("tail") ?? 200) || 200);
  send(res, 200, { lines: await engine.logs(params.id!, tail) });
});

/* ── Files ────────────────────────────────────────────────────────
   Each server owns a directory under the data root. Every path in a
   request is resolved inside it and refused if it escapes — see
   files.ts, which is where the containment lives. */

function pathParam(req: IncomingMessage): string {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams.get("path") ?? "/";
}

/** Maps a file error onto the status it deserves. */
function fileFailure(res: ServerResponse, error: unknown): boolean {
  if (error instanceof PathError) {
    send(res, 400, { error: error.message });
    return true;
  }
  if (error instanceof NotFoundError) {
    send(res, 404, { error: error.message });
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
    if (!fileFailure(res, error)) throw error;
    return;
  }

  try {
    await ensureRoot(root);
    await run(root);
  } catch (error) {
    if (!fileFailure(res, error)) throw error;
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

  if (!match) {
    send(res, 404, { error: "not found" });
    return;
  }

  if (!match.open && !isAuthorized(req, config.token)) {
    send(res, 401, { error: "unauthorized" });
    return;
  }

  const captured = match.pattern.exec(url.pathname)!;
  const params: Record<string, string> = {};
  match.keys.forEach((key, i) => {
    params[key] = decodeURIComponent(captured[i + 1] ?? "");
  });

  match.handler(req, res, params).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    // Docker's 404 for a missing container should not read as a daemon fault.
    const status = /no such container/i.test(message) ? 404 : 500;
    send(res, status, { error: message });
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
  const authorized =
    isAuthorized(req, config.token) ||
    (queryToken !== null && queryToken === config.token);

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
  console.log(
    `geeboard-daemon: ${config.nodeName} listening on ${config.host}:${config.port} ` +
      `(sampling every ${config.sampleIntervalMs}ms, label ${config.managedLabel})`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`geeboard-daemon: ${signal}, shutting down`);
    wss.close();
    server.close(() => process.exit(0));
  });
}
