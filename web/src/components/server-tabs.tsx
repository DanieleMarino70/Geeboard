import Link from "next/link";
import clsx from "clsx";

/* The sections of one server, the same on every page that is about one.

   On a server's page these used to be buttons that did nothing but
   Console; Backups and Scheduler, where they led anywhere, opened every
   server's. Each now opens that server's own view, and the same row sits
   on those views so the way back is where it was. Plugins has no page —
   mods are not supported — and the tab says so rather than going
   somewhere empty. */
export type ServerTab = "overview" | "console" | "files" | "backups" | "scheduler" | "players" | "settings";

const TABS: Array<{ id: ServerTab | "plugins"; label: string; href: ((slug: string) => string) | null }> = [
  { id: "overview", label: "Overview", href: (s) => `/servers/${s}` },
  { id: "console", label: "Console", href: (s) => `/console?server=${s}` },
  { id: "files", label: "Files", href: (s) => `/files?server=${s}` },
  { id: "backups", label: "Backups", href: (s) => `/backups?server=${s}` },
  { id: "scheduler", label: "Scheduler", href: (s) => `/scheduler?server=${s}` },
  { id: "players", label: "Players", href: (s) => `/players?server=${s}` },
  { id: "plugins", label: "Plugins", href: null },
  { id: "settings", label: "Settings", href: (s) => `/settings?server=${s}` },
];

export function ServerTabs({ slug, active }: { slug: string; active: ServerTab }) {
  return (
    <nav aria-label="Server sections" className="-mx-5 flex gap-[2px] overflow-x-auto border-b border-line px-5 sm:-mx-8 sm:px-8">
      {TABS.map((t) => {
        const on = t.id === active;
        const cls = clsx(
          "relative shrink-0 px-[15px] pt-[11px] pb-[13px] text-[12.5px] transition-colors duration-150",
          on ? "font-medium text-ink" : t.href ? "text-ink-3 hover:text-ink-2" : "cursor-default text-ink-4 opacity-60",
        );
        const underline = (
          <span className={clsx("absolute inset-x-2 -bottom-px h-[2px] rounded-[2px]", on ? "bg-accent" : "bg-transparent")} />
        );
        return t.href ? (
          <Link key={t.id} href={t.href(slug)} aria-current={on ? "page" : undefined} className={cls}>
            {t.label}
            {underline}
          </Link>
        ) : (
          <span key={t.id} title="Plugins and mods are not supported yet" className={cls}>
            {t.label}
            {underline}
          </span>
        );
      })}
    </nav>
  );
}
