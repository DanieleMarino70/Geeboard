import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PANEL_VERSION } from "@/lib/version";

/* Whether this panel is up and its database answers: what a load balancer, an uptime monitor and the container's own healthcheck ask.

   Unauthenticated on purpose and nearly empty: the release, and the last migration the database applied (which is what "the panel is on
   this release's schema" means), and nothing that says who or what is on this panel. 200 with a database that answered; 503 without. A
   query that does not come back in five seconds is a database that is not answering. */
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("no answer")), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  try {
    await within(db.$queryRaw`SELECT 1`, 5_000);
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers });
  }
  let schema: string | null = null;
  try {
    const rows = await within(
      db.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1`,
      5_000,
    );
    schema = rows[0]?.migration_name ?? null;
  } catch {
    // A database with no migrations table is one this panel did not set up; it answered, and that is what 200 says.
  }
  return NextResponse.json({ ok: true, version: PANEL_VERSION, schema }, { headers });
}
