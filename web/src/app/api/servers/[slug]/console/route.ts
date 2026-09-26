import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import WebSocket from "ws";
import { STREAM_RECHECK_MS, streamRefusal, type StreamRefusal } from "@/domain/access/streams";
import { findGame } from "@/domain/games/registry";
import { redactSecrets } from "@/domain/games/types";
import { runtimeFor } from "@/domain/runtime/docker";
import { currentSessionId, userForSession } from "@/lib/auth";
import { db } from "@/lib/db";

/* Console output, proxied to the browser as Server-Sent Events.
   The browser never talks to the node agent directly: the agent may not
   be publicly reachable, and its token must never leave the server.
   Output is one-directional, so SSE fits — commands go over a normal
   server action instead. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* What the reader is told when the stream is refused or closed under them. */
const ENDED: Record<StreamRefusal, string> = {
  "signed-out": "You were signed out, so the console was closed.",
  password: "Your account has to choose its own password before it can watch a console.",
  "two-factor": "Your account has to set up two-factor before it can watch a console.",
  forbidden: "Your role does not let you watch this server's console.",
};

/* A refusal in the middle says what changed since the stream opened,
   when it is one of the two things the panel can see changing. */
function endedBecause(
  refusal: StreamRefusal,
  was: { role: Role; ownerId: string },
  now: { role: Role | null; ownerId: string },
): string {
  if (refusal !== "forbidden") return ENDED[refusal];
  if (now.role && now.role !== was.role) {
    return `Your role is now ${now.role.toLowerCase()}, which does not watch this server's console.`;
  }
  if (now.ownerId !== was.ownerId) return "This server was given to somebody else, so its console is no longer yours to watch.";
  return ENDED.forbidden;
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  /* The session id, not only its account: the stream asks about the same
     session again while it runs, from a timer, where the cookie jar of
     this request is not something to read. */
  const sessionId = await currentSessionId();
  const user = sessionId ? await userForSession(sessionId) : null;
  if (!sessionId || !user) return new NextResponse("unauthorized", { status: 401 });

  const { slug } = await ctx.params;
  const server = await db.server.findUnique({
    where: { slug },
    include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } },
  });
  if (!server) return new NextResponse("not found", { status: 404 });

  /* Watching a console and typing into one are different permissions.
     A moderator gets the first on any server and the second only on
     their own — see src/domain/access/permissions.ts. The account gate
     comes first, as on every page: this route used to skip it, so an
     owner who had not enrolled two-factor could open a stream that every
     page would have sent to the account page. */
  const refusal = streamRefusal(user, "server.console.read", server.ownerId);
  if (refusal) return new NextResponse(ENDED[refusal], { status: 403 });

  const runtime = runtimeFor(server.node);
  if (!runtime || !server.runtimeId) {
    return NextResponse.json(
      {
        code: "RUNTIME_NOT_ATTACHED",
        message: `${server.node.name} has no agent attached.`,
      },
      { status: 503 },
    );
  }

  const upstream = new WebSocket(
    runtime.consoleUrl({ serverId: server.id, runtimeId: server.runtimeId }),
  );
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const shutdown = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(recheck);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        if (upstream.readyState === WebSocket.OPEN) upstream.close();
      };

      /* Proxies and load balancers drop an idle connection; a comment
         line every 20s keeps it open without polluting the log. */
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          shutdown();
        }
      }, 20_000);

      /* Authorised again while it runs, not only when it opened: a role
         taken away or a session ended from the account page closes it
         within STREAM_RECHECK_MS, and the reader is told which. The owner
         is read again too — nothing in the panel hands a server over
         today, but a stream should not be the one place that assumes so.
         `ended` rather than `fault`, because the
         browser must not reconnect on its own — it would be refused, and
         say only that it was disconnected. */
      const end = (reason: string) => {
        send("ended", { reason });
        shutdown();
      };
      const recheck = setInterval(() => {
        void Promise.all([
          userForSession(sessionId),
          db.server.findUnique({ where: { id: server.id }, select: { ownerId: true } }),
        ])
          .then(([reader, current]) => {
            if (!current) return end("This server was deleted.");
            const now = streamRefusal(reader, "server.console.read", current.ownerId);
            if (now) {
              end(
                endedBecause(
                  now,
                  { role: user.role, ownerId: server.ownerId },
                  { role: reader?.role ?? null, ownerId: current.ownerId },
                ),
              );
            }
          })
          /* A database that does not answer keeps the stream as it was.
             Everything that takes the right away is a write to that same
             database, so while it cannot be read nothing can have been
             taken away through the panel — and a hiccup should not close
             every console on the page. */
          .catch(() => {});
      }, STREAM_RECHECK_MS);

      upstream.on("open", () => send("open", { node: server.node.name }));

      const definition = server.gameId ? findGame(server.gameId) : undefined;
      upstream.on("message", (raw) => {
        try {
          const frame = JSON.parse(String(raw)) as { line?: unknown };
          // Generated secrets the image prints are blanked before a browser sees them.
          if (typeof frame.line === "string") frame.line = redactSecrets(definition, frame.line);
          send("line", frame);
        } catch {
          /* a frame we cannot parse is not worth tearing the stream down for */
        }
      });

      upstream.on("error", () => {
        send("fault", { error: `lost the console on ${server.node.name}` });
        shutdown();
      });

      upstream.on("close", () => {
        send("fault", { error: "the console stream ended" });
        shutdown();
      });

      // The browser going away is the usual way this ends.
      _req.signal?.addEventListener("abort", shutdown);
    },

    cancel() {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx buffers SSE into uselessness without this.
      "x-accel-buffering": "no",
    },
  });
}
