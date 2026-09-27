import { NextResponse } from "next/server";
import { streamRefusal } from "@/domain/access/streams";
import { currentSessionId, userForSession } from "@/lib/auth";
import { sameOrigin } from "@/domain/access/origin";
import { terminalResize, terminalSession } from "@/lib/terminal-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/terminal/:id/resize  { cols, rows } — the browser's terminal changed size. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false }, { status: 403 });
  const sessionId = await currentSessionId();
  const user = sessionId ? await userForSession(sessionId) : null;
  if (!sessionId || !user) return NextResponse.json({ ok: false }, { status: 401 });
  if (streamRefusal(user, "node.terminal", null)) return NextResponse.json({ ok: false }, { status: 403 });

  const { id } = await ctx.params;
  const session = terminalSession(id);
  if (!session || session.ended || session.sessionId !== sessionId) return NextResponse.json({ ok: false }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { cols?: unknown; rows?: unknown };
  return NextResponse.json({ ok: terminalResize(session, body.cols, body.rows) });
}
