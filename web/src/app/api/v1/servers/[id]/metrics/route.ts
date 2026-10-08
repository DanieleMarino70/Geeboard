import { PlatformError } from "@/domain/errors";
import { RANGE_SECONDS, isMetricRange } from "@/domain/metrics/ranges";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { serverSeries } from "@/lib/metrics";
import { resolveServer } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/servers/:id/metrics?range=1h|6h|24h|7d|30d

   The history the server's page draws, as numbers: a window of at most 120
   buckets, each the average of the samples in it, with the highest value
   beside the average of CPU and memory so a spike is not lost. Needs
   `server.read`, which the `metrics:read` scope carries.

   Units are in the names. Network is bytes a second, averaged over the whole
   bucket — a bucket in which the server was stopped for half of it says half
   of what it carried while running. `null` is "not measured": the first
   sample of a run has nothing to subtract a reading from, a world's size is
   measured every five minutes, and nothing before 0.7.0 has network or disk.
   A bucket with no samples is not in the list, so a gap in `points` is a gap
   in time. Default window: 24h. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    const { id } = await ctx.params;
    const server = await resolveServer(id, principal);
    mustAllow(principal, "server.read", server.ownerId);

    const asked = new URL(req.url).searchParams.get("range") ?? "24h";
    if (!isMetricRange(asked)) {
      throw new PlatformError("VALIDATION_FAILED", `range has to be one of ${Object.keys(RANGE_SECONDS).join(", ")}.`, { details: { field: "range" } });
    }
    const series = await serverSeries(server.id, asked);
    return ok({
      server: server.slug,
      range: series.range,
      bucketSeconds: series.bucketSeconds,
      from: new Date(series.from).toISOString(),
      to: new Date(series.to).toISOString(),
      points: series.points.map((p) => ({
        at: new Date(p.at).toISOString(),
        cpuPct: Math.round(p.cpuPct * 10) / 10,
        cpuPctMax: p.cpuPctMax,
        ramMb: Math.round(p.ramMb),
        ramMbMax: p.ramMbMax,
        players: p.players,
        rxBytesPerSecond: p.rxBytesPerSecond === null ? null : Math.round(p.rxBytesPerSecond),
        txBytesPerSecond: p.txBytesPerSecond === null ? null : Math.round(p.txBytesPerSecond),
        diskBytes: p.diskBytes,
      })),
    });
  } catch (error) {
    return fail(error);
  }
}
