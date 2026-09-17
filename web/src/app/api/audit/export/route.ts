import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { AUDIT_EXPORT_LIMIT, getAuditExport } from "@/lib/queries";

/* The audit log as a file, with whatever filter the page was showing.

   A browser download rather than an API route: it is the Export button
   on /audit, it authenticates with the session like the page does, and
   it must not become a way for an API key to drain the log. */

export const dynamic = "force-dynamic";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // A leading =, + or - makes a spreadsheet treat a cell as a formula.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days"));
  const events = await getAuditExport({
    q: url.searchParams.get("q") ?? undefined,
    actor: url.searchParams.get("actor") ?? undefined,
    days: Number.isFinite(days) && days > 0 ? days : undefined,
  });

  const rows = [
    ["time", "actor", "account", "action", "target", "server", "tone", "changes", "event_id"],
    ...events.map((e) => [
      e.createdAt.toISOString(),
      e.actor,
      e.user?.email ?? "system",
      e.action,
      e.target ?? "",
      e.server?.name ?? "",
      e.tone.toLowerCase(),
      e.changes ?? "",
      e.id,
    ]),
  ];

  const csv = rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="geeboard-audit-${stamp}.csv"`,
      // Says when the file is short because of the cap rather than the filter.
      "x-geeboard-rows": `${events.length}/${AUDIT_EXPORT_LIMIT}`,
    },
  });
}
