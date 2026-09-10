import { lifecycle } from "../_lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/servers/:id/start */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return lifecycle(req, ctx, "start");
}
