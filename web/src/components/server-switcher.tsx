import Link from "next/link";
import clsx from "clsx";
import { ServerSelect } from "./server-select";

/* Which server a per-server page is showing, as links.

   Files and Settings each had their own copy of this; Console had none,
   so it always opened the first server with no way to pick another; and
   Backups and Scheduler could not be narrowed to one server at all, which
   is why a server page's Backups tab used to open everyone's.

   On a phone the row of names took two lines under the tabs, three with
   a long name: there it is a select, which is one line whatever the
   servers are called. */
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

  const hrefOf = (slug: string) => `${basePath}?server=${encodeURIComponent(slug)}`;
  const choices = [
    ...(allLabel ? [{ href: basePath, label: allLabel, on: current === null }] : []),
    ...servers.map((s) => ({ href: hrefOf(s.slug), label: s.name, on: s.slug === current })),
  ];

  return (
    <>
      <ServerSelect choices={choices} className="sm:hidden" />
      <nav aria-label="Server" className="hidden max-w-full flex-wrap gap-px rounded-[9px] bg-(--border) p-px sm:inline-flex">
        {choices.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            aria-current={c.on ? "page" : undefined}
            className={clsx(
              "rounded-lg px-3 py-[6px] text-[11.5px] whitespace-nowrap transition-colors duration-150",
              c.on ? "bg-card-2 font-medium text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {c.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
