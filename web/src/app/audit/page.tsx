import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Search, Shield, X } from "lucide-react";
import { serverOfEvent, type EventServer } from "@/lib/audit";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { Avatar, Card, Label } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import {
  AUDIT_PAGE_SIZE,
  TONE_MAP,
  getAuditActors,
  getAuditEvent,
  getAuditEvents,
  relativeTime,
} from "@/lib/queries";
import { AuditSearch } from "./audit-search";

export const dynamic = "force-dynamic";

/* Proportional, not fixed. The table shares its row with a 344px detail
   panel, and fixed widths that summed past the space left at an ordinary
   laptop width squeezed Action — the column that matters — to nothing,
   with its header printed over Target's. */
const COLS = "minmax(0,1.1fr) minmax(0,1.2fr) minmax(0,1fr) 84px 88px";

/* Written out in full: Tailwind extracts literal class names from the
   source, so a template-built `text-${tone}` would generate no CSS. */
const ACTION_CLASS: Record<string, string> = {
  accent: "text-accent",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-ink-3",
};

const DETAIL_CLASS: Record<string, string> = {
  accent: "text-accent bg-accent-soft",
  info: "text-info bg-info-soft",
  success: "text-success bg-success-soft",
  warning: "text-warning bg-warning-soft",
  danger: "text-danger bg-danger-soft",
  muted: "text-ink-4 bg-card-2",
};

/* A deleted server is still named, struck through: its history is the
   point of keeping the line, and which server it was is half of that. */
function ServerCell({ server }: { server: EventServer | null }) {
  if (!server) return <span className="min-w-0 truncate text-[11.5px] text-ink-4">—</span>;
  return (
    <span
      title={server.deleted ? `${server.name} — deleted` : server.name}
      className={`min-w-0 truncate text-[11.5px] text-ink-4 ${server.deleted ? "line-through" : ""}`}
    >
      {server.name}
    </span>
  );
}

function fmtValue(v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "on" : "off";
  return String(v);
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; actor?: string; days?: string; page?: string; event?: string; server?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const days = sp.days ? Number(sp.days) : undefined;

  const [{ events, total, pages }, actors] = await Promise.all([
    getAuditEvents({ q: sp.q, actor: sp.actor, days, page, server: sp.server }),
    getAuditActors(),
  ]);

  const selected = sp.event ? await getAuditEvent(sp.event) : (events[0] ?? null);

  const keep = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { q: sp.q, actor: sp.actor, days: sp.days, server: sp.server, page: sp.page, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/audit?${qs}` : "/audit";
  };

  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries({ q: sp.q, actor: sp.actor, days: sp.days, server: sp.server })) {
    if (v) exportParams.set(k, v);
  }
  const exportHref = `/api/audit/export${exportParams.size ? `?${exportParams}` : ""}`;

  const selectedServer = selected ? serverOfEvent(selected) : null;

  const changes =
    selected?.changes && typeof selected.changes === "object" && !Array.isArray(selected.changes)
      ? (selected.changes as Record<string, { from?: unknown; to?: unknown }>)
      : null;

  return (
    <AppShell crumbs={["Audit log"]} user={shellUser(user)}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Audit log</h1>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              Every privileged action, who took it and what changed. Written by the panel itself, so
              it cannot drift from what actually happened.
            </p>
          </div>
          {/* Export downloads what the filters below are showing. There
              is no webhook: nothing streams this log anywhere. */}
          <div className="flex shrink-0 gap-2 lg:ml-auto">
            <a
              href={exportHref}
              className="inline-flex items-center gap-[7px] rounded-[9px] border border-line bg-card px-4 py-[9px] text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:border-line-2 hover:text-ink"
            >
              <Download size={14} strokeWidth={1.9} />
              Export CSV
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-[10px]">
          {/* Made again when the server filter changes: a link to one
              server's events clears the search, and the box would
              otherwise go on showing what it no longer filters by. */}
          <AuditSearch key={sp.server ?? ""} defaultValue={sp.q ?? ""} />

          {/* One server's history, deleted or not — see auditWhere. */}
          {sp.server && (
            <Link
              href={keep({ server: undefined, page: undefined, event: undefined })}
              aria-label="Show every server"
              className="inline-flex items-center gap-[6px] rounded-[9px] border border-line bg-card px-3 py-[6px] text-[11.5px] text-ink-2 transition-colors duration-150 hover:border-line-2 hover:text-ink"
            >
              Server <span className="font-mono">{sp.server}</span>
              <X size={12} strokeWidth={2} className="text-ink-4" />
            </Link>
          )}

          <div className="inline-flex gap-px rounded-[9px] bg-(--border) p-px">
            <Link
              href={keep({ actor: undefined, page: undefined })}
              className={`rounded-lg px-3 py-[6px] text-[11.5px] transition-colors duration-150 ${
                !sp.actor ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              Everyone
            </Link>
            {actors.slice(0, 4).map((a) => (
              <Link
                key={a.actor}
                href={keep({ actor: a.actor, page: undefined })}
                className={`rounded-lg px-3 py-[6px] text-[11.5px] transition-colors duration-150 ${
                  sp.actor === a.actor ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {a.actor}
                <span className="ml-[6px] font-mono text-[9.5px] text-ink-4">{a.count}</span>
              </Link>
            ))}
          </div>

          <div className="inline-flex gap-px rounded-[9px] bg-(--border) p-px">
            {(
              [
                ["All time", undefined],
                ["7 days", "7"],
                ["30 days", "30"],
              ] as const
            ).map(([labelText, value]) => (
              <Link
                key={labelText}
                href={keep({ days: value, page: undefined })}
                className={`rounded-lg px-3 py-[6px] text-[11.5px] transition-colors duration-150 ${
                  (sp.days ?? undefined) === value ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {labelText}
              </Link>
            ))}
          </div>

          <span className="ml-auto font-mono text-[10.5px] text-ink-4 tnum">
            {total} event{total === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_344px]">
          <Card className="overflow-hidden">
            {events.length === 0 ? (
              <div className="px-6 py-[52px] text-center">
                <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
                  <Search size={20} strokeWidth={1.6} />
                </div>
                <div className="text-[13.5px] font-semibold">Nothing matches</div>
                <p className="mx-auto mt-2 max-w-[36ch] text-xs leading-relaxed text-ink-4">
                  No events match that filter. Widen the time range, or clear the search.
                </p>
                <Link
                  href="/audit"
                  className="mt-4 inline-block text-[12px] text-accent hover:underline"
                >
                  Clear filters
                </Link>
              </div>
            ) : (
              <>
                <div
                  className="hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid"
                  style={{ gridTemplateColumns: COLS }}
                >
                  {["Actor", "Action", "Target", "Server", "When"].map((h, i) => (
                    <Label key={h} className={i === 4 ? "text-right" : undefined}>
                      {h}
                    </Label>
                  ))}
                </div>

                {events.map((e, i) => {
                  const on = selected?.id === e.id;
                  return (
                    <Link
                      key={e.id}
                      href={keep({ event: e.id })}
                      scroll={false}
                      className={`block px-[18px] py-[13px] transition-colors duration-150 lg:py-[11px] ${
                        on ? "bg-accent-soft" : "hover:bg-card-2"
                      } ${i < events.length - 1 ? "border-b border-line" : ""}`}
                    >
                      <div
                        className="grid items-center gap-x-[14px] gap-y-1"
                        style={{ gridTemplateColumns: COLS }}
                      >
                        <div className="flex min-w-0 items-center gap-[10px]">
                          <Avatar initials={e.user?.initials ?? "SY"} size={26} rounded="8px" />
                          <span className="min-w-0 truncate text-xs">{e.actor}</span>
                        </div>
                        <span
                          className={`min-w-0 truncate font-mono text-[11.5px] ${ACTION_CLASS[TONE_MAP[e.tone]]}`}
                        >
                          {e.action}
                        </span>
                        <span className="min-w-0 truncate text-[11.5px] text-ink-3">
                          {e.target ?? "—"}
                        </span>
                        <ServerCell server={serverOfEvent(e)} />
                        <span className="text-right font-mono text-[10.5px] text-ink-4">
                          {relativeTime(e.createdAt)}
                        </span>
                      </div>
                    </Link>
                  );
                })}

                {pages > 1 && (
                  <div className="flex items-center gap-3 border-t border-line bg-bg-2 px-[18px] py-[10px]">
                    <span className="font-mono text-[10.5px] text-ink-4">
                      {(page - 1) * AUDIT_PAGE_SIZE + 1}–{Math.min(page * AUDIT_PAGE_SIZE, total)} of{" "}
                      {total}
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      {page > 1 ? (
                        <Link
                          href={keep({ page: String(page - 1), event: undefined })}
                          aria-label="Previous page"
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
                          href={keep({ page: String(page + 1), event: undefined })}
                          aria-label="Next page"
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
              </>
            )}
          </Card>

          <Card className="flex min-h-0 flex-col overflow-hidden">
            {selected ? (
              <>
                <div className="border-b border-line px-5 py-[18px]">
                  <div className="mb-3 flex items-center gap-[10px]">
                    <span
                      className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg ${DETAIL_CLASS[TONE_MAP[selected.tone]]}`}
                    >
                      <Shield size={14} strokeWidth={1.7} />
                    </span>
                    <span className="truncate font-mono text-[12.5px]">{selected.action}</span>
                  </div>
                  <div className="flex items-center gap-[10px]">
                    <Avatar initials={selected.user?.initials ?? "SY"} size={28} rounded="9px" />
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-medium">{selected.actor}</div>
                      <div className="mt-[2px] font-mono text-[10px] text-ink-4">
                        {selected.createdAt.toUTCString()}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="min-h-0 flex-1 px-5 py-4">
                  {(
                    [
                      ["Target", selected.target ?? "—"],
                      [
                        "Server",
                        selectedServer ? (
                          <>
                            {selectedServer.name}
                            {selectedServer.deleted && <span className="text-ink-4"> · deleted</span>}
                            {selectedServer.slug && sp.server !== selectedServer.slug && (
                              <div className="mt-[3px] font-sans text-[11px]">
                                <Link
                                  href={keep({ server: selectedServer.slug, q: undefined, actor: undefined, page: undefined, event: undefined })}
                                  scroll={false}
                                  className="text-accent hover:underline"
                                >
                                  Every event of this server
                                </Link>
                              </div>
                            )}
                          </>
                        ) : (
                          "—"
                        ),
                      ],
                      ["Account", selected.user?.email ?? "system"],
                      ["Event ID", selected.id],
                    ] satisfies [string, ReactNode][]
                  ).map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-[10px] border-b border-line py-2">
                      <span className="w-[74px] shrink-0 text-[11.5px] text-ink-4">{k}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{v}</span>
                    </div>
                  ))}

                  {changes && (
                    <>
                      <div className="mt-4 mb-[10px] font-mono text-[9.5px] tracking-[0.09em] text-ink-4 uppercase">
                        what changed
                      </div>
                      <div className="overflow-hidden rounded-[10px] border border-line bg-con-bg py-[10px] font-mono text-[10.5px] leading-[1.8]">
                        {Object.entries(changes).map(([field, delta]) => (
                          <div key={field}>
                            <div className="flex gap-[10px] bg-[hsl(4_78%_60%/0.08)] px-3">
                              <span className="w-2 shrink-0 text-danger">−</span>
                              <span className="text-danger">
                                {field}: {fmtValue(delta?.from)}
                              </span>
                            </div>
                            <div className="flex gap-[10px] bg-[hsl(166_68%_45%/0.08)] px-3">
                              <span className="w-2 shrink-0 text-success">+</span>
                              <span className="text-success">
                                {field}: {fmtValue(delta?.to)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {selected.server && (
                  <div className="border-t border-line bg-bg-2 px-5 py-[14px]">
                    <Link
                      href={`/servers/${selected.server.slug}`}
                      className="text-[12px] text-accent hover:underline"
                    >
                      Open {selected.server.name}
                    </Link>
                  </div>
                )}
              </>
            ) : (
              <div className="grid flex-1 place-items-center px-6 py-12 text-center">
                <p className="max-w-[30ch] text-[11.5px] leading-relaxed text-ink-4">
                  Select an event to see who took it and what it changed.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
