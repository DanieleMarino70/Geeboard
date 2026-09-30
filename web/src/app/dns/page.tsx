import Link from "next/link";
import clsx from "clsx";
import { Check, Clock, ExternalLink, Minus, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Refused } from "@/components/refused";
import { Badge, Card, Label } from "@/components/ui";
import { holds } from "@/domain/access/permissions";
import { NOT_IN_ACCOUNT, dnsStateOf, duckBase, type DnsState } from "@/domain/dns/rules";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dnsProviderFacts, dnsStatus } from "@/lib/dns-ops";
import { relativeTime } from "@/lib/queries";
import { shellUser } from "@/lib/ui-types";
import type { Tone } from "@/lib/ui-types";
import { CopyName, DnsProviderCard, RetryDns } from "./dns-provider";

export const dynamic = "force-dynamic";

const STATE: Record<DnsState, { tone: Tone; label: string; icon: typeof Check; ring: string }> = {
  set: { tone: "success", label: "written", icon: Check, ring: "border-success-line bg-success-soft text-success" },
  failed: { tone: "danger", label: "not written", icon: TriangleAlert, ring: "border-danger-line bg-danger-soft text-danger" },
  "no-address": { tone: "warning", label: "no address", icon: Clock, ring: "border-warning-line bg-warning-soft text-warning" },
  outside: { tone: "muted", label: "outside the zone", icon: Minus, ring: "border-line bg-card-2 text-ink-4" },
  none: { tone: "muted", label: "—", icon: Minus, ring: "border-line bg-card-2 text-ink-4" },
};

/* The workspace's DNS provider and every record it keeps. Owners' and
   admins', like the bucket and the Steam key: the token is theirs to
   set, and the records are a list of every server's address. */
export default async function DnsPage() {
  const user = await requireUser();
  if (!holds(user.role, "dns.manage")) {
    return <Refused user={shellUser(user)} section="DNS" who="owners and admins" />;
  }
  const [status, facts, servers] = await Promise.all([
    dnsStatus(),
    dnsProviderFacts(),
    db.server.findMany({
      orderBy: { name: "asc" },
      select: {
        slug: true,
        name: true,
        host: true,
        dnsAddress: true,
        dnsError: true,
        dnsCheckedAt: true,
        node: { select: { name: true, publicAddress: true, observedAddress: true } },
      },
    }),
  ]);
  const rows = servers.map((s) => ({ ...s, dns: dnsStateOf(s, facts, s.node) }));
  const count = (state: DnsState) => rows.filter((r) => r.dns.state === state).length;
  const tiles: Array<{ label: string; value: number; sub: string; tone?: "danger" | "success" | "warning" }> = [
    { label: "Written", value: count("set"), sub: "pointing at their node", tone: count("set") > 0 ? "success" : undefined },
    { label: "Waiting", value: count("no-address"), sub: "node has no public address", tone: count("no-address") > 0 ? "warning" : undefined },
    { label: "Need attention", value: count("failed"), sub: "the provider said no", tone: count("failed") > 0 ? "danger" : undefined },
    { label: "Yours", value: count("outside"), sub: "outside the zone" },
  ];

  return (
    <AppShell crumbs={["DNS"]} user={shellUser(user)}>
      <div className="flex flex-col gap-5 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">DNS</h1>
          <p className="mt-[7px] max-w-[74ch] text-[12.5px] leading-snug text-ink-3">
            A server&apos;s address is a hostname. With a provider set, the panel keeps the record behind it: written
            when the server is created, pointed at the new node when it moves or the node&apos;s address changes,
            removed with the server. Without one nothing changes — the record is yours to keep.
          </p>
        </div>

        <DnsProviderCard
          view={{
            ...status,
            configuredAt: status.configuredAt?.toISOString() ?? null,
            checkedAt: status.checkedAt?.toISOString() ?? null,
          }}
          written={count("set")}
        />

        {facts && (
          <>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              {tiles.map((t) => (
                <Card key={t.label} className="p-5">
                  <Label>{t.label}</Label>
                  <div
                    className={clsx(
                      "mt-3 text-[30px] leading-none font-semibold tracking-[-0.03em] tnum",
                      t.tone === "success" && "text-success",
                      t.tone === "warning" && "text-warning",
                      t.tone === "danger" && "text-danger",
                    )}
                  >
                    {t.value}
                  </div>
                  <div className="mt-2 text-[11.5px] text-ink-4">{t.sub}</div>
                </Card>
              ))}
            </div>

            <Card className="overflow-hidden">
              <div className="flex items-baseline gap-3 border-b border-line px-5 py-[14px]">
                <h2 className="text-[14px] font-semibold tracking-[-0.01em]">Records</h2>
                <span className="font-mono text-[11px] text-ink-4">
                  {rows.length} server{rows.length === 1 ? "" : "s"} · zone {facts.zone}
                </span>
              </div>
              {rows.length === 0 ? (
                <p className="px-5 py-8 text-center text-[12.5px] text-ink-3">
                  No servers yet.{" "}
                  <Link href="/servers/new" className="text-accent hover:underline">
                    Create one
                  </Link>
                  .
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {rows.map((r) => {
                    const meta = STATE[r.dns.state];
                    const Icon = meta.icon;
                    const sub = duckBase(r.host);
                    const makeIt = facts.kind === "duckdns" && r.dns.state === "failed" && (r.dns.error ?? "").includes(NOT_IN_ACCOUNT) && sub;
                    return (
                      <li
                        key={r.slug}
                        className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-5 py-[14px] md:grid-cols-[30px_minmax(0,1.2fr)_minmax(0,1fr)_236px]"
                      >
                        <span className={clsx("grid h-[30px] w-[30px] place-items-center rounded-lg border", meta.ring)}>
                          <Icon size={14} strokeWidth={2} />
                        </span>
                        <div className="min-w-0">
                          <Link href={`/servers/${r.slug}`} className="block truncate text-[13.5px] font-medium hover:text-accent">
                            {r.name}
                          </Link>
                          <div className="truncate font-mono text-[11px] text-ink-4">{r.host}</div>
                        </div>
                        <div className="col-span-2 min-w-0 md:col-span-1">
                          <div className="font-mono text-[11px] text-ink-3">
                            {r.node.name}
                            {r.dns.address && <span className="text-ink-4"> → {r.dns.address}</span>}
                          </div>
                          <div className="mt-[3px] text-[11.5px] leading-snug text-ink-4">
                            {r.dns.state === "failed"
                              ? r.dns.error
                              : r.dns.state === "no-address"
                                ? `${r.node.name} has no public address — set one on its page`
                                : r.dns.state === "outside"
                                  ? `not under ${facts.zone}; the record is yours`
                                  : r.dnsCheckedAt
                                    ? `checked ${relativeTime(r.dnsCheckedAt)}`
                                    : ""}
                          </div>
                        </div>
                        <div className="col-span-2 flex items-center gap-2 md:col-span-1 md:justify-end">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          {(r.dns.state === "failed" || r.dns.state === "set") && <RetryDns slug={r.slug} small />}
                        </div>
                        {makeIt && (
                          <div className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-warning-line bg-warning-soft px-3 py-[10px]">
                            <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink-2">
                              Make <span className="font-mono font-medium">{sub}</span> on duckdns.org — DuckDNS has no call for making a
                              subdomain, so this one is yours to do — then press Retry now. Every name under it follows, so
                              this one serves every server on the node.
                            </span>
                            <CopyName text={sub} />
                            <a
                              href="https://www.duckdns.org"
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-[5px] text-[12px] text-accent hover:underline"
                            >
                              Open duckdns.org
                              <ExternalLink size={11} strokeWidth={1.8} />
                            </a>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
