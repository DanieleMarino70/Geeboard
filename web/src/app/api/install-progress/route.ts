import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { installProgressOf } from "@/lib/create-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/install-progress?key=…

   The creation wizard's question while its create call is still running:
   which step is the install on. A route rather than a server action,
   because Next runs one client's actions one after another, and this one
   would wait behind the very call it is asking about.

   The key is one the wizard made up and sent with the create, so it says
   nothing to anybody who does not already hold it. `null` means there is
   no install under that key — not started, or over. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const key = new URL(req.url).searchParams.get("key") ?? "";
  return NextResponse.json({ progress: await installProgressOf(key) }, { headers: { "cache-control": "no-store" } });
}
