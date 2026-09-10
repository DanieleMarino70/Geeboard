import { PlatformError } from "@/domain/errors";
import { recordHeartbeat } from "@/lib/node-ops";
import { fail, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/nodes/heartbeat

   A node saying it is alive and what it currently looks like.
   Authenticated with the shared secret the panel presents back to it —
   two parties know it, so either direction is the same proof.

   Not user-authenticated, and deliberately cheap: this is called every
   fifteen seconds by every node in the fleet. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (typeof body?.name !== "string" || typeof body?.token !== "string") {
      throw new PlatformError("VALIDATION_FAILED", "name and token are required.");
    }

    const load = body.load as { cpuPct?: number; ramPct?: number; diskPct?: number } | undefined;

    const result = await recordHeartbeat({
      name: body.name,
      token: body.token,
      agentVersion: typeof body.agentVersion === "string" ? body.agentVersion : undefined,
      capabilities: Array.isArray(body.capabilities) ? (body.capabilities as string[]) : undefined,
      load: load
        ? {
            cpuPct: Number(load.cpuPct ?? 0),
            ramPct: Number(load.ramPct ?? 0),
            diskPct: Number(load.diskPct ?? 0),
          }
        : undefined,
      servers: typeof body.servers === "number" ? body.servers : undefined,
    });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
