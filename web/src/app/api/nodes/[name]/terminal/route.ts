import { NextResponse } from "next/server";
import { streamRefusal } from "@/domain/access/streams";
import { currentSessionId, userForSession } from "@/lib/auth";
import { sameOrigin } from "@/domain/access/origin";
import { openTerminalOp } from "@/lib/terminal-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/nodes/:name/terminal  { code, cols, rows }

   Opens a terminal session on a node. A route with a cookie rather than a
   server action, like the console stream beside it: the browser then
   types into the session through routes of its own, and Next runs one
   client's server actions one after another, which a terminal cannot
   wait behind. Outside /api/v1 on purpose — no API key opens a shell.

   The body carries a fresh code from the authenticator; see
   terminal-ops.ts for what is asked and why. */
export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ title: "Refused", body: "This request did not come from the panel." }, { status: 403 });
  const sessionId = await currentSessionId();
  const user = sessionId ? await userForSession(sessionId) : null;
  if (!sessionId || !user) return NextResponse.json({ title: "Signed out", body: "Sign in again." }, { status: 401 });
  // The gate every page asks, and the owner's permission; see test/account-gate.test.ts.
  const refusal = streamRefusal(user, "node.terminal", null);
  if (refusal) return NextResponse.json({ title: "Not permitted", body: "Only an owner with two-factor may open a terminal." }, { status: 403 });

  const { name } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; cols?: unknown; rows?: unknown };
  const size = (v: unknown, max: number, or: number) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : or);
  const result = await openTerminalOp(user, sessionId, decodeURIComponent(name), {
    code: typeof body.code === "string" ? body.code : "",
    cols: size(body.cols, 1000, 80),
    rows: size(body.rows, 500, 24),
  });
  if (!result.ok) return NextResponse.json(result, { status: result.code === "code" ? 401 : 409 });
  return NextResponse.json(result, { status: 201, headers: { "cache-control": "no-store" } });
}
