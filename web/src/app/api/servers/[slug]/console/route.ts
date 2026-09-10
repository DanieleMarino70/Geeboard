import { NextResponse } from "next/server";
import WebSocket from "ws";
import { can } from "@/domain/access/permissions";
import { runtimeFor } from "@/domain/runtime/docker";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

/* Console output, proxied to the browser as Server-Sent Events.
   The browser never talks to the node agent directly: the agent may not
   be publicly reachable, and its token must never leave the server.
   Output is one-directional, so SSE fits — commands go over a normal
   server action instead. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { slug } = await ctx.params;
  const server = await db.server.findUnique({
    where: { slug },
    include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } },
  });
  if (!server) return new NextResponse("not found", { status: 404 });

  /* Watching a console and typing into one are different permissions.
     A moderator gets the first on any server and the second only on
     their own — see src/domain/access/permissions.ts. */
  if (!can(user, "server.console.read", server.ownerId)) {
    return new NextResponse("forbidden", { status: 403 });
  }

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

      upstream.on("open", () => send("open", { node: server.node.name }));

      upstream.on("message", (raw) => {
        try {
          send("line", JSON.parse(String(raw)) as unknown);
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
