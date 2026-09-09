import Link from "next/link";
import { Activity as ActivityIcon, ChevronLeft, ChevronRight, Shield } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Avatar, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { AUDIT_PAGE_SIZE, TONE_MAP, getAuditEvents, getServers } from "@/lib/queries";

export const dynamic = "force-dynamic";

/* Literal class strings — Tailwind cannot extract a template-built one. */
const DOT: Record<string, string> = {
  accent: "bg-accent",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-ink-4",
};

function dayLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "Today";
  if (same(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; server?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const [{ events, total, pages }, servers] = await Promise.all([
    getAuditEvents({ page }),
    getServers(),
  ]);

  const filtered = sp.server
    ? events.filter((e) => e.server?.slug === sp.server)
    : events;

  /* Group into days as they arrive — the query is already newest-first. */
  const days: Array<{ label: string; items: typeof filtered }> = [];
  for (const e of filtered) {
    const label = dayLabel(e.createdAt);
    const last = days[days.length - 1];
    if (last?.label === label) last.items.push(e);
    else days.push({ label, items: [e] });
  }

  const href = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { page: sp.page, server: sp.server, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/activity?${qs}` : "/activity";
  };

  return (
    <AppShell crumbs={["Ashfold", "Activity"]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Activity</h1>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              What has been happening across the workspace, newest first. For the administrative view
              with source addresses and change diffs, see the{" "}
              <Link href="/audit" className="text-accent hover:underline">
                audit log
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-[10px]">
          <div className="inline-flex flex-wrap gap-px rounded-[9px] bg-(--border) p-px">
            <Link
              href={href({ server: undefined, page: undefined })}
              className={`rounded-lg px-3 py-[6px] text-[11.5px] transition-colors duration-150 ${
                !sp.server ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              Everything
            </Link>
            {servers.map((s) => (
              <Link
                key={s.id}
                href={href({ server: s.slug, page: undefined })}
                className={`rounded-lg px-3 py-[6px] text-[11.5px] transition-colors duration-150 ${
                  sp.server === s.slug ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {s.name}
              </Link>
            ))}
          </div>
          <span className="ml-auto font-mono text-[10.5px] text-ink-4 tnum">
            {sp.server ? `${filtered.length} on this page` : `${total} events`}
          </span>
        </div>

        <Card className="overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-6 py-[52px] text-center">
              <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
                <ActivityIcon size={20} strokeWidth={1.6} />
              </div>
              <div className="text-[13.5px] font-semibold">Nothing here</div>
              <p className="mx-auto mt-2 max-w-[36ch] text-xs leading-relaxed text-ink-4">
                {sp.server
                  ? "No events for that server on this page. Try Everything, or an older page."
                  : "Actions taken in the panel will appear here as they happen."}
              </p>
            </div>
          ) : (
            days.map((day) => (
              <div key={day.label}>
                <div className="border-b border-line bg-bg-2 px-[18px] py-[9px] font-mono text-[9.5px] tracking-[0.09em] text-ink-4 uppercase">
                  {day.label}
                </div>
                <div className="px-[18px] py-4">
                  {day.items.map((e, i) => (
                    <div key={e.id} className="flex gap-[14px] pb-4 last:pb-0">
                      <div className="relative flex w-[9px] shrink-0 justify-center pt-[6px]">
                        <span
                          className={`z-1 h-[7px] w-[7px] shrink-0 rounded-full shadow-[0_0_0_3px_var(--card)] ${DOT[TONE_MAP[e.tone]]}`}
                        />
                        {i < day.items.length - 1 && (
                          <span className="absolute top-[13px] -bottom-4 w-px bg-(--border)" />
                        )}
                      </div>

                      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="flex items-center gap-2">
                          <Avatar initials={e.user?.initials ?? "SY"} size={18} />
                          <span className="text-[12.5px] font-medium">{e.actor}</span>
                        </span>
                        <span className="text-[12.5px] text-ink-2">{e.action}</span>
                        {e.target && (
                          <span className="font-mono text-[11.5px] text-ink-3">{e.target}</span>
                        )}
                        {e.server && (
                          <Link
                            href={`/servers/${e.server.slug}`}
                            className="rounded-[5px] bg-card-2 px-[6px] py-px font-mono text-[10px] text-ink-4 hover:text-accent"
                          >
                            {e.server.name}
                          </Link>
                        )}
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-4">
                          {e.createdAt.toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          {pages > 1 && (
            <div className="flex items-center gap-3 border-t border-line bg-bg-2 px-[18px] py-[10px]">
              <span className="font-mono text-[10.5px] text-ink-4">
                {(page - 1) * AUDIT_PAGE_SIZE + 1}–{Math.min(page * AUDIT_PAGE_SIZE, total)} of{" "}
                {total}
              </span>
              <div className="ml-auto flex items-center gap-1">
                {page > 1 ? (
                  <Link
                    href={href({ page: String(page - 1) })}
                    aria-label="Newer events"
                    className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-line text-ink-2 hover:border-line-2"
                  >
                    <ChevronLeft size={14} strokeWidth={2} />
                  </Link>
                ) : (
                  <span className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-line text-ink-4 opacity-40">
                    <ChevronLeft size={14} strokeWidth={2} />
                  </span>
                )}
                <span className="px-2 font-mono text-[11.5px] text-ink-3 tnum">
                  {page} / {pages}
                </span>
                {page < pages ? (
                  <Link
                    href={href({ page: String(page + 1) })}
                    aria-label="Older events"
                    className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-line text-ink-2 hover:border-line-2"
                  >
                    <ChevronRight size={14} strokeWidth={2} />
                  </Link>
                ) : (
                  <span className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-line text-ink-4 opacity-40">
                    <ChevronRight size={14} strokeWidth={2} />
                  </span>
                )}
              </div>
            </div>
          )}
        </Card>

        <div className="flex items-start gap-[10px] rounded-[10px] border border-line bg-card px-3 py-[11px]">
          <Shield size={14} strokeWidth={1.9} className="mt-px shrink-0 text-ink-4" />
          <span className="text-xs leading-snug text-ink-3">
            This feed and the audit log read the same events. Nothing the panel does goes unrecorded.
          </span>
        </div>
      </div>
    </AppShell>
  );
}
