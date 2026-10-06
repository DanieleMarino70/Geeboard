import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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
import { capabilities, load, resources, type PlatformReporter } from "./capabilities.ts";
import type { Config } from "./config.ts";
import { AGENT_CONTRACT } from "./contract.ts";
import { ImageMissingError, type DockerEngine } from "./docker.ts";
import { logger, requestIdOf } from "./log.ts";
import { ExchangeError, parseExchange } from "./exchange.ts";
import {
  MAX_EDIT_BYTES,
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
import { NotManagedError, SpecError, imageReference, parseCreate } from "./provision.ts";
import type { Pulls } from "./pulls.ts";
import { MAX_FRAME_BYTES, TerminalRefusal, TerminalSessions, sizeOf } from "./terminal.ts";
import { downloadArchive, uploadArchive } from "./transfer.ts";

/* The agent's listener: every route, the console and terminal streams,
   and the way it stops. Built from what it needs rather than from the
   process, so a test can run all of it in-process against a fake engine
   and a real socket. index.ts is the process: it makes the real parts,
   starts this one and owns the signals. */

/** A JSON body over the bound. Its own class so it answers 413, not 500. */
class BodyTooLargeError extends Error {}

/** A body that is not a JSON object: the caller's mistake, so it answers 400, not 500. */
class BadBodyError extends Error {}

const JSON_BODY_BYTES = 64 * 1024;
/* The editor sends a file of up to MAX_EDIT_BYTES as one JSON string, and
   JSON spells a control character in six bytes. This bounds the request,
   not the file: write() is what refuses a file that is too big. */
const EDIT_BODY_BYTES = MAX_EDIT_BYTES * 6 + 1024;
/* How long an upload may go without a byte before it is given up. The
   request as a whole is allowed to take as long as a slow line needs. */
const UPLOAD_IDLE_MS = 120_000;
/* A request that takes longer than this, whole, is cut. Raised from
   Node's five minutes, which a 200 MB upload over a 4 Mbit/s line misses. */
const REQUEST_MS = 60 * 60_000;
/* How long /health waits for the engine before saying it is not there. */
const HEALTH_MS = 5_000;

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

async function readJson(req: IncomingMessage, limit = JSON_BODY_BYTES): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new BodyTooLargeError("body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BadBodyError("the body is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadBodyError("the body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/* The request target, if it is one the router should look at: a path
   and a query, as "/servers?x=1". `new URL` throws on `//[` and on a few
   other strings anyone can send before they have authenticated, and a
   throw inside a request callback is an uncaught exception — the agent
   used to die of it. `//host/path` and absolute URLs are refused too: the
   panel never sends either, and a parser that moves the host out of what
   looks like a path is not one to route on. */
export function parseTarget(raw: string | undefined): URL | null {
  if (raw === undefined || !raw.startsWith("/") || raw.startsWith("//")) return null;
  try {
    const url = new URL(raw, "http://localhost");
    if (url.host !== "localhost") return null;
    // A stray percent sign is not a path either; decoding here is what every route's parameters would do.
    decodeURIComponent(url.pathname);
    return url;
  } catch {
    return null;
  }
}

/** `decodeURIComponent` throws on a stray percent sign; here that is a refusal, not a crash. */
function decodePart(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  url: URL,
) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  open?: boolean;
}

function pathParam(url: URL): string {
  return url.searchParams.get("path") ?? "/";
}

/** Maps a refusal onto the status it deserves. */
function refusal(res: ServerResponse, error: unknown): boolean {
  if (error instanceof PathError || error instanceof SpecError || error instanceof ExchangeError || error instanceof BadBodyError) {
    send(res, 400, { error: error.message });
    return true;
  }
  if (error instanceof RotationError || error instanceof ImageMissingError) {
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
  if (error instanceof BodyTooLargeError) {
    send(res, 413, { error: error.message });
    return true;
  }
  if (error instanceof TerminalRefusal) {
    const status = { "terminal-off": 403, "terminal-unavailable": 503, "terminal-busy": 429, "terminal-attached": 409 }[error.code];
    send(res, status, { error: error.message, code: error.code });
    return true;
  }
  return false;
}


/** What the listener is made of. index.ts builds the real ones; a test builds fakes. */
export interface AgentDeps {
  config: Config;
  engine: DockerEngine;
  pulls: Pulls;
  platform: PlatformReporter;
  terminal: TerminalSessions;
}

export interface AgentServer {
  server: Server;
  /** Stop answering and let go of every open stream, waiting at most `graceMs` for work in flight. */
  shutdown(graceMs?: number): Promise<void>;
}

export function buildServer(deps: AgentDeps): AgentServer {
  const { config, engine, pulls, platform, terminal } = deps;

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
        // A hung engine is "unreachable", not a request that waits for the panel to give up.
        await Promise.race([
          engine.ping(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no answer")), HEALTH_MS).unref()),
        ]);
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
      contract: AGENT_CONTRACT,
      docker: await engine.version(),
      ...(await platform()),
      capabilities: await capabilities(config.capabilities, config.dataRoot, platform.engineMemory()),
      resources: await resources(config.dataRoot, platform.engineMemory()),
      load: await load(config.dataRoot),
      terminal: terminal.describe(),
    });
  });

  /* ── The node terminal ────────────────────────────────────────────
     A shell of this machine, for the panel to hand to a browser — see
     terminal.ts. Two steps: POST reserves a session and answers with its
     id, then the panel attaches a WebSocket to /terminal/:id/stream, which
     is when the shell starts. Refusals carry a code the panel turns into
     a sentence: terminal-off, terminal-unavailable, terminal-busy. */
  route("GET", "/terminal", async (_req, res) => {
    send(res, 200, { terminal: terminal.describe(), sessions: terminal.list() });
  });

  route("POST", "/terminal", async (req, res) => {
    const body = await readJson(req);
    send(res, 201, { ...terminal.open(sizeOf(body), requestIdOf(req.headers)), terminal: terminal.describe() });
  });

  route("DELETE", "/terminal/:id", async (_req, res, params) => {
    if (!terminal.close(params.id!, "closed by the panel")) {
      send(res, 404, { error: "no such terminal session" });
      return;
    }
    send(res, 200, { closed: true });
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

  /* An image, pulled as a job of its own before anything is created from
     it. POST starts the pull — or joins the one already running for that
     image, or answers at once that the node has it — and GET says how far
     it has got, in the bytes and layers Docker reports. A GET for a pull
     this agent does not know is a 404: an agent that restarted mid-pull
     forgot it, and the panel asks again, which resumes it. */
  route("POST", "/images/pull", async (req, res) => {
    const image = imageReference((await readJson(req)).image);
    const pull = await pulls.start(image);
    send(res, pull.state === "pulling" ? 202 : 200, pull);
  });

  route("GET", "/images/pull", async (_req, res, _params, url) => {
    const image = imageReference(url.searchParams.get("image") ?? "");
    const pull = pulls.get(image);
    if (!pull) {
      send(res, 404, { error: `no pull of ${image} on this node` });
      return;
    }
    send(res, 200, pull);
  });

  route("POST", "/servers", async (req, res) => {
    const spec = parseCreate(await readJson(req));
    send(res, 201, await engine.create(spec));
  });

  route("DELETE", "/servers/:id", async (_req, res, params, url) => {
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
  route("GET", "/servers/:id/probe", async (_req, res, params, url) => {
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

  route("GET", "/servers/:id/logs", async (_req, res, params, url) => {
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
  route("GET", "/servers/:id/mods", async (_req, res, params, url) => {
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

  route("GET", "/servers/:id/files", async (_req, res, params, url) => {
    await withRoot(res, params.id!, async (root) => {
      send(res, 200, { path: pathParam(url), entries: await listFiles(root, pathParam(url)) });
    });
  });

  route("GET", "/servers/:id/files/content", async (_req, res, params, url) => {
    await withRoot(res, params.id!, async (root) => {
      send(res, 200, await readFileAt(root, pathParam(url)));
    });
  });

  /* The same two, for bytes: streamed, so a plugin jar is never held in
     memory here, and capped — see files.ts. The body of the PUT is the
     file itself, not JSON. */
  route("GET", "/servers/:id/files/raw", async (_req, res, params, url) => {
    await withRoot(res, params.id!, async (root) => {
      const file = await openForRead(root, pathParam(url));
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(file.sizeBytes) });
      await pipeline(file.stream, res);
    });
  });

  route("PUT", "/servers/:id/files/raw", async (req, res, params, url) => {
    await withRoot(res, params.id!, async (root) => {
      /* The size the browser sent, which the panel passes on: its own
         request to here is streamed and has no length of its own. Absent
         from a panel before 0.3.1, and then not checked. */
      const header = req.headers["x-geeboard-length"];
      const expected = typeof header === "string" && /^\d{1,12}$/.test(header) ? Number(header) : undefined;
      /* The request as a whole may take as long as a slow line needs, but a
         connection that stops sending is not a slow one. */
      req.socket.setTimeout(UPLOAD_IDLE_MS, () => req.destroy(new Error("the upload stopped arriving")));
      try {
        send(res, 200, await writeFromStream(root, pathParam(url), req, expected));
      } finally {
        req.socket.setTimeout(0);
      }
    });
  });

  route("PUT", "/servers/:id/files/content", async (req, res, params, url) => {
    const body = await readJson(req, EDIT_BODY_BYTES);
    if (typeof body.content !== "string") {
      send(res, 400, { error: "content must be a string" });
      return;
    }
    await withRoot(res, params.id!, async (root) => {
      send(res, 200, await writeFileAt(root, pathParam(url), body.content as string));
    });
  });

  route("POST", "/servers/:id/files/directory", async (_req, res, params, url) => {
    await withRoot(res, params.id!, async (root) => {
      await makeDirectory(root, pathParam(url));
      send(res, 201, { created: pathParam(url) });
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

  route("DELETE", "/servers/:id/files", async (_req, res, params, url) => {
    await withRoot(res, params.id!, async (root) => {
      await remove(root, pathParam(url));
      send(res, 200, { deleted: pathParam(url) });
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

  /* Set when the agent has been asked to stop: what is running is let finish,
     and nothing that would change the machine is started. */
  let stopping = false;

  /** A target nothing here can route. The connection is closed: whoever sent it is not speaking to us. */
  function refuseTarget(res: ServerResponse): void {
    res.setHeader("connection", "close");
    send(res, 400, { error: "bad request target" });
  }

  const server = createServer((req, res) => {
    const url = parseTarget(req.url);
    if (!url) {
      // Nothing below has run, so this is the one refusal that is not logged by the finish handler.
      logger.warn("request refused", { method: req.method, path: "(not a path)", target: (req.url ?? "").slice(0, 80), status: 400 });
      refuseTarget(res);
      return;
    }
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

    if (stopping && req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("retry-after", "5");
      send(res, 503, { error: "the agent is stopping; try again in a few seconds" });
      return;
    }

    const captured = match.pattern.exec(url.pathname)!;
    const params: Record<string, string> = {};
    for (const [i, key] of match.keys.entries()) {
      const value = decodePart(captured[i + 1] ?? "");
      if (value === null) {
        refuseTarget(res);
        return;
      }
      params[key] = value;
    }

    match.handler(req, res, params, url).catch((error: unknown) => {
      /* The answer has already begun — a download whose client went away.
         There is no status left to send, and trying to send one throws from
         inside this catch. The connection is all that is left to end. */
      if (res.headersSent) {
        const detail = error instanceof Error ? error.message : "unknown error";
        const gone = (error as NodeJS.ErrnoException | undefined)?.code === "ERR_STREAM_PREMATURE_CLOSE";
        (gone ? logger.debug : logger.warn)("response abandoned", { requestId, method: req.method, path: url.pathname, detail });
        res.destroy();
        return;
      }

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

  server.requestTimeout = REQUEST_MS;

  /* A request Node could not parse. It answers 400 itself when nothing is
     listening for this, but only if the socket can still be written to; the
     handler is here so that a peer that vanished mid-request is a closed
     socket and not an error event that nobody handles. */
  server.on("clientError", (error: NodeJS.ErrnoException, socket) => {
    if (error.code === "ECONNRESET" || !socket.writable) {
      socket.destroy();
      return;
    }
    logger.debug("request refused", { status: 400, detail: error.code ?? error.message });
    socket.end("HTTP/1.1 400 Bad Request\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
  });

  /* Console streaming. The panel opens ws://node/servers/<id>/console and
     receives one JSON message per output line. */
  const wss = new WebSocketServer({ noServer: true });
  /* Terminal streams get a server of their own for one reason: a bound on
     a frame. A console frame is a log line; a terminal frame is typed by a
     person or pasted, and a paste has to end somewhere. */
  const terminalWss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  server.on("upgrade", (req, socket, head) => {
    /* Once a socket is handed over, nothing listens for its errors: a peer
       that resets while a refusal is being written would be an uncaught one. */
    socket.on("error", () => socket.destroy());
    const url = parseTarget(req.url);
    if (!url) {
      logger.warn("request refused", { method: req.method, path: "(not a path)", target: (req.url ?? "").slice(0, 80), status: 400 });
      socket.write("HTTP/1.1 400 \r\n\r\n");
      socket.destroy();
      return;
    }
    if (stopping) {
      socket.write("HTTP/1.1 503 \r\nretry-after: 5\r\n\r\n");
      socket.destroy();
      return;
    }
    const match = /^\/servers\/([^/]+)\/console$/.exec(url.pathname);
    const terminalMatch = /^\/terminal\/([^/]+)\/stream$/.exec(url.pathname);

    /* A terminal stream takes the token in the header and nowhere else.
       The panel is a Node client and can send one; a token in a query
       string is a token in access logs, and a shell is not a log line. */
    if (terminalMatch) {
      if (!isAuthorized(req, acceptedTokens(config))) {
        socket.write("HTTP/1.1 401 \r\n\r\n");
        socket.destroy();
        return;
      }
      const id = decodePart(terminalMatch[1]!);
      if (id === null) {
        socket.write("HTTP/1.1 400 \r\n\r\n");
        socket.destroy();
        return;
      }
      if (!terminal.has(id)) {
        socket.write("HTTP/1.1 404 \r\n\r\n");
        socket.destroy();
        return;
      }
      terminalWss.handleUpgrade(req, socket, head, (ws) => {
        const sink = {
          send: (frame: unknown) => {
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
          },
          close: () => ws.close(1000),
        };
        try {
          terminal.attach(
            id,
            sink,
            { cols: Number(url.searchParams.get("cols")), rows: Number(url.searchParams.get("rows")) },
          );
        } catch (error) {
          sink.send({ t: "ended", reason: error instanceof Error ? error.message : "the shell could not be started" });
          ws.close(1011);
          return;
        }
        ws.on("message", (raw, isBinary) => {
          if (isBinary) return;
          let frame: { t?: unknown; d?: unknown; cols?: unknown; rows?: unknown };
          try {
            frame = JSON.parse(String(raw)) as typeof frame;
          } catch {
            return;
          }
          try {
            if (frame.t === "in" && typeof frame.d === "string") terminal.input(id, frame.d);
            else if (frame.t === "resize") terminal.resize(id, frame);
            else if (frame.t === "close") terminal.close(id, "closed by the panel");
          } catch {
            /* the session ended under this frame; the close that follows says so */
          }
        });
        // The stream is the session: when the panel lets go, the shell goes with it.
        const gone = () => terminal.close(id, "the panel disconnected");
        ws.on("close", gone);
        ws.on("error", gone);
      });
      return;
    }

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

    const id = decodePart(match[1]!);
    if (id === null) {
      socket.write("HTTP/1.1 400 \r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      engine
        .follow(
          id,
          (line, stderr, at) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ at: at ?? new Date().toISOString(), line, stderr }));
            }
          },
          100,
          // The container is gone: the panel reopens the console on whatever replaced it.
          () => ws.close(),
        )
        .then((stop) => {
          // The panel may have gone, or the agent started stopping, while the engine was answering.
          if (ws.readyState === ws.CLOSING || ws.readyState === ws.CLOSED) {
            stop();
            return;
          }
          ws.on("close", stop);
          ws.on("error", stop);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "unknown error";
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ error: message }));
          ws.close();
        });
    });
  });

  /* What a restart asks of the agent. Streams are ended at once — the panel
     reopens a console on its own, and a terminal's shell does not outlive
     this process anyway — because they are what kept `server.close()` waiting
     for the panel to let go. Work in flight (a backup, an upload) is given
     `graceMs` to finish; after that its connection is cut. */
  async function shutdown(graceMs = 20_000): Promise<void> {
    stopping = true;
    const streams = [...wss.clients, ...terminalWss.clients];
    for (const ws of streams) {
      ws.close(1001, "the agent is stopping");
      // A peer that does not answer the close frame is not waited for.
      setTimeout(() => ws.terminate(), 2_000).unref();
    }
    const sweep = setInterval(() => server.closeIdleConnections(), 250);
    const deadline = setTimeout(() => {
      logger.warn("shutdown grace ended with requests still running", { graceMs });
      server.closeAllConnections();
    }, graceMs);
    try {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
    } finally {
      clearInterval(sweep);
      clearTimeout(deadline);
    }
  }

  return { server, shutdown };
}
