import { NextResponse } from "next/server";
import { streamRefusal } from "@/domain/access/streams";
import { currentSessionId, userForSession } from "@/lib/auth";
import { sameOrigin } from "@/domain/access/origin";
import { terminalInput, terminalSession } from "@/lib/terminal-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/terminal/:id/input  { seq, d }

   What was typed, numbered. The browser sends one of these at a time and
   waits for the answer; the panel takes each number once, so a request
   repeated after a network error is not typed twice. Nothing in the body
   is logged. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ accepted: false, reason: "not from the panel" }, { status: 403 });
  const sessionId = await currentSessionId();
  const user = sessionId ? await userForSession(sessionId) : null;
  if (!sessionId || !user) return NextResponse.json({ accepted: false, reason: "signed out" }, { status: 401 });
  if (streamRefusal(user, "node.terminal", null)) return NextResponse.json({ accepted: false, reason: "not permitted" }, { status: 403 });

  const { id } = await ctx.params;
  const session = terminalSession(id);
  if (!session || session.ended || session.sessionId !== sessionId) {
    return NextResponse.json({ accepted: false, reason: "that terminal session is over" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { seq?: unknown; d?: unknown };
  const result = terminalInput(session, body.seq, body.d);
  return NextResponse.json(result, { status: result.accepted || result.reason === "already typed" ? 200 : 409 });
}
