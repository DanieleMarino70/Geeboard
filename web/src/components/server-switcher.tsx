import Link from "next/link";
import clsx from "clsx";

/* Which server a per-server page is showing, as links.

   Files and Settings each had their own copy of this; Console had none,
   so it always opened the first server with no way to pick another; and
   Backups and Scheduler could not be narrowed to one server at all, which
   is why a server page's Backups tab used to open everyone's. */
export function ServerSwitcher({
  servers,
  current,
  basePath,
  allLabel,
}: {
  servers: Array<{ slug: string; name: string }>;
  /** The selected server, or null for all of them. */
  current: string | null;
  basePath: string;
  /** Offer an "all servers" choice, with this label. */
  allLabel?: string;
}) {
  if (servers.length <= 1 && !allLabel) return null;

  const item = (href: string, label: string, on: boolean) => (
    <Link
      key={href}
      href={href}
      aria-current={on ? "page" : undefined}
      className={clsx(
        "rounded-lg px-3 py-[6px] text-[11.5px] whitespace-nowrap transition-colors duration-150",
        on ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink-2",
      )}
    >
      {label}
    </Link>
  );

  return (
    <nav aria-label="Server" className="inline-flex max-w-full flex-wrap gap-px rounded-[9px] bg-(--border) p-px">
      {allLabel && item(basePath, allLabel, current === null)}
      {servers.map((s) => item(`${basePath}?server=${encodeURIComponent(s.slug)}`, s.name, s.slug === current))}
    </nav>
  );
}
