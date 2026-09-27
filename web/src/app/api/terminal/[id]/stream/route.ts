import { NextResponse } from "next/server";
import { STREAM_RECHECK_MS, streamRefusal } from "@/domain/access/streams";
import { currentSessionId, userForSession } from "@/lib/auth";
import { attachTerminal, detachTerminal, endTerminal, terminalAccess, terminalSession } from "@/lib/terminal-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/terminal/:id/stream

   A terminal session's output, as Server-Sent Events, the way the
   console's is: the browser never talks to a node, and no node token
   leaves the panel. Events: `open` (node, shell, size), `out` ({ d }),
   `exit` ({ code }), `ended` ({ reason }) — after which the browser must
   not reconnect, as there is nothing to reconnect to. A stream that
   drops for another reason may come back within a short window and
   finds what it missed.

   Authorised when it opens and again every STREAM_RECHECK_MS, against
   the database: the sign-in that opened it, the account gate, the
   owner's role, the node's approval and its agent token. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sessionId = await currentSessionId();
  const user = sessionId ? await userForSession(sessionId) : null;
  if (!sessionId || !user) return new NextResponse("unauthorized", { status: 401 });
  const refusal = streamRefusal(user, "node.terminal", null);
  if (refusal) return new NextResponse("Only an owner with two-factor may open a terminal.", { status: 403 });

  const { id } = await ctx.params;
  const session = terminalSession(id);
  if (!session || session.ended) return new NextResponse("That terminal session is over.", { status: 404 });
  const access = await terminalAccess(session, sessionId);
  if (!access.ok) return new NextResponse(access.reason, { status: 403 });
  if (session.sink) return new NextResponse("This terminal is open in another tab.", { status: 409 });

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
      };

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          shutdown();
        }
      }, 20_000);

      const recheck = setInterval(() => {
        void terminalAccess(session, sessionId)
          .then((now) => {
            if (!now.ok) void endTerminal(session, now.reason);
          })
          /* A database that does not answer keeps the stream, as the console's does. */
          .catch(() => {});
      }, STREAM_RECHECK_MS);

      attachTerminal(session, (event, data) => {
        send(event, data);
        if (event === "ended") shutdown();
      });

      // The browser going away: the shell waits a moment for it to come back.
      req.signal?.addEventListener("abort", () => {
        if (session.sink && !closed) detachTerminal(session);
        shutdown();
      });
    },
    cancel() {
      if (!session.ended) detachTerminal(session);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
