import { PlatformError } from "@/domain/errors";
import { RANGE_SECONDS, isMetricRange } from "@/domain/metrics/ranges";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { nodeSeries } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/nodes/:name/metrics?range=1h|6h|24h|7d|30d

   What the node reported about itself, as the poller recorded it each time it
   reached the node: CPU, memory and storage in percent, and the round trip from
   the panel to the agent in milliseconds, averaged over at most 120 buckets
   with the highest CPU and memory beside the averages. Needs `node.read`. A
   node the panel could not reach has no points for the time it was silent.
   Default window: 24h. */
export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  try {
    const principal = await begin(req);
    mustAllow(principal, "node.read");

    const { name } = await ctx.params;
    const node = await db.node.findUnique({ where: { name }, select: { id: true, name: true } });
    if (!node) throw new PlatformError("NODE_NOT_FOUND", "No node by that name.", { details: { name } });

    const asked = new URL(req.url).searchParams.get("range") ?? "24h";
    if (!isMetricRange(asked)) {
      throw new PlatformError("VALIDATION_FAILED", `range has to be one of ${Object.keys(RANGE_SECONDS).join(", ")}.`, { details: { field: "range" } });
    }
    const series = await nodeSeries(node.id, asked);
    return ok({
      node: node.name,
      range: series.range,
      bucketSeconds: series.bucketSeconds,
      from: new Date(series.from).toISOString(),
      to: new Date(series.to).toISOString(),
      points: series.points.map((p) => ({
        at: new Date(p.at).toISOString(),
        cpuPct: Math.round(p.cpuPct * 10) / 10,
        cpuPctMax: p.cpuPctMax,
        ramPct: Math.round(p.ramPct * 10) / 10,
        ramPctMax: p.ramPctMax,
        diskPct: Math.round(p.diskPct * 10) / 10,
        pingMs: Math.round(p.pingMs),
      })),
    });
  } catch (error) {
    return fail(error);
  }
}
