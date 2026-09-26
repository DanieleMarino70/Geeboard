import { NextResponse } from "next/server";
import { accountGate } from "@/domain/access/account";
import { getCurrentUser } from "@/lib/auth";
import { installProgressOf } from "@/lib/install-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/install-progress?key=…

   The question the creation wizard — and the update, rollback and
   rebuild buttons — ask while their call is still running: which step is
   the install on, and while downloading, how far the node has got. A
   route rather than a server action, because Next runs one client's
   actions one after another, and this one would wait behind the very
   call it is asking about.

   The key is one the wizard made up and sent with the create, so it says
   nothing to anybody who does not already hold it. `null` means there is
   no install under that key — not started, or over. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });
  // The gate every page asks; see test/account-gate.test.ts.
  if (accountGate(user)) return new NextResponse("Finish setting up your account first.", { status: 403 });

  const key = new URL(req.url).searchParams.get("key") ?? "";
  return NextResponse.json({ progress: await installProgressOf(key) }, { headers: { "cache-control": "no-store" } });
}
