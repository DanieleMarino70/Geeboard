import { ExternalLink } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Refused } from "@/components/refused";
import { LocalTime } from "@/components/local-time";
import { Card, Label, Pill } from "@/components/ui";
import { holds } from "@/domain/access/permissions";
import { STATE_WORD, toneOf } from "@/domain/updates/release";
import { requireUser } from "@/lib/auth";
import { readUpdateStatus } from "@/lib/panel-update-ops";
import { shellUser } from "@/lib/ui-types";
import { CheckNow } from "./check-now";

export const dynamic = "force-dynamic";

/* Whether a newer Geeboard is out, and whether any node's agent is below a floor the release names. Owners' and admins': they are the people
   who can do something about it. What is on the page was read by the poller, at most twice a day, from one small file every release carries;
   opening this page asks nobody anything. */
export const metadata = { title: "Updates" };

const DOCS = "https://danielemarino70.github.io/Geeboard";

export default async function UpdatesPage() {
  const user = await requireUser();
  if (!holds(user.role, "node.manage")) {
    return <Refused user={shellUser(user)} section="Updates" who="owners and admins" />;
  }
  const s = await readUpdateStatus();

  return (
    <AppShell crumbs={["Updates"]} user={shellUser(user)}>
      <div className="flex flex-col gap-5 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Updates</h1>
          <p className="mt-[7px] max-w-[74ch] text-[12.5px] leading-snug text-ink-3">
            Whether a newer Geeboard is out, for this panel and for the agents on its nodes. The panel asks for one small file from {s.source}, at most
            twice a day, and sends nothing about itself with the request but the name every Geeboard request carries — no cookie, no address, no identifier. This page only shows what it said. A
            release is never applied by the panel: upgrading is the installer, and it takes a dump first.
          </p>
        </div>

        {s.unavailable ? (
          <Card className="p-5">
            <h2 className="text-[14px] font-semibold">This database does not have the table for it yet</h2>
            <p className="mt-2 max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              The release that checks for updates adds a table, and this panel is running against a database that has not been migrated to it. The
              installer&apos;s re-run migrates it; until then there is nothing to show here.
            </p>
          </Card>
        ) : (
          <>
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-3">
                <Label>This panel</Label>
                {s.panel ? <Pill tone={toneOf(s.panel.state)}>{STATE_WORD[s.panel.state]}</Pill> : <Pill tone="muted">{s.enabled ? "Not checked yet" : "Checks are off"}</Pill>}
                <div className="ml-auto">
                  <CheckNow enabled={s.enabled} />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2">
                <div>
                  <div className="font-mono text-[10.5px] tracking-[0.04em] text-ink-4 uppercase">Running</div>
                  <div className="font-mono text-[20px] font-semibold">{s.installed}</div>
                </div>
                <div>
                  <div className="font-mono text-[10.5px] tracking-[0.04em] text-ink-4 uppercase">Newest release</div>
                  <div className="font-mono text-[20px] font-semibold">{s.release ? s.release.version : "—"}</div>
                  {s.release ? <div className="text-[11.5px] text-ink-3">{s.release.date}</div> : null}
                </div>
              </div>
              <p className="mt-3 max-w-[78ch] text-[13px] leading-snug text-ink-2">
                {!s.enabled
                  ? "Update checks are off on this panel (GEEBOARD_UPDATE_CHECK=off), so it asks nobody and cannot say. Look at the releases yourself, or take that line out of deploy/panel/.env and restart the panel."
                  : s.panel
                    ? s.panel.says
                    : s.error
                      ? "It has not been able to read the release file yet; the reason is below."
                      : "It has not asked yet. The poller asks within the hour after it starts, and the button below asks now."}
                {s.release?.summary ? ` ${s.release.summary}` : ""}
              </p>
              {s.release && (s.release.url || s.release.changelog) ? (
                <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
                  {s.release.url ? (
                    <a href={s.release.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-fg hover:underline">
                      Release notes <ExternalLink size={12} aria-hidden />
                    </a>
                  ) : null}
                  {s.release.changelog ? (
                    <a href={s.release.changelog} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-fg hover:underline">
                      Changelog <ExternalLink size={12} aria-hidden />
                    </a>
                  ) : null}
                  <a href={`${DOCS}/upgrading.html`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-fg hover:underline">
                    How to upgrade, and how to go back <ExternalLink size={12} aria-hidden />
                  </a>
                </p>
              ) : null}
              <p className="mt-4 border-t border-line pt-3 text-[11.5px] leading-snug text-ink-3">
                {s.succeededAt ? (
                  <>
                    Last read <LocalTime at={s.succeededAt} style="datetime" />.{" "}
                  </>
                ) : null}
                {s.checkedAt && (!s.succeededAt || s.checkedAt.getTime() > s.succeededAt.getTime()) ? (
                  <>
                    Last tried <LocalTime at={s.checkedAt} style="datetime" />.{" "}
                  </>
                ) : null}
                {s.error ? <span className="text-warning-fg">It could not read the file: {s.error}</span> : null}
              </p>
            </Card>

            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-3">
                <Label>Agents</Label>
                <span className="text-[12px] text-ink-3">
                  A node&apos;s agent is upgraded on its own machine, and not every release needs it (<a className="text-accent-fg underline underline-offset-2" href={`${DOCS}/upgrading.html#the-nodes`} target="_blank" rel="noopener noreferrer">when</a>). The release names the lowest one it is meant to work with and the
                  lowest one without a known security problem.
                </span>
              </div>
              {s.agents.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-ink-3">{s.release ? "No node has registered an agent." : "Nothing to compare until the release file has been read."}</p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {s.agents.map((a) => (
                    <li key={a.node} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-[10px]">
                      <span className="min-w-[8rem] font-mono text-[12.5px] font-medium">{a.node}</span>
                      <span className="font-mono text-[12px] text-ink-3">agent {a.version}</span>
                      <Pill tone={toneOf(a.verdict.state)}>{STATE_WORD[a.verdict.state]}</Pill>
                      {a.verdict.state === "security" || a.verdict.state === "unsupported" ? <span className="text-[12px] text-ink-2">{a.verdict.says}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
