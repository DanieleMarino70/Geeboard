import "server-only";
import { bytesPerSecond, rangeSpec, type MetricRange } from "@/domain/metrics/ranges";
import { db } from "./db";

/* The history of a server or a node, over a window, aggregated where the rows are.

   A chart used to load every raw sample of its window and average them in the
   page's own process: 160 ms for a week of one server on this machine, and 560 ms
   for the thirty days a chart of that size would need, against 10 and 80 ms for
   the same buckets made by the database (measured, .claude/prompts/0.7.0-parte-0-nota.md).
   So the buckets are made here, in SQL, with `date_bin`, and a window of any
   length comes back as at most 120 rows.

   An empty bucket is not a row: a server that was stopped for an hour has no
   points for it, and the chart draws a gap there and not a line across. */

export interface ServerPoint {
  /** The start of the bucket, in milliseconds since the epoch. */
  at: number;
  cpuPct: number;
  cpuPctMax: number;
  ramMb: number;
  ramMbMax: number;
  players: number;
  /** Bytes a second received and sent, averaged over the whole bucket; null where no sample had a reading to subtract. */
  rxBytesPerSecond: number | null;
  txBytesPerSecond: number | null;
  /** The world's size at the end of the bucket, in bytes, when it had been measured. */
  diskBytes: number | null;
}

export interface NodePoint {
  at: number;
  cpuPct: number;
  cpuPctMax: number;
  ramPct: number;
  ramPctMax: number;
  diskPct: number;
  pingMs: number;
}

export interface Series<P> {
  range: MetricRange;
  bucketSeconds: number;
  from: number;
  to: number;
  points: P[];
}

// An origin the buckets are aligned to, so the same moment is in the same bucket whichever window asked.
const ORIGIN = "TIMESTAMP '2020-01-01 00:00:00'";

function window(range: MetricRange) {
  const spec = rangeSpec(range);
  const to = Date.now();
  return { ...spec, to, from: to - spec.seconds * 1000 };
}

export async function serverSeries(serverId: string, range: MetricRange): Promise<Series<ServerPoint>> {
  const w = window(range);
  const rows = await db.$queryRawUnsafe<
    Array<{ b: Date; cpu: number; cpumax: number; ram: number; rammax: number; players: number; rx: number | null; tx: number | null; disk: number | null }>
  >(
    `SELECT date_bin(make_interval(secs => $3::double precision), "at", ${ORIGIN}) AS b,
            avg("cpuPct")::float8 AS cpu, max("cpuPct")::float8 AS cpumax,
            avg("ramMb")::float8 AS ram, max("ramMb")::float8 AS rammax,
            max(players)::float8 AS players,
            sum("rxBytes")::float8 AS rx, sum("txBytes")::float8 AS tx,
            max("diskBytes")::float8 AS disk
       FROM metric_samples
      WHERE "serverId" = $1 AND "at" >= $2
      GROUP BY b ORDER BY b`,
    serverId,
    new Date(w.from),
    w.bucketSeconds,
  );
  return {
    range,
    bucketSeconds: w.bucketSeconds,
    from: w.from,
    to: w.to,
    points: rows.map((r) => ({
      at: r.b.getTime(),
      cpuPct: r.cpu,
      cpuPctMax: r.cpumax,
      ramMb: r.ram,
      ramMbMax: r.rammax,
      players: r.players,
      rxBytesPerSecond: bytesPerSecond(r.rx, w.bucketSeconds),
      txBytesPerSecond: bytesPerSecond(r.tx, w.bucketSeconds),
      diskBytes: r.disk,
    })),
  };
}

export async function nodeSeries(nodeId: string, range: MetricRange): Promise<Series<NodePoint>> {
  const w = window(range);
  const rows = await db.$queryRawUnsafe<
    Array<{ b: Date; cpu: number; cpumax: number; ram: number; rammax: number; disk: number; ping: number }>
  >(
    `SELECT date_bin(make_interval(secs => $3::double precision), "at", ${ORIGIN}) AS b,
            avg("cpuPct")::float8 AS cpu, max("cpuPct")::float8 AS cpumax,
            avg("ramPct")::float8 AS ram, max("ramPct")::float8 AS rammax,
            avg("diskPct")::float8 AS disk, avg("pingMs")::float8 AS ping
       FROM node_samples
      WHERE "nodeId" = $1 AND "at" >= $2
      GROUP BY b ORDER BY b`,
    nodeId,
    new Date(w.from),
    w.bucketSeconds,
  );
  return {
    range,
    bucketSeconds: w.bucketSeconds,
    from: w.from,
    to: w.to,
    points: rows.map((r) => ({ at: r.b.getTime(), cpuPct: r.cpu, cpuPctMax: r.cpumax, ramPct: r.ram, ramPctMax: r.rammax, diskPct: r.disk, pingMs: r.ping })),
  };
}
