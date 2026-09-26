import { commandReader } from "@/domain/access/commands";
import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { AUDIT_PAGE_SIZE, getAuditEvents } from "@/lib/queries";
import { eventShape } from "../_shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/audit?q=&actor=&days=&server=&page=

   The audit log, as the Audit page reads it: the same filters, the
   same page size, newest first. `server` is a slug; `days` a window
   back from now. */
export async function GET(req: Request) {
  try {
    const principal = await begin(req);
    mustAllow(principal, "audit.read");

    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const days = url.searchParams.get("days");
    if (!Number.isInteger(page) || page < 1) throw new PlatformError("VALIDATION_FAILED", "page has to be a whole number from 1.");
    if (days !== null && !(Number.isInteger(Number(days)) && Number(days) > 0)) {
      throw new PlatformError("VALIDATION_FAILED", "days has to be a whole number of days.");
    }

    /* A command's text only where the caller could watch that console:
       the role, and the key's scopes, as everywhere else. */
    const result = await getAuditEvents(
      {
        q: url.searchParams.get("q") ?? undefined,
        actor: url.searchParams.get("actor") ?? undefined,
        server: url.searchParams.get("server") ?? undefined,
        days: days === null ? undefined : Number(days),
        page,
      },
      commandReader(principal, principal.scopes),
    );
    return ok({
      events: result.events.map(eventShape),
      page: result.page,
      pages: result.pages,
      total: result.total,
      pageSize: AUDIT_PAGE_SIZE,
    });
  } catch (error) {
    return fail(error);
  }
}
