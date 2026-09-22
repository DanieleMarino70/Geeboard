import Link from "next/link";
import clsx from "clsx";
import { findGame } from "@/domain/games/registry";

/* The sections of one server, the same on every page that is about one.

   On a server's page these used to be buttons that did nothing but
   Console; Backups and Scheduler, where they led anywhere, opened every
   server's. Each now opens that server's own view, and the same row sits
   on those views so the way back is where it was.

   Mods is the one tab that is not the same on every server: a game whose
   definition says nothing about mods has no page to open, and the tab
   says so rather than leading somewhere empty. Which games take mods is
   worked out here, from the game, rather than passed in: it was a flag
   once, and only the Mods page passed it, so every other page greyed
   the tab out on a Zomboid server and nothing in the panel led to it. */
export type ServerTab =
  | "overview"
  | "console"
  | "files"
  | "backups"
  | "scheduler"
  | "players"
  | "mods"
  | "settings";

const TABS: Array<{ id: ServerTab; label: string; href: ((slug: string) => string) | null }> = [
  { id: "overview", label: "Overview", href: (s) => `/servers/${s}` },
  { id: "console", label: "Console", href: (s) => `/console?server=${s}` },
  { id: "files", label: "Files", href: (s) => `/files?server=${s}` },
  { id: "backups", label: "Backups", href: (s) => `/backups?server=${s}` },
  { id: "scheduler", label: "Scheduler", href: (s) => `/scheduler?server=${s}` },
  { id: "players", label: "Players", href: (s) => `/players?server=${s}` },
  { id: "mods", label: "Mods", href: (s) => `/mods?server=${s}` },
  { id: "settings", label: "Settings", href: (s) => `/settings?server=${s}` },
];

export function ServerTabs({
  slug,
  active,
  gameId,
}: {
  slug: string;
  active: ServerTab;
  /** The server's game, which decides whether it has a Mods tab. Null for a server from before the catalog. */
  gameId: string | null;
}) {
  const modsSupported = Boolean(gameId && findGame(gameId)?.mods);
  return (
    <nav aria-label="Server sections" className="-mx-5 flex gap-[2px] overflow-x-auto border-b border-line px-5 sm:-mx-8 sm:px-8">
      {TABS.map((tab) => {
        const t = tab.id === "mods" && !modsSupported ? { ...tab, href: null } : tab;
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
          <span key={t.id} title="Geeboard installs mods for Project Zomboid, for now" className={cls}>
            {t.label}
            {underline}
          </span>
        );
      })}
    </nav>
  );
}
