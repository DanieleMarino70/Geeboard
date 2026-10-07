import { peerOf } from "@/domain/dns/rules";
import { PlatformError } from "@/domain/errors";
import { recordHeartbeat } from "@/lib/node-ops";
import { fail, ok } from "@/lib/api-response";
import { attempt, exhausted } from "@/lib/attempts";
import { requestSource } from "@/lib/request-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/nodes/heartbeat

   A node saying it is alive and what it currently looks like.
   Authenticated with the shared secret the panel presents back to it —
   two parties know it, so either direction is the same proof.

   Not user-authenticated, and deliberately cheap: this is called every
   fifteen seconds by every node in the fleet. Which is also why it is limited before it does anything:
   anybody who knows a node's name (it is in the install command) can send it, and it used to cost 30 ms of
   blocked event loop a request to say no. A source that has been refused thirty times in a minute is refused
   without being read, and one that sends more in a minute than a fleet of hundreds would is too. */
const FAILED_PER_MINUTE = 30;
const ANY_PER_MINUTE = 1200;

export async function POST(req: Request) {
  try {
    const source = requestSource(req.headers);
    if (exhausted(`heartbeat-fail:${source}`, FAILED_PER_MINUTE) || !attempt(`heartbeat:${source}`, ANY_PER_MINUTE, 60_000)) {
      throw new PlatformError("RATE_LIMITED", "Too many requests from this address. Wait a minute.");
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (typeof body?.name !== "string" || typeof body?.token !== "string" || body.name.length > 128 || body.token.length > 512) {
      throw new PlatformError("VALIDATION_FAILED", "name and token are required.");
    }

    const load = body.load as { cpuPct?: number; ramPct?: number; diskPct?: number } | undefined;
    const resources = body.resources as
      | { cpuCores?: number; ramTotalGb?: number; diskTotalGb?: number }
      | undefined;

    const result = await recordHeartbeat({
      name: body.name,
      token: body.token,
      agentVersion: typeof body.agentVersion === "string" ? body.agentVersion : undefined,
      agentContract: body.agentContract,
      os: typeof body.os === "string" ? body.os : undefined,
      arch: typeof body.arch === "string" ? body.arch : undefined,
      capabilities: Array.isArray(body.capabilities) ? (body.capabilities as string[]) : undefined,
      resources: resources
        ? {
            cpuCores: Number(resources.cpuCores),
            ramTotalGb: Number(resources.ramTotalGb),
            diskTotalGb: Number(resources.diskTotalGb),
          }
        : undefined,
      load: load
        ? {
            cpuPct: Number(load.cpuPct ?? 0),
            ramPct: Number(load.ramPct ?? 0),
            diskPct: Number(load.diskPct ?? 0),
          }
        : undefined,
      servers: typeof body.servers === "number" ? body.servers : undefined,
      terminal: body.terminal,
      observedFrom: peerOf(req.headers.get("x-forwarded-for")),
    });

    return ok(result);
  } catch (error) {
    // What was refused as not-a-node counts against where it came from; a node that beats correctly never does.
    if (error instanceof PlatformError && error.code === "UNAUTHENTICATED") attempt(`heartbeat-fail:${requestSource(req.headers)}`, FAILED_PER_MINUTE, 60_000);
    return fail(error);
  }
}
