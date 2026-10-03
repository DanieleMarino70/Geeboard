/* The windows a metrics chart or the API can ask for, and how wide a bucket of each is.

   Samples are kept for thirty days at about fifteen seconds. A window is
   drawn as at most POINTS buckets, each the average of the samples that fall in
   it (and the peak, so a spike is not averaged away); a wider window is wider
   buckets, not more of them. */

export const RANGE_SECONDS = {
  "1h": 3600,
  "6h": 6 * 3600,
  "24h": 24 * 3600,
  "7d": 7 * 24 * 3600,
  "30d": 30 * 24 * 3600,
} as const;

export type MetricRange = keyof typeof RANGE_SECONDS;

export const METRIC_RANGES = Object.keys(RANGE_SECONDS) as MetricRange[];

export const POINTS = 120;

export function isMetricRange(value: unknown): value is MetricRange {
  return typeof value === "string" && value in RANGE_SECONDS;
}

/** How far back a window reaches and how wide each of its buckets is, in seconds. */
export function rangeSpec(range: MetricRange): { seconds: number; bucketSeconds: number } {
  const seconds = RANGE_SECONDS[range];
  return { seconds, bucketSeconds: Math.max(15, Math.ceil(seconds / POINTS)) };
}

/** The average rate of a count of bytes over a bucket: what it carried, spread across its whole width. */
export function bytesPerSecond(bytes: number | null, bucketSeconds: number): number | null {
  return bytes === null ? null : bytes / bucketSeconds;
}

/** A round number at or above `value`: 1, 2 or 5 times a power of ten. For the top of an axis. */
export function niceCeil(value: number): number {
  if (!(value > 0)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  for (const step of [1, 2, 5, 10]) if (step * base >= value) return step * base;
  return 10 * base;
}
