import { ArrowUpCircle, CheckCircle2, Info } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import type { VersionOutlook } from "@/domain/games/versions";
import { formatReleased } from "@/lib/catalog";

/* The version panel.

   Its whole job is to be honest about which question it is answering.
   "Up to date" is four different claims and they are regularly not all
   true at once — the game has moved on, the server build has not; the
   branch has a new build id but the version string is unchanged; there
   is a newer version and Geeboard cannot install it.

   Showing one number and calling it the version is how a panel quietly
   tells an operator their server is current when it is three months
   behind. */

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-[10px] border-b border-line py-2 last:border-b-0">
      <span className="w-[92px] shrink-0 text-[11.5px] text-ink-4">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{value}</span>
      {note && <span className="shrink-0 font-mono text-[10px] text-ink-4">{note}</span>}
    </div>
  );
}

export function VersionPanel({
  outlook,
  versionLabel,
}: {
  outlook: VersionOutlook | null;
  versionLabel: string;
}) {
  if (!outlook) {
    return (
      <Card className="px-5 py-[18px]">
        <h2 className="mb-3 text-[13.5px] font-semibold">Version</h2>
        <Row label="Installed" value={versionLabel} />
        <p className="mt-3 text-[11px] leading-relaxed text-ink-4">
          This server predates the game catalog, so Geeboard cannot tell whether an update exists.
          Running <span className="font-mono">games:sync</span> may link it up.
        </p>
      </Card>
    );
  }

  const current = !outlook.updateAvailable;

  return (
    <Card className="px-5 py-[18px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13.5px] font-semibold">Version</h2>
        {outlook.updateAvailable ? (
          <Badge tone="warning">update available</Badge>
        ) : (
          <Badge tone="success">current</Badge>
        )}
      </div>

      <Row label="Installed" value={outlook.installedLabel ?? versionLabel} note={outlook.installed ?? undefined} />

      {/* A Steam game has no version number, so the branch and its build
          id are the only things that can move. Showing them only where
          they exist keeps the panel from inventing a field. */}
      {outlook.branch && (
        <Row
          label="Branch"
          value={outlook.branch}
          note={outlook.branchUpdatedAt ? formatReleased(outlook.branchUpdatedAt.slice(0, 10)) : undefined}
        />
      )}
      {outlook.installedBuildId && (
        <Row
          label="Build"
          value={outlook.installedBuildId}
          note={outlook.buildDrift ? `now ${outlook.currentBuildId}` : "current"}
        />
      )}

      {outlook.supportedLatest && outlook.supportedLatest !== outlook.installed && (
        <Row label="Available" value={outlook.supportedLatest} note="supported" />
      )}
      {outlook.gameLatest && outlook.gameLatest !== outlook.supportedLatest && (
        <Row label="Game is on" value={outlook.gameLatest} note="upstream" />
      )}

      <div className="mt-[14px] flex items-start gap-[9px] rounded-[9px] border border-line bg-card-2 px-[11px] py-[9px]">
        {outlook.buildDrift ? (
          <>
            <ArrowUpCircle size={14} strokeWidth={1.8} className="mt-[1px] shrink-0 text-warning" />
            <p className="text-[11px] leading-relaxed text-ink-3">
              The <span className="font-mono">{outlook.branch}</span> branch has published a new
              build since this server was installed. {outlook.installedLabel} has no version number
              to compare, so this is what an update looks like for it.
            </p>
          </>
        ) : outlook.updateAvailable ? (
          <>
            <ArrowUpCircle size={14} strokeWidth={1.8} className="mt-[1px] shrink-0 text-warning" />
            <p className="text-[11px] leading-relaxed text-ink-3">
              {outlook.recommended ?? "A newer version"} is available. Updating is not wired up yet —
              it needs a backup, a stop and a rollback path, which is Phase 5.
            </p>
          </>
        ) : outlook.aheadOfSupport ? (
          <>
            <Info size={14} strokeWidth={1.8} className="mt-[1px] shrink-0 text-info" />
            <p className="text-[11px] leading-relaxed text-ink-3">
              This server is on the newest version Geeboard installs. The game itself has moved on to{" "}
              <span className="font-mono">{outlook.gameLatest}</span>, which is not supported here
              yet — so &ldquo;up to date&rdquo; means up to date with us, not with upstream.
            </p>
          </>
        ) : (
          <>
            <CheckCircle2 size={14} strokeWidth={1.8} className="mt-[1px] shrink-0 text-success" />
            <p className="text-[11px] leading-relaxed text-ink-3">
              {current ? "Running the newest version Geeboard has for this game." : ""}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
