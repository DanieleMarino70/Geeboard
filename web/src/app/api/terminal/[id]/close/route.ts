import { NextResponse } from "next/server";
import { streamRefusal } from "@/domain/access/streams";
import { currentSessionId, userForSession } from "@/lib/auth";
import { sameOrigin } from "@/domain/access/origin";
import { closeTerminalOp, terminalSession } from "@/lib/terminal-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/terminal/:id/close — end the session and the shell with it. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, title: "Refused", body: "Not from the panel." }, { status: 403 });
  const sessionId = await currentSessionId();
  const user = sessionId ? await userForSession(sessionId) : null;
  if (!sessionId || !user) return NextResponse.json({ ok: false, title: "Signed out", body: "Sign in again." }, { status: 401 });
  if (streamRefusal(user, "node.terminal", null)) return NextResponse.json({ ok: false, title: "Not permitted", body: "" }, { status: 403 });

  const { id } = await ctx.params;
  const session = terminalSession(id);
  if (!session || session.ended || session.sessionId !== sessionId) {
    return NextResponse.json({ ok: true, tone: "success", title: "Terminal closed", body: "That session was already over." });
  }
  return NextResponse.json(await closeTerminalOp(session));
}
